import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, feedbackEntries, users } from "@workspace/db";
import { SubmitFeedbackBody, TriageFeedbackBody, TriageFeedbackResponse, UpdateFeedbackResolutionBody } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { AiUnavailableError, triageFeedback as runTriage } from "../lib/ai";
import { asyncHandler, HttpError, notFound, paginated, pagination } from "../lib/workspace";

const router: IRouter = Router();
router.use(requireAuth);

type EntryRow = typeof feedbackEntries.$inferSelect;

function entryJson(row: EntryRow, user: { id: string; fullName: string; email: string }) {
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
    createdAt: row.createdAt,
    user: { id: user.id, fullName: user.fullName, email: user.email },
  };
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
  const [row] = await db.insert(feedbackEntries).values({
    organizationId: user.organizationId,
    userId: user.id,
    appKey: parsed.data.appKey ?? null,
    module: parsed.data.module,
    pagePath: parsed.data.pagePath ?? null,
    category: parsed.data.category,
    message: parsed.data.message,
    triage: parsed.data.triage ? { ...parsed.data.triage, guidance: parsed.data.triage.guidance ?? null, resolutionSuggestion: parsed.data.triage.resolutionSuggestion ?? null } : null,
  }).returning();
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
    db.select({ entry: feedbackEntries, fullName: users.fullName, email: users.email })
      .from(feedbackEntries)
      .innerJoin(users, eq(users.id, feedbackEntries.userId))
      .where(where).orderBy(desc(feedbackEntries.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(feedbackEntries).where(where),
  ]);
  res.json(paginated(
    rows.map((row) => entryJson(row.entry, { id: row.entry.userId, fullName: row.fullName, email: row.email })),
    Number(count[0]?.count ?? 0), page, limit,
  ));
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
    db.select().from(feedbackEntries).where(where)
      .orderBy(desc(feedbackEntries.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(feedbackEntries).where(where),
  ]);
  res.json(paginated(
    rows.map((row) => entryJson(row, { id: user.id, fullName: user.fullName, email: user.email })),
    Number(count[0]?.count ?? 0), page, limit,
  ));
}));

router.post("/feedback/:id/triage", requireAdmin, asyncHandler(async (req, res) => {
  const [row] = await db.select().from(feedbackEntries).where(and(
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
      .where(eq(feedbackEntries.id, row!.id)).returning();
    res.json(entryJson(updated!, { id: row!.userId, fullName: author?.fullName ?? "", email: author?.email ?? "" }));
  } catch (error) {
    if (error instanceof AiUnavailableError) { res.status(503).json({ error: error.message }); return; }
    throw error;
  }
}));

router.put("/feedback/:id/resolution", requireAdmin, asyncHandler(async (req, res) => {
  const parsed = UpdateFeedbackResolutionBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid request body");
  const [row] = await db.update(feedbackEntries)
    .set({
      resolution: parsed.data.resolution,
      resolutionResponse: parsed.data.response?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(feedbackEntries.id, String(req.params.id)),
      eq(feedbackEntries.organizationId, req.currentUser!.organizationId),
      isNull(feedbackEntries.deletedAt),
    )).returning();
  if (!row) notFound("Feedback entry not found");
  const [author] = await db.select({ fullName: users.fullName, email: users.email }).from(users).where(eq(users.id, row!.userId)).limit(1);
  res.json(entryJson(row!, { id: row!.userId, fullName: author?.fullName ?? "", email: author?.email ?? "" }));
}));

export default router;
