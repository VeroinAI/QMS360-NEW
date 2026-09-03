import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  and, asc, desc, eq, gte, gt, ilike, inArray, isNull, lte, or, sql,
} from "drizzle-orm";
import {
  AnswerLessonPromptQuestionBody,
  AssignLessonsUserRoleBody,
  CreateLessonFormBody,
  CreateLessonPhotoIntentBody,
  CreateLessonsDelegationBody,
  CreateLessonsEvidenceIntentBody,
  CreateLessonsRoleBody,
  DecideLessonsAccessRequestBody,
  RephraseLessonFieldBody,
  ReviewLessonFormBody,
  UpdateLessonFormBody,
  UpdateLessonsAiSettingsBody,
  UpdateLessonsEscalationRulesBody,
  UpdateLessonsNotificationTemplateBody,
  UpdateLessonsRoleBody,
} from "@workspace/api-zod";
import {
  applicationAccess,
  db,
  lessonDelegations,
  lessonEscalationInstances,
  lessonEscalationRules,
  lessonLearnedForms,
  lessonNotifications,
  lessonsAuditLogEntries,
  lessonsCategorisationRiskMaster,
  lessonsDisciplines,
  lessonsEvidenceFiles,
  lessonsNotificationTemplates,
  lessonsPermissions,
  lessonsUserWorkspaceRoles,
  lessonsWorkspaceRolePermissions,
  lessonsWorkspaceRoles,
  platformRoles,
  projects,
  users,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { assertOwnerOrFull, requireAppAccess, requirePermission } from "../middlewares/rbac";
import { assertLovValue } from "../lib/lov";
import { assertDisciplineInOrg, assertProjectInOrg, assertUserInOrg } from "../lib/tenancy";
import { promptToTransaction, rephraseText } from "../lib/ai";
import { confirmEvidence, createEvidenceIntent as createIntent, deleteEvidence, listEvidence } from "../lib/evidence";
import {
  asyncHandler, HttpError, notFound, notify, paginated, pagination, writeAuditLog,
} from "../lib/workspace";

const router: IRouter = Router();
router.use(requireAuth);
router.use(requireAppAccess("lessons"));
router.use("/forms", (req, res, next) =>
  requirePermission("lessons", "lessons", req.method === "GET" ? "select" : "own")(req, res, next));
router.use("/evidence", (req, res, next) =>
  requirePermission("lessons", "lessons", req.method === "GET" ? "select" : "own")(req, res, next));
router.use("/forms", asyncHandler(async (req, _res, next) => {
  if (req.method !== "GET") {
    const orgId = req.currentUser!.organizationId;
    if (typeof req.body?.projectId === "string") await assertProjectInOrg(db, orgId, req.body.projectId);
    if (typeof req.body?.disciplineId === "string") await assertDisciplineInOrg(db, "lessons", orgId, req.body.disciplineId);
    if (typeof req.body?.approverId === "string") await assertUserInOrg(db, orgId, req.body.approverId);
  }
  next();
}));

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const aiSettings = new Map<string, {
  enabled: boolean; features: Record<string, boolean>; provider: string; model: string;
  timeoutSeconds: number; stripPersonalData?: boolean; retentionDays?: number; monthlyQuota?: number;
}>();
const promptSessions = new Map<string, {
  organizationId: string; actorId: string; extracted: Record<string, unknown>;
  missing: Array<{ field: string; question: string; options: string[] }>; expiresAt: number;
}>();

function invalid(res: Parameters<Parameters<typeof router.post>[1]>[1], message: string) {
  res.status(422).json({ error: message });
}

function parseBody<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, req: any, res: any): T | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.issues[0]?.message ?? "Invalid request body");
    return null;
  }
  return parsed.data;
}

function publicState(state: string) {
  return state === "sent_back" ? "Sent Back" : state.charAt(0).toUpperCase() + state.slice(1);
}

function formJson(row: typeof lessonLearnedForms.$inferSelect, photos?: Array<typeof lessonsEvidenceFiles.$inferSelect>) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    projectId: row.projectId,
    title: row.title,
    disciplineId: row.disciplineId ?? "",
    categorisationId: row.categorisation ?? "",
    issueCategory: row.issueCategory,
    impact: row.impact,
    description: row.description ?? "",
    rootCause: row.rootCause ?? "",
    correction: row.correction ?? "",
    correctiveAction: row.correctiveAction ?? "",
    isRepeatedIssue: row.isRepeated,
    repeatCount: row.repeatCount,
    repeatLocation: row.repeatLocation,
    capturedAt: row.capturedAt,
    gpsLat: row.gpsLat === null ? null : Number(row.gpsLat),
    gpsLng: row.gpsLng === null ? null : Number(row.gpsLng),
    creatorId: row.creatorId,
    approverId: row.approverId,
    version: row.version,
    conflictFlag: row.conflictFlag,
    workflowState: publicState(row.workflowState),
    remarks: null,
    ...(photos ? { photos: photos.map(evidenceJson) } : {}),
  };
}

function evidenceJson(row: typeof lessonsEvidenceFiles.$inferSelect) {
  return {
    id: row.id, recordType: row.recordType, recordId: row.recordId, category: row.category,
    fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes,
    status: row.status === "uploading" ? "pending" : row.status === "stored" ? "confirmed" : "failed",
    clientReference: row.clientReference ?? "", storageUrl: row.status === "stored" ? `/api/files/${row.id}` : null,
    gpsLat: null, gpsLng: null, createdAt: row.createdAt,
  };
}

async function getForm(id: string, organizationId: string) {
  const [row] = await db.select().from(lessonLearnedForms).where(and(
    eq(lessonLearnedForms.id, id), eq(lessonLearnedForms.organizationId, organizationId),
    isNull(lessonLearnedForms.deletedAt),
  )).limit(1);
  return row ?? null;
}

async function audit(req: any, action: string, entityType: string, entityId?: string, before?: Record<string, unknown>, after?: Record<string, unknown>) {
  await writeAuditLog(db, "lessons", {
    organizationId: req.currentUser.organizationId, actorId: req.currentUser.id,
    action, entityType, entityId, before, after, ipAddress: req.ip,
  });
}

router.get("/reference-data", asyncHandler(async (req, res) => {
  const user = req.currentUser!;
  const since = typeof req.query.since === "string" ? new Date(req.query.since) : null;
  if (since && Number.isNaN(since.valueOf())) throw new HttpError(422, "Invalid since timestamp");
  const [projectRows, disciplineRows, categoryRows] = await Promise.all([
    db.select().from(projects).where(and(eq(projects.organizationId, user.organizationId), isNull(projects.deletedAt), since ? gt(projects.updatedAt, since) : undefined)),
    db.select().from(lessonsDisciplines).where(and(eq(lessonsDisciplines.organizationId, user.organizationId), isNull(lessonsDisciplines.deletedAt), since ? gt(lessonsDisciplines.updatedAt, since) : undefined)),
    db.select().from(lessonsCategorisationRiskMaster).where(and(eq(lessonsCategorisationRiskMaster.organizationId, user.organizationId), isNull(lessonsCategorisationRiskMaster.deletedAt), since ? gt(lessonsCategorisationRiskMaster.updatedAt, since) : undefined)),
  ]);
  res.json({
    generatedAt: new Date(),
    projects: projectRows.map((p) => ({ id: p.id, code: p.code, name: p.name, businessUnit: "Unassigned", status: p.status, location: p.location })),
    disciplines: disciplineRows.map((d) => ({ id: d.id, code: d.code, name: d.name, active: d.status === "active" })),
    categorisation: categoryRows.map((c) => ({ id: c.id, code: null, name: c.category, active: c.status === "active", metadata: { impact: c.impact, riskLevel: c.riskLevel } })),
  });
}));

router.get("/forms", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonLearnedForms.organizationId, req.currentUser!.organizationId), isNull(lessonLearnedForms.deletedAt));
  const [rows, count] = await Promise.all([
    db.select().from(lessonLearnedForms).where(where).orderBy(desc(lessonLearnedForms.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(where),
  ]);
  res.json(paginated(rows.map((row) => formJson(row)), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/forms", asyncHandler(async (req, res) => {
  const body = parseBody(CreateLessonFormBody, req, res);
  if (!body) return;
  const user = req.currentUser!;
  await Promise.all([
    assertLovValue(db, user.organizationId, "lesson_issue_categories", body.issueCategory),
    assertLovValue(db, user.organizationId, "lesson_impacts", body.impact),
  ]);
  const clientReference = body.id;
  const [existing] = await db.select().from(lessonLearnedForms).where(and(
    eq(lessonLearnedForms.organizationId, user.organizationId),
    eq(lessonLearnedForms.clientReference, clientReference), isNull(lessonLearnedForms.deletedAt),
  )).limit(1);
  if (existing) { res.status(200).json(formJson(existing)); return; }
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, body.projectId), eq(projects.organizationId, user.organizationId), isNull(projects.deletedAt),
  )).limit(1);
  if (!project) notFound("Project not found");
  let created: typeof lessonLearnedForms.$inferSelect | undefined;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(and(
      eq(lessonLearnedForms.organizationId, user.organizationId), eq(lessonLearnedForms.projectId, body.projectId),
    ));
    const referenceNumber = `LL-${project.code}-${Number(count ?? 0) + 1 + attempt}`;
    try {
      [created] = await db.insert(lessonLearnedForms).values({
        organizationId: user.organizationId, projectId: body.projectId,
        disciplineId: body.disciplineId, referenceNumber, title: body.title,
        categorisation: body.categorisationId, issueCategory: body.issueCategory, impact: body.impact,
        capturedAt: new Date(), gpsLat: body.gpsLat?.toString(), gpsLng: body.gpsLng?.toString(),
        gpsLocation: body.gpsLat != null && body.gpsLng != null ? { lat: body.gpsLat, lng: body.gpsLng } : undefined,
        clientReference, version: 1, conflictFlag: false, description: body.description,
        rootCause: body.rootCause, correction: body.correction, correctiveAction: body.correctiveAction,
        isRepeated: body.isRepeatedIssue ?? false, repeatCount: body.repeatCount ?? 0,
        repeatLocation: body.repeatLocation, workflowState: "draft", creatorId: user.id,
        approverId: body.approverId,
      }).returning();
    } catch (error) {
      if (!(error instanceof Error) || !/unique|duplicate/i.test(error.message)) throw error;
    }
  }
  if (!created) throw new HttpError(409, "Unable to allocate a unique reference number");
  await audit(req, "create", "lesson_form", created.id, undefined, formJson(created));
  res.status(201).json(formJson(created));
}));

router.get("/forms/:id", asyncHandler(async (req, res) => {
  const row = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Lesson form not found");
  const photos = await listEvidence(db, "lessons", req.currentUser!.organizationId, "lesson_form", row.id);
  res.json(formJson(row, photos));
}));

router.put("/forms/:id", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonFormBody, req, res);
  if (!body) return;
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  assertOwnerOrFull(req, before.creatorId);
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Only draft or sent-back forms may be edited");
  await Promise.all([
    assertLovValue(db, req.currentUser!.organizationId, "lesson_issue_categories", body.issueCategory, { allowLegacy: before.issueCategory }),
    assertLovValue(db, req.currentUser!.organizationId, "lesson_impacts", body.impact, { allowLegacy: before.impact }),
  ]);
  const [row] = await db.update(lessonLearnedForms).set({
    projectId: body.projectId, disciplineId: body.disciplineId, title: body.title,
    categorisation: body.categorisationId, issueCategory: body.issueCategory, impact: body.impact,
    description: body.description, rootCause: body.rootCause, correction: body.correction,
    correctiveAction: body.correctiveAction, isRepeated: body.isRepeatedIssue ?? false,
    repeatCount: body.repeatCount ?? 0, repeatLocation: body.repeatLocation,
    approverId: body.approverId, version: before.workflowState === "sent_back" ? before.version + 1 : before.version,
    workflowState: before.workflowState === "sent_back" ? "draft" : before.workflowState, updatedAt: new Date(),
  }).where(eq(lessonLearnedForms.id, before.id)).returning();
  await audit(req, "update", "lesson_form", row!.id, formJson(before), formJson(row!));
  res.json(formJson(row!));
}));

router.delete("/forms/:id", asyncHandler(async (req, res) => {
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  assertOwnerOrFull(req, before.creatorId);
  await db.update(lessonLearnedForms).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() }).where(eq(lessonLearnedForms.id, before.id));
  await audit(req, "delete", "lesson_form", before.id, formJson(before));
  res.status(204).end();
}));

router.post("/forms/:id/submit", asyncHandler(async (req, res) => {
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  assertOwnerOrFull(req, before.creatorId);
  if (before.workflowState !== "draft") throw new HttpError(409, "Only draft forms may be submitted");
  if (!before.approverId) throw new HttpError(422, "An approver is required before submission");
  const [row] = await db.update(lessonLearnedForms).set({ workflowState: "submitted", updatedAt: new Date() }).where(eq(lessonLearnedForms.id, before.id)).returning();
  await audit(req, "submit", "lesson_form", before.id, formJson(before), formJson(row!));
  await notify(db, "lessons", { organizationId: before.organizationId, userId: before.approverId, type: "lesson_submitted", title: "Lesson awaiting approval", body: `${before.referenceNumber} is ready for review.`, entityType: "lesson_form", entityId: before.id });
  res.json(formJson(row!));
}));

router.post("/forms/:id/review", asyncHandler(async (req, res) => {
  const body = parseBody(ReviewLessonFormBody, req, res);
  if (!body) return;
  if (body.decision === "send_back" && !body.comments?.trim()) throw new HttpError(422, "Comments are required when sending a form back");
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  if (!req.permissionAdminBypass && before.approverId !== req.currentUser!.id) {
    throw new HttpError(403, "Only the designated approver may review this form");
  }
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted forms may be reviewed");
  const state = body.decision === "approve" ? "approved" : "sent_back";
  const [row] = await db.update(lessonLearnedForms).set({ workflowState: state, updatedAt: new Date() }).where(eq(lessonLearnedForms.id, before.id)).returning();
  await db.update(lessonEscalationInstances).set({
    status: body.decision === "approve" ? "resolved" : "open",
    resolvedAt: body.decision === "approve" ? new Date() : null,
    stateNote: body.decision === "approve"
      ? "Lesson approved; escalation resolved"
      : `Sent back for rework; SLA clock continues${body.comments?.trim() ? `: ${body.comments.trim()}` : ""}`,
    updatedAt: new Date(),
  } as any).where(and(
    eq(lessonEscalationInstances.organizationId, before.organizationId),
    eq(lessonEscalationInstances.recordId, before.id),
    eq(lessonEscalationInstances.status, "open"),
    isNull(lessonEscalationInstances.deletedAt),
  ));
  await audit(req, body.decision, "lesson_form", before.id, formJson(before), { ...formJson(row!), remarks: body.comments });
  await notify(db, "lessons", { organizationId: before.organizationId, userId: before.creatorId, type: `lesson_${state}`, title: `Lesson ${publicState(state)}`, body: body.comments?.trim() || `${before.referenceNumber} was approved.`, entityType: "lesson_form", entityId: before.id });
  res.json({ ...formJson(row!), remarks: body.comments });
}));

async function createEvidenceIntent(req: any, body: { recordType: string; recordId: string; category: string; fileName: string; mimeType: string; sizeBytes: number; clientReference: string }) {
  try {
    return await createIntent({ app: "lessons", ...body, userId: req.currentUser.id, organizationId: req.currentUser.organizationId });
  } catch (error) {
    if (error instanceof Error && /limit|unsupported|positive integer/i.test(error.message)) throw new HttpError(422, error.message);
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      const [existing] = await db.select().from(lessonsEvidenceFiles).where(and(eq(lessonsEvidenceFiles.organizationId, req.currentUser.organizationId), eq(lessonsEvidenceFiles.clientReference, body.clientReference), isNull(lessonsEvidenceFiles.deletedAt))).limit(1);
      if (existing) return { id: existing.id, uploadUrl: `/api/files/${existing.id}` };
    }
    throw error;
  }
}

router.post("/forms/:id/photos", asyncHandler(async (req, res) => {
  const body = parseBody(CreateLessonPhotoIntentBody, req, res);
  if (!body) return;
  const form = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!form) notFound("Lesson form not found");
  if (!body.mimeType.startsWith("image/")) throw new HttpError(422, "Lesson photos must use an image MIME type");
  if (body.sizeBytes > MAX_PHOTO_BYTES) throw new HttpError(422, "Photo exceeds the 8MB limit");
  const current = await listEvidence(db, "lessons", form.organizationId, "lesson_form", form.id);
  if (current.filter((item: any) => item.category === body.category).length >= 5) throw new HttpError(409, `Maximum five ${body.category} photos are allowed`);
  const intent = await createEvidenceIntent(req, { ...body, recordType: "lesson_form", recordId: form.id });
  await audit(req, "create_photo_intent", "evidence", intent.id, undefined, body);
  res.status(201).json(intent);
}));

router.put("/photos/:id/confirm", asyncHandler(async (req, res) => {
  const row = await confirmEvidence(db, "lessons", String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Photo not found");
  await audit(req, "confirm", "evidence", row.id);
  res.json(evidenceJson(row));
}));

router.delete("/photos/:id", asyncHandler(async (req, res) => {
  const row = await deleteEvidence(db, "lessons", String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Photo not found");
  await audit(req, "delete", "evidence", row.id);
  res.status(204).end();
}));

function logWhere(req: any) {
  const q = req.query;
  const term = typeof q.search === "string" && q.search.trim() ? `%${q.search.trim()}%` : null;
  const from = typeof q.from === "string" ? new Date(q.from) : null;
  const to = typeof q.to === "string" ? new Date(q.to) : null;
  if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf()))) throw new HttpError(422, "Invalid date filter");
  return and(
    eq(lessonLearnedForms.organizationId, req.currentUser.organizationId), isNull(lessonLearnedForms.deletedAt),
    term ? or(ilike(lessonLearnedForms.title, term), ilike(lessonLearnedForms.description, term), ilike(lessonLearnedForms.rootCause, term), ilike(lessonLearnedForms.correctiveAction, term)) : undefined,
    typeof q.projectId === "string" ? eq(lessonLearnedForms.projectId, q.projectId) : undefined,
    typeof q.disciplineId === "string" ? eq(lessonLearnedForms.disciplineId, q.disciplineId) : undefined,
    typeof q.category === "string" ? eq(lessonLearnedForms.categorisation, q.category) : undefined,
    typeof q.impact === "string" ? eq(lessonLearnedForms.impact, q.impact) : undefined,
    from ? gte(lessonLearnedForms.capturedAt, from) : undefined, to ? lte(lessonLearnedForms.capturedAt, to) : undefined,
  );
}

router.get("/log", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = logWhere(req);
  const [rows, count] = await Promise.all([
    db.select().from(lessonLearnedForms).where(where).orderBy(desc(lessonLearnedForms.capturedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(where),
  ]);
  res.json(paginated(rows.map((row) => formJson(row)), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/ai/rephrase", asyncHandler(async (req, res) => {
  const body = parseBody(RephraseLessonFieldBody, req, res);
  if (!body) return;
  if (!["description", "rootCause", "correction", "correctiveAction"].includes(body.field)) throw new HttpError(422, "Unsupported lesson field");
  const suggestion = await rephraseText({ app: "lessons", organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, field: body.field, text: body.text, tone: "clear and concise" });
  res.json({ suggestion });
}));

const lessonSchema = "Fields: title, projectId, disciplineId, categorisationId, issueCategory (Minor|Moderate|Major), impact (Positive|Negative), description, rootCause, correction, correctiveAction. Infer values stated in a site incident paragraph; ask concise questions only for required fields that cannot be inferred.";
router.post("/ai/prompt-to-transaction", asyncHandler(async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) throw new HttpError(422, "Prompt is required");
  const result = await promptToTransaction({ app: "lessons", organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, prompt, schemaDescription: lessonSchema });
  const sessionId = randomUUID();
  const missing = result.missing.map((item) => ({ ...item, options: item.options ?? [] }));
  promptSessions.set(sessionId, { organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, extracted: result.extracted, missing, expiresAt: Date.now() + 15 * 60_000 });
  res.json({ extracted: result.extracted, missing, sessionId });
}));

router.post("/ai/prompt-to-transaction/:sessionId/answer", asyncHandler(async (req, res) => {
  const body = parseBody(AnswerLessonPromptQuestionBody, req, res);
  if (!body) return;
  const sessionId = String(req.params.sessionId);
  const session = promptSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now() || session.organizationId !== req.currentUser!.organizationId || session.actorId !== req.currentUser!.id) {
    promptSessions.delete(sessionId); notFound("Prompt session not found or expired");
  }
  session!.extracted[body.field] = body.value;
  session!.missing = session!.missing.filter((item) => item.field !== body.field);
  session!.expiresAt = Date.now() + 15 * 60_000;
  res.json({ extracted: session!.extracted, missing: session!.missing, sessionId });
}));

router.get("/escalations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonEscalationInstances.organizationId, req.currentUser!.organizationId), isNull(lessonEscalationInstances.deletedAt));
  const [rows, count, rules] = await Promise.all([
    db.select().from(lessonEscalationInstances).where(where).orderBy(desc(lessonEscalationInstances.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(lessonEscalationInstances).where(where),
    db.select().from(lessonEscalationRules).where(and(eq(lessonEscalationRules.organizationId, req.currentUser!.organizationId), isNull(lessonEscalationRules.deletedAt))),
  ]);
  res.json(paginated(rows.map((row) => {
    const rule = rules.find((r) => r.id === row.ruleId);
    return { id: row.id, recordType: row.recordType, recordId: row.recordId, priority: rule?.priority ?? "P1", level: String(rule?.configuration?.level ?? "P1"), dueAt: new Date(row.startedAt.getTime() + (rule?.slaWorkingDays ?? 0) * 86400000), status: row.status, lastNotifiedAt: row.breachedAt };
  }), Number(count[0]?.count ?? 0), page, limit));
}));

function csvCell(value: unknown) {
  const text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  return `${keys.map(csvCell).join(",")}\n${rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")).join("\n")}\n`;
}

router.get("/reports/log", asyncHandler(async (req, res) => {
  const format = typeof req.query.format === "string" ? req.query.format : "csv";
  if (format !== "csv" && format !== "json") throw new HttpError(422, "Only CSV and JSON exports are supported");
  const rows = await db.select().from(lessonLearnedForms).where(and(eq(lessonLearnedForms.organizationId, req.currentUser!.organizationId), isNull(lessonLearnedForms.deletedAt))).orderBy(asc(lessonLearnedForms.referenceNumber));
  const fileName = `lessons-log.${format}`;
  const content = format === "csv" ? csv(rows.map((r) => formJson(r))) : JSON.stringify(rows.map((r) => formJson(r)), null, 2);
  res.json({ delivery: "download", fileName, downloadUrl: `data:${format === "csv" ? "text/csv" : "application/json"};charset=utf-8,${encodeURIComponent(content)}`, message: null });
}));

router.get("/forms/:id/report", asyncHandler(async (req, res) => {
  const row = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Lesson form not found");
  const format = req.accepts(["json", "csv"]) ?? "json";
  const data = formJson(row);
  const content = format === "csv" ? csv([data]) : JSON.stringify(data, null, 2);
  const fileName = `${row.referenceNumber}.${format}`;
  res.json({ delivery: "download", fileName, downloadUrl: `data:${format === "csv" ? "text/csv" : "application/json"};charset=utf-8,${encodeURIComponent(content)}`, message: null });
}));

router.use("/admin", requireAdmin);

async function roleJson(row: typeof lessonsWorkspaceRoles.$inferSelect) {
  const permissionRows = await db.select({ key: lessonsPermissions.key, name: lessonsPermissions.label })
    .from(lessonsWorkspaceRolePermissions)
    .innerJoin(lessonsPermissions, eq(lessonsWorkspaceRolePermissions.permissionId, lessonsPermissions.id))
    .where(and(eq(lessonsWorkspaceRolePermissions.workspaceRoleId, row.id), isNull(lessonsWorkspaceRolePermissions.deletedAt), isNull(lessonsPermissions.deletedAt)));
  return { id: row.id, name: row.name, description: row.description, permissions: permissionRows, active: row.status === "active", systemDefault: row.isSystem };
}

router.get("/admin/roles", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonsWorkspaceRoles.organizationId, req.currentUser!.organizationId), isNull(lessonsWorkspaceRoles.deletedAt));
  const [rows, count] = await Promise.all([db.select().from(lessonsWorkspaceRoles).where(where).orderBy(asc(lessonsWorkspaceRoles.name)).limit(limit).offset(offset), db.select({ count: sql<number>`count(*)` }).from(lessonsWorkspaceRoles).where(where)]);
  res.json(paginated(await Promise.all(rows.map(roleJson)), Number(count[0]?.count ?? 0), page, limit));
}));

async function setRolePermissions(organizationId: string, roleId: string, requested: Array<{ key: string }>) {
  await db.update(lessonsWorkspaceRolePermissions).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() }).where(and(eq(lessonsWorkspaceRolePermissions.workspaceRoleId, roleId), isNull(lessonsWorkspaceRolePermissions.deletedAt)));
  const existing = await db.select().from(lessonsPermissions).where(and(eq(lessonsPermissions.organizationId, organizationId), inArray(lessonsPermissions.key, requested.map((p) => p.key)), isNull(lessonsPermissions.deletedAt)));
  const byKey = new Map(existing.map((p) => [p.key, p]));
  for (const item of requested) {
    let permission = byKey.get(item.key);
    if (!permission) [permission] = await db.insert(lessonsPermissions).values({ organizationId, key: item.key, label: item.key.replaceAll("_", " "), category: "workspace" }).returning();
    await db.insert(lessonsWorkspaceRolePermissions).values({ organizationId, workspaceRoleId: roleId, permissionId: permission!.id });
  }
}

router.post("/admin/roles", asyncHandler(async (req, res) => {
  const body = parseBody(CreateLessonsRoleBody, req, res); if (!body) return;
  const [row] = await db.insert(lessonsWorkspaceRoles).values({ organizationId: req.currentUser!.organizationId, name: body.name, description: body.description, isSystem: false, status: body.active ? "active" : "inactive" }).returning();
  await setRolePermissions(req.currentUser!.organizationId, row!.id, body.permissions);
  await audit(req, "create", "role", row!.id, undefined, await roleJson(row!));
  res.status(201).json(await roleJson(row!));
}));

router.put("/admin/roles/:id", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonsRoleBody, req, res); if (!body) return;
  const [before] = await db.select().from(lessonsWorkspaceRoles).where(and(eq(lessonsWorkspaceRoles.id, String(req.params.id)), eq(lessonsWorkspaceRoles.organizationId, req.currentUser!.organizationId), isNull(lessonsWorkspaceRoles.deletedAt))).limit(1);
  if (!before) notFound("Role not found");
  const [row] = await db.update(lessonsWorkspaceRoles).set({ name: body.name, description: body.description, status: body.active ? "active" : "inactive", updatedAt: new Date() }).where(eq(lessonsWorkspaceRoles.id, before!.id)).returning();
  await setRolePermissions(req.currentUser!.organizationId, row!.id, body.permissions);
  await audit(req, "update", "role", row!.id, await roleJson(before!), await roleJson(row!));
  res.json(await roleJson(row!));
}));

router.get("/admin/users", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(users.organizationId, req.currentUser!.organizationId), isNull(users.deletedAt));
  const [rows, count, assignments, roles, platform] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.username)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(users).where(where),
    db.select().from(lessonsUserWorkspaceRoles).where(and(eq(lessonsUserWorkspaceRoles.organizationId, req.currentUser!.organizationId), isNull(lessonsUserWorkspaceRoles.deletedAt))),
    db.select().from(lessonsWorkspaceRoles).where(and(eq(lessonsWorkspaceRoles.organizationId, req.currentUser!.organizationId), isNull(lessonsWorkspaceRoles.deletedAt))),
    db.select().from(platformRoles),
  ]);
  const rolePayload = new Map((await Promise.all(roles.map(roleJson))).map((r) => [r.id, r]));
  res.json(paginated(rows.map((u) => ({ id: u.id, username: u.username, email: u.email, platformRole: platform.find((p) => p.id === u.platformRoleId)?.name ?? "Employee", workspaceRoles: assignments.filter((a) => a.userId === u.id).map((a) => rolePayload.get(a.workspaceRoleId)).filter(Boolean), status: u.accessStatus === "active" ? "Active" : "Deactivated", lastAccessAt: u.lastAccessAt })), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/admin/users/:userId/roles", asyncHandler(async (req, res) => {
  const body = parseBody(AssignLessonsUserRoleBody, req, res); if (!body) return;
  const [target, role] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, req.currentUser!.organizationId), isNull(users.deletedAt))).limit(1),
    db.select().from(lessonsWorkspaceRoles).where(and(eq(lessonsWorkspaceRoles.id, body.roleId), eq(lessonsWorkspaceRoles.organizationId, req.currentUser!.organizationId), isNull(lessonsWorkspaceRoles.deletedAt))).limit(1),
  ]);
  if (!target[0] || !role[0]) notFound("User or role not found");
  const [existing] = await db.select().from(lessonsUserWorkspaceRoles).where(and(eq(lessonsUserWorkspaceRoles.userId, target[0]!.id), eq(lessonsUserWorkspaceRoles.workspaceRoleId, role[0]!.id), isNull(lessonsUserWorkspaceRoles.deletedAt))).limit(1);
  const scope = { businessUnitIds: body.scopeType === "business_unit" ? body.scopeIds : [], projectIds: body.scopeType === "project" ? body.scopeIds : [] };
  const [row] = existing ? await db.update(lessonsUserWorkspaceRoles).set({ ...scope, updatedAt: new Date() }).where(eq(lessonsUserWorkspaceRoles.id, existing.id)).returning() : await db.insert(lessonsUserWorkspaceRoles).values({ organizationId: req.currentUser!.organizationId, userId: target[0]!.id, workspaceRoleId: role[0]!.id, ...scope }).returning();
  await audit(req, "assign_role", "user_role", row!.id, undefined, { userId: target[0]!.id, ...body });
  res.json(row);
}));

router.get("/admin/access-queue", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(applicationAccess.organizationId, req.currentUser!.organizationId), eq(applicationAccess.canOpenLessons, false), isNull(applicationAccess.deletedAt));
  const [rows, count, role] = await Promise.all([
    db.select().from(applicationAccess).where(where).orderBy(desc(applicationAccess.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(applicationAccess).where(where),
    db.select().from(lessonsWorkspaceRoles).where(and(eq(lessonsWorkspaceRoles.organizationId, req.currentUser!.organizationId), isNull(lessonsWorkspaceRoles.deletedAt))).limit(1),
  ]);
  const userRows = rows.length ? await db.select().from(users).where(and(eq(users.organizationId, req.currentUser!.organizationId), inArray(users.username, rows.map((r) => r.username)))) : [];
  res.json(paginated(rows.map((r) => ({ id: r.id, userId: userRows.find((u) => u.username === r.username)?.id ?? r.id, requestedRoleId: role[0]?.id ?? r.id, status: "pending", requestedAt: r.createdAt })), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/admin/access-queue/:id/decision", asyncHandler(async (req, res) => {
  const body = parseBody(DecideLessonsAccessRequestBody, req, res); if (!body) return;
  const [before] = await db.select().from(applicationAccess).where(and(eq(applicationAccess.id, String(req.params.id)), eq(applicationAccess.organizationId, req.currentUser!.organizationId), isNull(applicationAccess.deletedAt))).limit(1);
  if (!before) notFound("Access request not found");
  const [row] = await db.update(applicationAccess).set({ canOpenLessons: body.decision === "approve", status: body.decision === "reject" ? "rejected" : "active", updatedAt: new Date() }).where(eq(applicationAccess.id, before!.id)).returning();
  await audit(req, `access_${body.decision}`, "access_request", row!.id, before as any, { ...row, comments: body.comments } as any);
  res.json(row);
}));

router.get("/admin/delegations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonDelegations.organizationId, req.currentUser!.organizationId), isNull(lessonDelegations.deletedAt));
  const [rows, count] = await Promise.all([db.select().from(lessonDelegations).where(where).orderBy(desc(lessonDelegations.startsAt)).limit(limit).offset(offset), db.select({ count: sql<number>`count(*)` }).from(lessonDelegations).where(where)]);
  res.json(paginated(rows.map((r) => ({ id: r.id, delegatorId: r.delegatorId, delegateId: r.delegateId, scope: JSON.stringify(r.scope), approvalTypes: Array.isArray(r.scope.approvalTypes) ? r.scope.approvalTypes : [], startDate: r.startsAt, endDate: r.endsAt, status: r.status, revokedAt: r.status === "revoked" ? r.updatedAt : null })), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/admin/delegations", asyncHandler(async (req, res) => {
  const body = parseBody(CreateLessonsDelegationBody, req, res); if (!body) return;
  if (body.endDate <= body.startDate) throw new HttpError(422, "End date must be after start date");
  const [row] = await db.insert(lessonDelegations).values({ organizationId: req.currentUser!.organizationId, delegatorId: body.delegatorId, delegateId: body.delegateId, startsAt: body.startDate, endsAt: body.endDate, scope: { value: body.scope, approvalTypes: body.approvalTypes ?? [] }, status: body.status }).returning();
  await audit(req, "create", "delegation", row!.id, undefined, row as any);
  res.status(201).json(row);
}));

router.delete("/admin/delegations/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(lessonDelegations).set({ deletedAt: new Date(), status: "revoked", updatedAt: new Date() }).where(and(eq(lessonDelegations.id, String(req.params.id)), eq(lessonDelegations.organizationId, req.currentUser!.organizationId), isNull(lessonDelegations.deletedAt))).returning();
  if (!row) notFound("Delegation not found");
  await audit(req, "revoke", "delegation", row.id);
  res.status(204).end();
}));

function escalationRuleJson(r: typeof lessonEscalationRules.$inferSelect) {
  return { id: r.id, triggerType: r.triggerKey, priority: r.priority, level: typeof r.configuration.level === "string" ? r.configuration.level : null, slaWorkingDays: r.slaWorkingDays, recipientRoles: [r.recipientRole], repeatCadenceDays: r.repeatCadenceDays ?? 2, enabled: r.status === "active" };
}
router.get("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const rows = await db.select().from(lessonEscalationRules).where(and(eq(lessonEscalationRules.organizationId, req.currentUser!.organizationId), isNull(lessonEscalationRules.deletedAt))).orderBy(asc(lessonEscalationRules.slaWorkingDays));
  res.json(paginated(rows.map(escalationRuleJson), rows.length, 1, Math.max(1, rows.length)));
}));
router.put("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonsEscalationRulesBody, req, res); if (!body) return;
  const org = req.currentUser!.organizationId;
  await db.update(lessonEscalationRules).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() }).where(and(eq(lessonEscalationRules.organizationId, org), isNull(lessonEscalationRules.deletedAt)));
  const rows = body.length ? await db.insert(lessonEscalationRules).values(body.map((r) => ({ organizationId: org, triggerKey: r.triggerType, priority: r.priority, slaWorkingDays: r.slaWorkingDays, recipientRole: r.recipientRoles.join(","), repeatCadenceDays: r.repeatCadenceDays, configuration: { level: r.level }, status: r.enabled ? "active" : "inactive" }))).returning() : [];
  await audit(req, "replace", "escalation_rules", undefined, undefined, { count: rows.length });
  res.json(rows.map(escalationRuleJson));
}));

function getAiSettings(org: string) {
  return aiSettings.get(org) ?? { enabled: true, features: { rephrase: true, promptToTransaction: true }, provider: "Anthropic", model: "claude-sonnet-5", timeoutSeconds: 10, stripPersonalData: true, retentionDays: 365, monthlyQuota: 1000 };
}
router.get("/admin/ai-settings", asyncHandler(async (req, res) => { res.json(getAiSettings(req.currentUser!.organizationId)); }));
router.put("/admin/ai-settings", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonsAiSettingsBody, req, res); if (!body) return;
  aiSettings.set(req.currentUser!.organizationId, body);
  await audit(req, "update", "ai_settings", undefined, undefined, body);
  res.json(body);
}));

router.get("/admin/audit-log", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const where = and(eq(lessonsAuditLogEntries.organizationId, req.currentUser!.organizationId), typeof req.query.actorId === "string" ? eq(lessonsAuditLogEntries.actorId, req.query.actorId) : undefined, typeof req.query.action === "string" ? eq(lessonsAuditLogEntries.action, req.query.action) : undefined, from ? gte(lessonsAuditLogEntries.createdAt, from) : undefined, to ? lte(lessonsAuditLogEntries.createdAt, to) : undefined);
  const [rows, count] = await Promise.all([db.select().from(lessonsAuditLogEntries).where(where).orderBy(desc(lessonsAuditLogEntries.createdAt)).limit(limit).offset(offset), db.select({ count: sql<number>`count(*)` }).from(lessonsAuditLogEntries).where(where)]);
  res.json(paginated(rows.map((r) => ({ id: r.id, actorId: r.actorId ?? "", delegatedForId: null, action: r.action, entityType: r.entityType, entityId: r.entityId ?? "", before: r.before, after: r.after, ipAddress: typeof r.after?._requestIp === "string" ? r.after._requestIp : null, occurredAt: r.createdAt })), Number(count[0]?.count ?? 0), page, limit));
}));

router.get("/admin/notification-templates", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonsNotificationTemplates.organizationId, req.currentUser!.organizationId), isNull(lessonsNotificationTemplates.deletedAt));
  const [rows, count] = await Promise.all([db.select().from(lessonsNotificationTemplates).where(where).orderBy(asc(lessonsNotificationTemplates.key)).limit(limit).offset(offset), db.select({ count: sql<number>`count(*)` }).from(lessonsNotificationTemplates).where(where)]);
  res.json(paginated(rows.map((r) => ({ id: r.id, key: r.key, subject: r.subject, body: r.bodyTemplate, channels: [r.channel], enabled: r.enabled })), Number(count[0]?.count ?? 0), page, limit));
}));
router.put("/admin/notification-templates/:id", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonsNotificationTemplateBody, req, res); if (!body) return;
  if (!body.channels.includes("in_app") && !body.channels.includes("email")) throw new HttpError(422, "At least one supported channel is required");
  const [before] = await db.select().from(lessonsNotificationTemplates).where(and(eq(lessonsNotificationTemplates.id, String(req.params.id)), eq(lessonsNotificationTemplates.organizationId, req.currentUser!.organizationId), isNull(lessonsNotificationTemplates.deletedAt))).limit(1);
  if (!before) notFound("Notification template not found");
  const [row] = await db.update(lessonsNotificationTemplates).set({ key: body.key, subject: body.subject, bodyTemplate: body.body, channel: body.channels.includes("in_app") ? "in_app" : "email", enabled: body.enabled, updatedAt: new Date() }).where(eq(lessonsNotificationTemplates.id, before!.id)).returning();
  await audit(req, "update", "notification_template", row!.id, before as any, row as any);
  res.json({ id: row!.id, key: row!.key, subject: row!.subject, body: row!.bodyTemplate, channels: [row!.channel], enabled: row!.enabled });
}));

// Leave the admin namespace before user-facing notification/evidence routes.
router.get("/notifications", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonNotifications.organizationId, req.currentUser!.organizationId), eq(lessonNotifications.recipientId, req.currentUser!.id), isNull(lessonNotifications.deletedAt));
  const [rows, count] = await Promise.all([db.select().from(lessonNotifications).where(where).orderBy(desc(lessonNotifications.createdAt)).limit(limit).offset(offset), db.select({ count: sql<number>`count(*)` }).from(lessonNotifications).where(where)]);
  res.json(paginated(rows.map((r) => ({ id: r.id, type: "notification", title: r.title, message: r.body, critical: false, read: !!r.readAt, recordType: null, recordId: null, createdAt: r.createdAt, readAt: r.readAt })), Number(count[0]?.count ?? 0), page, limit));
}));
router.post("/notifications/:id/read", asyncHandler(async (req, res) => {
  const [row] = await db.update(lessonNotifications).set({ readAt: new Date(), updatedAt: new Date() }).where(and(eq(lessonNotifications.id, String(req.params.id)), eq(lessonNotifications.organizationId, req.currentUser!.organizationId), eq(lessonNotifications.recipientId, req.currentUser!.id), isNull(lessonNotifications.deletedAt))).returning();
  if (!row) notFound("Notification not found");
  await audit(req, "mark_read", "notification", row.id);
  res.status(204).end();
}));

router.get("/evidence", asyncHandler(async (req, res) => {
  if (typeof req.query.recordType !== "string" || typeof req.query.recordId !== "string") throw new HttpError(422, "recordType and recordId are required");
  const { page, limit } = pagination(req);
  const rows = await listEvidence(db, "lessons", req.currentUser!.organizationId, req.query.recordType, req.query.recordId);
  const start = (page - 1) * limit;
  res.json(paginated(rows.slice(start, start + limit).map(evidenceJson), rows.length, page, limit));
}));
router.post("/evidence", asyncHandler(async (req, res) => {
  const body = parseBody(CreateLessonsEvidenceIntentBody, req, res); if (!body) return;
  if (body.recordType !== "lesson_form") throw new HttpError(422, "Unsupported evidence record type");
  const form = await getForm(body.recordId, req.currentUser!.organizationId);
  if (!form) throw new HttpError(422, "Evidence record does not belong to this organization");
  assertOwnerOrFull(req, form.creatorId);
  const intent = await createEvidenceIntent(req, body);
  await audit(req, "create_intent", "evidence", intent.id, undefined, body);
  res.status(201).json(intent);
}));
router.put("/evidence/:id/confirm", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(lessonsEvidenceFiles).where(and(
    eq(lessonsEvidenceFiles.id, String(req.params.id)),
    eq(lessonsEvidenceFiles.organizationId, req.currentUser!.organizationId),
    isNull(lessonsEvidenceFiles.deletedAt),
  )).limit(1);
  if (!before) notFound("Evidence not found");
  assertOwnerOrFull(req, before.uploadedById);
  const row = await confirmEvidence(db, "lessons", String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Evidence not found");
  await audit(req, "confirm", "evidence", row.id);
  res.json(evidenceJson(row));
}));
router.delete("/evidence/:id", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(lessonsEvidenceFiles).where(and(
    eq(lessonsEvidenceFiles.id, String(req.params.id)),
    eq(lessonsEvidenceFiles.organizationId, req.currentUser!.organizationId),
    isNull(lessonsEvidenceFiles.deletedAt),
  )).limit(1);
  if (!before) notFound("Evidence not found");
  assertOwnerOrFull(req, before.uploadedById);
  const row = await deleteEvidence(db, "lessons", String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Evidence not found");
  await audit(req, "delete", "evidence", row.id);
  res.status(204).end();
}));

export default router;