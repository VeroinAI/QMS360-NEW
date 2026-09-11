import { Router, type IRouter } from "express";
import { and, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db, feedbackAttachments, feedbackEntries, feedbackStatusHistory, users } from "@workspace/db";
import { CreateFeedbackAttachmentBody, SubmitFeedbackBody, TriageFeedbackBody, TriageFeedbackResponse, UpdateFeedbackResolutionBody } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { AiUnavailableError, triageFeedback as runTriage } from "../lib/ai";
import { asyncHandler, HttpError, notFound, paginated, pagination } from "../lib/workspace";

const router: IRouter = Router();
router.use(requireAuth);

type EntryRow = typeof feedbackEntries.$inferSelect;

const { resolutionResponse: _resolutionResponse, ...feedbackEntryColumns } = getTableColumns(feedbackEntries);
const feedbackEntrySelection = {
  ...feedbackEntryColumns,
  // Production may temporarily lag the development schema during rollout.
  resolutionResponse: sql<string | null>`coalesce(
    "feedback_entries"."triage" ->> 'resolutionResponse',
    to_jsonb("feedback_entries") ->> 'resolution_response'
  )`,
};

function hasPostgresCode(error: unknown, expectedCode: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if ((current as { code?: unknown }).code === expectedCode) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type StatusHistoryJson = {
  id: string;
  fromStatus: string;
  toStatus: string;
  changedById: string;
  changedByName: string | null;
  changedAt: Date;
};

function entryJson(
  row: EntryRow,
  user: { id: string; fullName: string; email: string },
  statusHistory: StatusHistoryJson[] = [],
) {
  return {
    id: row.id,
    appKey: row.appKey,
    module: row.module,
    pagePath: row.pagePath,
    category: row.category,
    message: row.message,
    triage: row.triage ?? null,
    resolution: row.resolution,
    resolutionResponse: row.resolutionResponse ?? null,
    statusHistory,
    attachments: [],
    createdAt: row.createdAt,
    user: { id: user.id, fullName: user.fullName, email: user.email },
  };
}

async function statusHistoryByFeedback(ids: string[]) {
  const grouped = new Map<string, StatusHistoryJson[]>();
  if (!ids.length) return grouped;
  try {
    const rows = await db.select({
      id: feedbackStatusHistory.id,
      feedbackId: feedbackStatusHistory.feedbackId,
      fromStatus: feedbackStatusHistory.fromStatus,
      toStatus: feedbackStatusHistory.toStatus,
      changedById: feedbackStatusHistory.changedById,
      changedByName: users.fullName,
      changedAt: feedbackStatusHistory.changedAt,
    }).from(feedbackStatusHistory)
      .leftJoin(users, eq(users.id, feedbackStatusHistory.changedById))
      .where(inArray(feedbackStatusHistory.feedbackId, ids))
      .orderBy(feedbackStatusHistory.changedAt);
    for (const { feedbackId, ...row } of rows) {
      grouped.set(feedbackId, [...(grouped.get(feedbackId) ?? []), row]);
    }
    return grouped;
  } catch (error) {
    if (hasPostgresCode(error, "42P01")) return grouped;
    throw error;
  }
}

async function canWriteStatusHistory() {
  try {
    await db.select({ id: feedbackStatusHistory.id }).from(feedbackStatusHistory).limit(0);
    return true;
  } catch (error) {
    if (hasPostgresCode(error, "42P01")) return false;
    throw error;
  }
}

function attachmentJson(row: typeof feedbackAttachments.$inferSelect) {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status as "uploading" | "stored" | "failed",
  };
}

async function attachmentsByFeedback(ids: string[]) {
  const grouped = new Map<string, ReturnType<typeof attachmentJson>[]>();
  if (!ids.length) return grouped;
  let rows: (typeof feedbackAttachments.$inferSelect)[];
  try {
    rows = await db.select().from(feedbackAttachments).where(and(
      inArray(feedbackAttachments.feedbackId, ids),
      eq(feedbackAttachments.status, "stored"),
      isNull(feedbackAttachments.deletedAt),
    )).orderBy(feedbackAttachments.createdAt);
  } catch (error) {
    // Keep existing feedback visible while production catches up with the
    // optional attachment-table rollout.
    if (hasPostgresCode(error, "42P01")) return grouped;
    throw error;
  }
  for (const row of rows) {
    grouped.set(row.feedbackId, [...(grouped.get(row.feedbackId) ?? []), attachmentJson(row)]);
  }
  return grouped;
}

function withAttachments(entry: ReturnType<typeof entryJson>, attachments: ReturnType<typeof attachmentJson>[]) {
  return { ...entry, attachments };
}

router.post("/feedback/triage", asyncHandler(async (req, res) => {
  const parsed = TriageFeedbackBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid request body");
  try {
    const result = await runTriage({ ...parsed.data, organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id });
    const validated = TriageFeedbackResponse.safeParse(result);
    if (!validated.success) throw new AiUnavailableError("AI returned an unexpected triage result");
    res.json(validated.data);
  } catch (error) {
    if (error instanceof AiUnavailableError) { res.status(503).json({ error: error.message }); return; }
    throw error;
  }
}));

router.post("/feedback", asyncHandler(async (req, res) => {
  const parsed = SubmitFeedbackBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid request body");
  const user = req.currentUser!;
  const triage = parsed.data.triage
    ? { ...parsed.data.triage, guidance: parsed.data.triage.guidance ?? null, resolutionSuggestion: parsed.data.triage.resolutionSuggestion ?? null }
    : null;
  // Name only the stable columns so production can accept feedback while the
  // optional resolution_response column is still pending its schema rollout.
  const inserted = await db.execute<{ id: string }>(sql`
    insert into "shared"."feedback_entries" (
      "organization_id", "user_id", "app_key", "module", "page_path",
      "category", "message", "triage"
    ) values (
      ${user.organizationId}, ${user.id}, ${parsed.data.appKey ?? null},
      ${parsed.data.module}, ${parsed.data.pagePath ?? null},
      ${parsed.data.category}, ${parsed.data.message},
      ${triage ? JSON.stringify(triage) : null}::jsonb
    )
    returning "id"
  `);
  const [row] = await db.select(feedbackEntrySelection).from(feedbackEntries)
    .where(eq(feedbackEntries.id, inserted.rows[0]!.id)).limit(1);
  res.status(201).json(entryJson(row!, { id: user.id, fullName: user.fullName, email: user.email }));
}));

router.get("/feedback", requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const module = typeof req.query.module === "string" ? req.query.module : undefined;
  if (module && !["qaqc", "lessons", "audit", "system"].includes(module)) {
    throw new HttpError(422, "Invalid feedback module");
  }
  const where = and(
    eq(feedbackEntries.organizationId, req.currentUser!.organizationId),
    isNull(feedbackEntries.deletedAt),
    module ? eq(feedbackEntries.module, module) : undefined,
  );
  const [rows, count] = await Promise.all([
    db.select({ entry: feedbackEntrySelection, fullName: users.fullName, email: users.email })
      .from(feedbackEntries)
      .innerJoin(users, eq(users.id, feedbackEntries.userId))
      .where(where).orderBy(desc(feedbackEntries.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(feedbackEntries).where(where),
  ]);
  const ids = rows.map((row) => row.entry.id);
  const [attachments, statusHistory] = await Promise.all([
    attachmentsByFeedback(ids),
    statusHistoryByFeedback(ids),
  ]);
  res.json(paginated(
    rows.map((row) => withAttachments(
      entryJson(
        row.entry,
        { id: row.entry.userId, fullName: row.fullName, email: row.email },
        statusHistory.get(row.entry.id) ?? [],
      ),
      attachments.get(row.entry.id) ?? [],
    )),
    Number(count[0]?.count ?? 0), page, limit,
  ));
}));

router.get("/feedback/export", requireAdmin, asyncHandler(async (req, res) => {
  const module = typeof req.query.module === "string" ? req.query.module : undefined;
  if (module && !["qaqc", "lessons", "audit", "system"].includes(module)) {
    throw new HttpError(422, "Invalid feedback module");
  }
  const rows = await db.select({ entry: feedbackEntrySelection, fullName: users.fullName, email: users.email })
    .from(feedbackEntries)
    .innerJoin(users, eq(users.id, feedbackEntries.userId))
    .where(and(
      eq(feedbackEntries.organizationId, req.currentUser!.organizationId),
      isNull(feedbackEntries.deletedAt),
      module ? eq(feedbackEntries.module, module) : undefined,
    ))
    .orderBy(desc(feedbackEntries.createdAt));
  const history = await statusHistoryByFeedback(rows.map(({ entry }) => entry.id));
  const exportRows = rows.map(({ entry, fullName, email }) => ({
    "Feedback ID": entry.id,
    Module: entry.module ?? "",
    Category: entry.category,
    Feedback: entry.message,
    Status: entry.resolution,
    "Response to user": entry.resolutionResponse ?? "",
    "Submitted by": fullName,
    "Submitted by user ID": entry.userId,
    Email: email,
    Page: entry.pagePath ?? "",
    Application: entry.appKey ?? "",
    "Created at": entry.createdAt.toISOString(),
    "Updated at": entry.updatedAt.toISOString(),
    "Status history": (history.get(entry.id) ?? []).map((change) =>
      `${change.changedAt.toISOString()}: ${change.fromStatus} -> ${change.toStatus} by ${change.changedById}`,
    ).join("\n"),
  }));
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  worksheet["!cols"] = [
    { wch: 38 }, { wch: 14 }, { wch: 14 }, { wch: 55 }, { wch: 26 },
    { wch: 45 }, { wch: 24 }, { wch: 38 }, { wch: 30 }, { wch: 30 },
    { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 80 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Feedback");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="feedback-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buffer);
}));

router.get("/feedback/mine", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const user = req.currentUser!;
  const where = and(
    eq(feedbackEntries.organizationId, user.organizationId),
    eq(feedbackEntries.userId, user.id),
    isNull(feedbackEntries.deletedAt),
  );
  const [rows, count] = await Promise.all([
    db.select(feedbackEntrySelection).from(feedbackEntries).where(where)
      .orderBy(desc(feedbackEntries.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(feedbackEntries).where(where),
  ]);
  const ids = rows.map((row) => row.id);
  const [attachments, statusHistory] = await Promise.all([
    attachmentsByFeedback(ids),
    statusHistoryByFeedback(ids),
  ]);
  res.json(paginated(
    rows.map((row) => withAttachments(
      entryJson(row, { id: user.id, fullName: user.fullName, email: user.email }, statusHistory.get(row.id) ?? []),
      attachments.get(row.id) ?? [],
    )),
    Number(count[0]?.count ?? 0), page, limit,
  ));
}));

router.post("/feedback/:id/triage", requireAdmin, asyncHandler(async (req, res) => {
  const [row] = await db.select(feedbackEntrySelection).from(feedbackEntries).where(and(
    eq(feedbackEntries.id, String(req.params.id)),
    eq(feedbackEntries.organizationId, req.currentUser!.organizationId),
    isNull(feedbackEntries.deletedAt),
  )).limit(1);
  if (!row) notFound("Feedback entry not found");
  const [author] = await db.select({ fullName: users.fullName, email: users.email }).from(users).where(eq(users.id, row!.userId)).limit(1);
  try {
    const result = await runTriage({
      module: row!.module, category: row!.category, message: row!.message, pagePath: row!.pagePath,
      organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id,
    });
    const validated = TriageFeedbackResponse.safeParse(result);
    if (!validated.success) throw new AiUnavailableError("AI returned an unexpected triage result");
    const [updated] = await db.update(feedbackEntries)
      .set({ triage: { ...validated.data, guidance: validated.data.guidance ?? null, resolutionSuggestion: validated.data.resolutionSuggestion ?? null }, updatedAt: new Date() })
      .where(eq(feedbackEntries.id, row!.id)).returning(feedbackEntrySelection);
    res.json(entryJson(updated!, { id: row!.userId, fullName: author?.fullName ?? "", email: author?.email ?? "" }));
  } catch (error) {
    if (error instanceof AiUnavailableError) { res.status(503).json({ error: error.message }); return; }
    throw error;
  }
}));

router.put("/feedback/:id/resolution", requireAdmin, asyncHandler(async (req, res) => {
  const parsed = UpdateFeedbackResolutionBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid request body");
  const response = parsed.data.response?.trim() || null;
  const where = and(
    eq(feedbackEntries.id, String(req.params.id)),
    eq(feedbackEntries.organizationId, req.currentUser!.organizationId),
    isNull(feedbackEntries.deletedAt),
  );
  const statusHistoryAvailable = await canWriteStatusHistory();
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select(feedbackEntrySelection).from(feedbackEntries).where(where).limit(1);
    if (!existing) return undefined;
    if (parsed.data.resolution === "closed" && existing.resolution !== "resolved" && existing.resolution !== "closed") {
      throw new HttpError(409, "Feedback must be resolved before it can be closed");
    }
    const fallbackTriage = response
      ? sql`jsonb_set(coalesce(${feedbackEntries.triage}, '{}'::jsonb), '{resolutionResponse}', to_jsonb(${response}::text), true)`
      : sql`coalesce(${feedbackEntries.triage}, '{}'::jsonb) - 'resolutionResponse'`;
    const [updated] = await tx.update(feedbackEntries)
      .set({ resolution: parsed.data.resolution, triage: fallbackTriage, updatedAt: new Date() })
      .where(where).returning(feedbackEntrySelection);
    if (statusHistoryAvailable && existing.resolution !== parsed.data.resolution) {
      await tx.insert(feedbackStatusHistory).values({
        organizationId: req.currentUser!.organizationId,
        feedbackId: existing.id,
        fromStatus: existing.resolution,
        toStatus: parsed.data.resolution,
        changedById: req.currentUser!.id,
      });
    }
    return updated;
  });
  if (!row) notFound("Feedback entry not found");
  const [author] = await db.select({ fullName: users.fullName, email: users.email }).from(users).where(eq(users.id, row!.userId)).limit(1);
  const [attachments, statusHistory] = await Promise.all([
    attachmentsByFeedback([row!.id]),
    statusHistoryByFeedback([row!.id]),
  ]);
  res.json(withAttachments(
    entryJson(
      row!,
      { id: row!.userId, fullName: author?.fullName ?? "", email: author?.email ?? "" },
      statusHistory.get(row!.id) ?? [],
    ),
    attachments.get(row!.id) ?? [],
  ));
}));

router.post("/feedback/:id/attachments", asyncHandler(async (req, res) => {
  const parsed = CreateFeedbackAttachmentBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid attachment metadata");
  const user = req.currentUser!;
  const [entry] = await db.select({ id: feedbackEntries.id }).from(feedbackEntries).where(and(
    eq(feedbackEntries.id, String(req.params.id)),
    eq(feedbackEntries.organizationId, user.organizationId),
    eq(feedbackEntries.userId, user.id),
    isNull(feedbackEntries.deletedAt),
  )).limit(1);
  if (!entry) notFound("Feedback entry not found");

  const mimeByExtension: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const extension = parsed.data.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!mimeByExtension[extension]) throw new HttpError(422, "This file type is not supported");
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(feedbackAttachments).where(and(
    eq(feedbackAttachments.feedbackId, entry!.id),
    isNull(feedbackAttachments.deletedAt),
  ));
  if (Number(count) >= 5) throw new HttpError(422, "A maximum of 5 reference files can be attached");

  const [attachment] = await db.insert(feedbackAttachments).values({
    organizationId: user.organizationId,
    feedbackId: entry!.id,
    uploadedById: user.id,
    fileName: parsed.data.fileName,
    mimeType: mimeByExtension[extension],
    sizeBytes: parsed.data.sizeBytes,
    status: "uploading",
  }).returning();
  res.status(201).json({
    attachment: attachmentJson(attachment!),
    uploadUrl: `/api/feedback/attachments/${attachment!.id}/upload`,
  });
}));

export default router;
