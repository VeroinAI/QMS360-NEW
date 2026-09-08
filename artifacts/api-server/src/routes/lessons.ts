import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  and, asc, desc, eq, gte, gt, ilike, inArray, isNull, lte, ne, or, sql,
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
  UpdateLessonsAdminFieldControlsBody,
  UpdateLessonsAiSettingsBody,
  UpdateLessonsEscalationRulesBody,
  UpdateLessonsNotificationTemplateBody,
  UpdateLessonsRoleBody,
  UpdateLessonsUserProfileBody,
  CreateApproverScopeBody,
} from "@workspace/api-zod";
import {
  applicationAccess,
  db,
  lessonDelegations,
  lessonEscalationInstances,
  lessonApproverScopes,
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
import { allocateReferenceNumber } from "../lib/numbering";
import { assertOwnerOrFull, requireAppAccess, requirePermission } from "../middlewares/rbac";
import { assertLovValue } from "../lib/lov";
import { assertFieldAccess } from "../lib/field-access";
import { assertFieldControls, assertKnownFieldControlKeys, readFieldControls, writeFieldControls, type FieldControlsMatrix } from "../lib/field-controls";
import { assertProjectInOrg, assertUserInOrg } from "../lib/tenancy";
import { AiUnavailableError, promptToTransaction, rephraseText } from "../lib/ai";
import { confirmEvidence, createEvidenceIntent as createIntent, deleteEvidence, listEvidence } from "../lib/evidence";
import { getObject, storeObject } from "../lib/objectStorage";
import {
  asyncHandler, HttpError, notFound, notify, paginated, pagination, writeAuditLog,
} from "../lib/workspace";
import { notifyWithEmail, staffedRoleNames } from "../lib/workspace";

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

function formJson(row: typeof lessonLearnedForms.$inferSelect, photos?: Array<typeof lessonsEvidenceFiles.$inferSelect>, disciplineName?: string) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    reference: row.reference,
    projectId: row.projectId,
    title: row.title,
    // Clients bind discipline to the LOV value (name), not the internal UUID.
    disciplineId: disciplineName ?? row.disciplineId ?? "",
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
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewDecision: row.reviewDecision,
    reviewComments: row.reviewComments,
    gpsLat: row.gpsLat === null ? null : Number(row.gpsLat),
    gpsLng: row.gpsLng === null ? null : Number(row.gpsLng),
    creatorId: row.creatorId,
    approverId: row.approverId,
    version: row.version,
    conflictFlag: row.conflictFlag,
    workflowState: publicState(row.workflowState),
    remarks: row.remarks,
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

/** Internal discipline UUID -> LOV name shown to clients. Undefined when unknown, so callers fall back to the raw value. */
async function disciplineNameById(disciplineId: string | null): Promise<string | undefined> {
  if (!disciplineId) return undefined;
  const [row] = await db.select({ name: lessonsDisciplines.name }).from(lessonsDisciplines).where(and(
    eq(lessonsDisciplines.id, disciplineId), isNull(lessonsDisciplines.deletedAt),
  )).limit(1);
  return row?.name;
}

/** Approval-record user details (name, designation, signature URL) for submitter and reviewer. */
async function approvalPeopleJson(row: typeof lessonLearnedForms.$inferSelect) {
  const ids = [row.submittedById, row.reviewedById].filter((v): v is string => Boolean(v));
  const rows = ids.length
    ? await db.select().from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt)))
    : [];
  const byId = new Map(rows.map((u) => [u.id, u]));
  const person = (id: string | null) => {
    const u = id ? byId.get(id) : undefined;
    return {
      name: u?.fullName ?? null,
      designation: u?.designation ?? null,
      signatureUrl: u?.signaturePath ? `/api/lessons/users/${u.id}/signature` : null,
    };
  };
  const submitter = person(row.submittedById);
  const reviewer = person(row.reviewedById);
  return {
    submittedAt: row.submittedAt,
    submittedByName: submitter.name,
    submittedByDesignation: submitter.designation,
    submittedBySignatureUrl: submitter.signatureUrl,
    reviewedAt: row.reviewedAt,
    reviewedByName: reviewer.name,
    reviewedByDesignation: reviewer.designation,
    reviewedBySignatureUrl: reviewer.signatureUrl,
    reviewDecision: row.reviewDecision,
    reviewComments: row.reviewComments,
  };
}

async function formJsonNamed(row: typeof lessonLearnedForms.$inferSelect, photos?: Array<typeof lessonsEvidenceFiles.$inferSelect>) {
  const [disciplineName, approval] = await Promise.all([disciplineNameById(row.disciplineId), approvalPeopleJson(row)]);
  return { ...formJson(row, photos, disciplineName), ...approval };
}

async function disciplineNameMap(organizationId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: lessonsDisciplines.id, name: lessonsDisciplines.name }).from(lessonsDisciplines).where(and(
    eq(lessonsDisciplines.organizationId, organizationId), isNull(lessonsDisciplines.deletedAt),
  ));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** formJson for list endpoints: resolves discipline UUIDs to LOV names with one query. */
function formJsonList(rows: Array<typeof lessonLearnedForms.$inferSelect>, names: Map<string, string>) {
  return rows.map((row) => formJson(row, undefined, row.disciplineId ? names.get(row.disciplineId) : undefined));
}

async function audit(req: any, action: string, entityType: string, entityId?: string, before?: Record<string, unknown>, after?: Record<string, unknown>) {
  await writeAuditLog(db, "lessons", {
    organizationId: req.currentUser.organizationId, actorId: req.currentUser.id,
    action, entityType, entityId, before, after, ipAddress: req.ip,
  });
}

// Read-only discipline lookup for query-time scope filtering: accepts either
// the discipline name (LOV value) or its UUID. Unlike resolveLessonsDisciplineId
// it never creates reference rows — a GET must not mutate master data.
async function findLessonsDisciplineId(organizationId: string, value: string): Promise<string | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const [row] = await db.select({ id: lessonsDisciplines.id }).from(lessonsDisciplines).where(and(
    eq(lessonsDisciplines.organizationId, organizationId),
    isUuid ? or(eq(lessonsDisciplines.name, value), eq(lessonsDisciplines.id, value)) : eq(lessonsDisciplines.name, value),
    isNull(lessonsDisciplines.deletedAt),
  )).limit(1);
  return row?.id ?? null;
}

async function resolveLessonsDisciplineId(organizationId: string, masterValue: string) {
  const [existing] = await db.select().from(lessonsDisciplines).where(and(
    eq(lessonsDisciplines.organizationId, organizationId),
    eq(lessonsDisciplines.name, masterValue),
    isNull(lessonsDisciplines.deletedAt),
  )).limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(lessonsDisciplines).values({
    organizationId,
    code: `MD-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: masterValue,
  }).returning({ id: lessonsDisciplines.id });
  return created!.id;
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

type EligibleApprover = { id: string; fullName: string; email: string; roles: string[] };

async function eligibleApprovers(organizationId: string): Promise<EligibleApprover[]> {
  const rows = await db.select({
    id: users.id,
    fullName: users.fullName,
    email: users.email,
    platformRole: platformRoles.name,
    workspaceRole: lessonsWorkspaceRoles.name,
  })
    .from(users)
    .leftJoin(platformRoles, eq(users.platformRoleId, platformRoles.id))
    .leftJoin(lessonsUserWorkspaceRoles, and(
      eq(lessonsUserWorkspaceRoles.userId, users.id),
      isNull(lessonsUserWorkspaceRoles.deletedAt),
    ))
    .leftJoin(lessonsWorkspaceRoles, and(
      eq(lessonsWorkspaceRoles.id, lessonsUserWorkspaceRoles.workspaceRoleId),
      isNull(lessonsWorkspaceRoles.deletedAt),
      eq(lessonsWorkspaceRoles.status, "active"),
    ))
    .where(and(
      eq(users.organizationId, organizationId),
      eq(users.accessStatus, "active"),
      isNull(users.deletedAt),
    ));
  const byUser = new Map<string, { fullName: string; email: string; platformRole: string | null; roles: Set<string> }>();
  for (const row of rows) {
    const entry = byUser.get(row.id) ?? { fullName: row.fullName, email: row.email, platformRole: row.platformRole, roles: new Set<string>() };
    if (row.workspaceRole) entry.roles.add(row.workspaceRole);
    byUser.set(row.id, entry);
  }
  const isApproverRole = (name: string) => /approv/i.test(name) || /\b(admin|administrator)\b/i.test(name);
  return [...byUser.entries()]
    .filter(([, entry]) => ["Super Admin", "Org Admin"].includes(entry.platformRole ?? "") || [...entry.roles].some(isApproverRole))
    .map(([id, entry]) => ({ id, fullName: entry.fullName, email: entry.email, roles: [...entry.roles].sort() }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

type ApproverScopeCtx = { projectId?: string | null; disciplineId?: string | null; categorisation?: string | null };

function scopeMatches(rule: { projectId: string | null; disciplineId: string | null; categorisation: string | null }, ctx: ApproverScopeCtx) {
  return (!rule.projectId || rule.projectId === (ctx.projectId ?? null))
    && (!rule.disciplineId || rule.disciplineId === (ctx.disciplineId ?? null))
    && (!rule.categorisation || rule.categorisation === (ctx.categorisation ?? null));
}

// Null means the organization has no scope rules — every eligible approver may
// approve anything (legacy behavior). Once at least one active rule exists,
// only users with a matching rule qualify; blank rule dimensions match all.
async function scopedApproverIds(organizationId: string, ctx: ApproverScopeCtx): Promise<Set<string> | null> {
  const rules = await db.select().from(lessonApproverScopes).where(and(
    eq(lessonApproverScopes.organizationId, organizationId),
    eq(lessonApproverScopes.status, "active"),
    isNull(lessonApproverScopes.deletedAt),
  ));
  if (!rules.length) return null;
  return new Set(rules.filter((rule) => scopeMatches(rule, ctx)).map((rule) => rule.userId));
}

async function canReadLesson(req: any, row: typeof lessonLearnedForms.$inferSelect): Promise<boolean> {
  if (req.permissionAdminBypass || req.permissionScope === "full") return true;
  const user = req.currentUser!;
  if (row.creatorId === user.id) return true;
  if (row.approverId !== user.id) return false;
  const scoped = await scopedApproverIds(row.organizationId, {
    projectId: row.projectId, disciplineId: row.disciplineId, categorisation: row.categorisation,
  });
  return !scoped || scoped.has(user.id);
}

async function lessonVisibilityWhere(req: any, base: any, requireApproverScope = false) {
  const user = req.currentUser!;
  // Pending queues remain scope-bound even for full readers: assignment does
  // not override explicitly configured approver policy.
  if (!requireApproverScope && (req.permissionAdminBypass || req.permissionScope === "full")) return base;
  const rules = await db.select().from(lessonApproverScopes).where(and(
    eq(lessonApproverScopes.organizationId, user.organizationId),
    eq(lessonApproverScopes.status, "active"),
    isNull(lessonApproverScopes.deletedAt),
  ));
  const matchingScope = !rules.length ? undefined : or(...rules
    .filter((rule) => rule.userId === user.id)
    .map((rule) => and(
      rule.projectId ? eq(lessonLearnedForms.projectId, rule.projectId) : undefined,
      rule.disciplineId ? eq(lessonLearnedForms.disciplineId, rule.disciplineId) : undefined,
      rule.categorisation ? eq(lessonLearnedForms.categorisation, rule.categorisation) : undefined,
    ))) ?? sql`false`;
  const assigned = and(eq(lessonLearnedForms.approverId, user.id), matchingScope);
  return and(base, requireApproverScope ? assigned : or(eq(lessonLearnedForms.creatorId, user.id), assigned));
}

router.get("/approvers", asyncHandler(async (req, res) => {
  const organizationId = req.currentUser!.organizationId;
  const ctx: ApproverScopeCtx = {
    projectId: typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : null,
    categorisation: typeof req.query.categorisation === "string" && req.query.categorisation ? req.query.categorisation : null,
    disciplineId: typeof req.query.discipline === "string" && req.query.discipline
      ? await findLessonsDisciplineId(organizationId, req.query.discipline)
      : null,
  };
  const scoped = await scopedApproverIds(organizationId, ctx);
  let approvers = await eligibleApprovers(organizationId);
  if (req.query.includeSelf !== "true") approvers = approvers.filter((approver) => approver.id !== req.currentUser!.id);
  if (scoped) approvers = approvers.filter((approver) => scoped.has(approver.id));
  res.json(approvers);
}));

async function assertEligibleApprover(req: any, approverId: string, creatorId: string | null, ctx: ApproverScopeCtx = {}) {
  // Self-approval is never allowed — not even for admins (permissionAdminBypass).
  // Allowing it would create lessons the review endpoint can never approve,
  // since reviewing your own lesson is blocked there too.
  if (creatorId && approverId === creatorId) {
    throw new HttpError(422, "The approver must be different from the creator");
  }
  const approvers = await eligibleApprovers(req.currentUser!.organizationId);
  if (!approvers.some((approver) => approver.id === approverId)) {
    throw new HttpError(422, "Selected approver is not an active Lesson approver");
  }
  const scoped = await scopedApproverIds(req.currentUser!.organizationId, ctx);
  // Scope rules are explicit admin-set policy — no admin bypass, same as the
  // creator self-approval prohibition.
  if (scoped && !scoped.has(approverId)) {
    throw new HttpError(422, "Selected approver is not scoped to this project, discipline and categorisation");
  }
}

router.get("/forms", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(lessonLearnedForms.organizationId, req.currentUser!.organizationId), isNull(lessonLearnedForms.deletedAt));
  const visibleWhere = await lessonVisibilityWhere(req, where);
  const [rows, count] = await Promise.all([
    db.select().from(lessonLearnedForms).where(visibleWhere).orderBy(desc(lessonLearnedForms.createdAt), asc(lessonLearnedForms.id)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(visibleWhere),
  ]);
  const names = await disciplineNameMap(req.currentUser!.organizationId);
  res.json(paginated(formJsonList(rows, names), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/forms", asyncHandler(async (req, res) => {
  const body = parseBody(CreateLessonFormBody, req, res);
  if (!body) return;
  const user = req.currentUser!;
  const capturedAt = new Date(body.capturedAt);
  if (Number.isNaN(capturedAt.valueOf())) throw new HttpError(422, "Captured at must be a valid date and time");
  await assertFieldAccess(req, "lessons", "lesson-form", { mode: "create" });
  await assertFieldControls(req, "lessons", "lesson-form", { mode: "create" });
  await Promise.all([
    assertLovValue(db, user.organizationId, "disciplines", body.disciplineId),
    assertLovValue(db, user.organizationId, "lesson_categorisations", body.categorisationId),
    assertLovValue(db, user.organizationId, "lesson_issue_categories", body.issueCategory),
    assertLovValue(db, user.organizationId, "lesson_impacts", body.impact),
  ]);
  const disciplineId = await resolveLessonsDisciplineId(user.organizationId, body.disciplineId);
  if (body.approverId) await assertEligibleApprover(req, body.approverId, user.id, { projectId: body.projectId, disciplineId, categorisation: body.categorisationId });
  const clientReference = body.id;
  const [existing] = await db.select().from(lessonLearnedForms).where(and(
    eq(lessonLearnedForms.organizationId, user.organizationId),
    eq(lessonLearnedForms.clientReference, clientReference), isNull(lessonLearnedForms.deletedAt),
  )).limit(1);
  if (existing) { res.status(200).json(await formJsonNamed(existing)); return; }
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, body.projectId), eq(projects.organizationId, user.organizationId), isNull(projects.deletedAt),
  )).limit(1);
  if (!project) notFound("Project not found");
  let created: typeof lessonLearnedForms.$inferSelect | undefined;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    // Reference numbers come from the org's lessons numbering pattern (Admin Settings → Numbering).
    const referenceNumber = await allocateReferenceNumber(user.organizationId, "lessons");
    try {
      [created] = await db.insert(lessonLearnedForms).values({
        organizationId: user.organizationId, projectId: body.projectId,
        disciplineId, referenceNumber, title: body.title,
        categorisation: body.categorisationId, issueCategory: body.issueCategory, impact: body.impact,
        capturedAt, gpsLat: body.gpsLat?.toString(), gpsLng: body.gpsLng?.toString(),
        gpsLocation: body.gpsLat != null && body.gpsLng != null ? { lat: body.gpsLat, lng: body.gpsLng } : undefined,
        clientReference, reference: body.reference, version: 1, conflictFlag: false, description: body.description,
        rootCause: body.rootCause, correction: body.correction, correctiveAction: body.correctiveAction,
        isRepeated: body.isRepeatedIssue ?? false, repeatCount: body.repeatCount ?? 0,
        repeatLocation: body.repeatLocation, remarks: body.remarks, workflowState: "draft", creatorId: user.id,
        approverId: body.approverId,
      }).returning();
    } catch (error) {
      if (!(error instanceof Error) || !/unique|duplicate/i.test(error.message)) throw error;
    }
  }
  if (!created) throw new HttpError(409, "Unable to allocate a unique reference number");
  const createdJson = await formJsonNamed(created);
  await audit(req, "create", "lesson_form", created.id, undefined, createdJson);
  res.status(201).json(createdJson);
}));

router.get("/forms/:id", asyncHandler(async (req, res) => {
  const row = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Lesson form not found");
  if (!await canReadLesson(req, row)) throw new HttpError(403, "You do not have permission to view this lesson");
  const photos = await listEvidence(db, "lessons", req.currentUser!.organizationId, "lesson_form", row.id);
  res.json(await formJsonNamed(row, photos));
}));

router.put("/forms/:id", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonFormBody, req, res);
  if (!body) return;
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  const capturedAt = new Date(body.capturedAt);
  if (Number.isNaN(capturedAt.valueOf())) throw new HttpError(422, "Captured at must be a valid date and time");
  assertOwnerOrFull(req, before.creatorId);
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Only draft or sent-back forms may be edited");
  const beforeJson = await formJsonNamed(before);
  await assertFieldAccess(req, "lessons", "lesson-form", { mode: "update", current: beforeJson });
  await assertFieldControls(req, "lessons", "lesson-form", { mode: "update", current: beforeJson });
  await Promise.all([
    assertLovValue(db, req.currentUser!.organizationId, "disciplines", body.disciplineId, { allowLegacy: before.disciplineId }),
    assertLovValue(db, req.currentUser!.organizationId, "lesson_categorisations", body.categorisationId, { allowLegacy: before.categorisation }),
    assertLovValue(db, req.currentUser!.organizationId, "lesson_issue_categories", body.issueCategory, { allowLegacy: before.issueCategory }),
    assertLovValue(db, req.currentUser!.organizationId, "lesson_impacts", body.impact, { allowLegacy: before.impact }),
  ]);
  const disciplineId = body.disciplineId === before.disciplineId
    ? before.disciplineId
    : await resolveLessonsDisciplineId(req.currentUser!.organizationId, body.disciplineId);
  if (body.approverId) await assertEligibleApprover(req, body.approverId, before.creatorId, { projectId: body.projectId, disciplineId, categorisation: body.categorisationId });
  const [row] = await db.update(lessonLearnedForms).set({
    projectId: body.projectId, disciplineId, title: body.title, reference: body.reference,
    categorisation: body.categorisationId, issueCategory: body.issueCategory, impact: body.impact,
    description: body.description, rootCause: body.rootCause, correction: body.correction,
    correctiveAction: body.correctiveAction, isRepeated: body.isRepeatedIssue ?? false,
    repeatCount: body.repeatCount ?? 0, repeatLocation: body.repeatLocation,
    remarks: body.remarks, approverId: body.approverId, capturedAt, version: before.workflowState === "sent_back" ? before.version + 1 : before.version,
    workflowState: before.workflowState === "sent_back" ? "draft" : before.workflowState, updatedAt: new Date(),
  }).where(and(
    eq(lessonLearnedForms.id, before.id),
    eq(lessonLearnedForms.organizationId, before.organizationId),
    eq(lessonLearnedForms.workflowState, before.workflowState),
    eq(lessonLearnedForms.version, before.version),
    isNull(lessonLearnedForms.deletedAt),
  )).returning();
  if (!row) throw new HttpError(409, "This lesson has changed. Refresh before editing it again");
  const rowJson = await formJsonNamed(row!);
  await audit(req, "update", "lesson_form", row!.id, beforeJson, rowJson);
  res.json(rowJson);
}));

router.delete("/forms/:id", asyncHandler(async (req, res) => {
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  assertOwnerOrFull(req, before.creatorId);
  await db.update(lessonLearnedForms).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() }).where(eq(lessonLearnedForms.id, before.id));
  await audit(req, "delete", "lesson_form", before.id, await formJsonNamed(before));
  res.status(204).end();
}));

router.post("/forms/:id/submit", asyncHandler(async (req, res) => {
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  assertOwnerOrFull(req, before.creatorId);
  if (before.workflowState !== "draft") throw new HttpError(409, "Only draft forms may be submitted");
  if (!before.approverId) throw new HttpError(422, "An approver is required before submission");
  // Before/after evidence photos are mandatory for submission.
  const evidence = await listEvidence(db, "lessons", before.organizationId, "lesson_form", before.id);
  const stored = (evidence as Array<typeof lessonsEvidenceFiles.$inferSelect>).filter((p) => p.status === "stored");
  if (!stored.some((p) => p.category === "before") || !stored.some((p) => p.category === "after")) {
    throw new HttpError(422, "At least one before and one after photo are required before submitting for approval");
  }
  const [row] = await db.update(lessonLearnedForms).set({ workflowState: "submitted", submittedAt: new Date(), submittedById: req.currentUser!.id, updatedAt: new Date() }).where(eq(lessonLearnedForms.id, before.id)).returning();
  await audit(req, "submit", "lesson_form", before.id, await formJsonNamed(before), await formJsonNamed(row!));
  await notifyWithEmail(db, "lessons", { organizationId: before.organizationId, userId: before.approverId, type: "lesson_submitted", title: "Lesson awaiting approval", body: `${before.referenceNumber} is ready for review.`, entityType: "lesson_form", entityId: before.id });
  res.json(await formJsonNamed(row!));
}));

router.post("/forms/:id/review", asyncHandler(async (req, res) => {
  const body = parseBody(ReviewLessonFormBody, req, res);
  if (!body) return;
  if (body.decision === "send_back" && !body.comments?.trim()) throw new HttpError(422, "Comments are required when sending a form back");
  const before = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!before) notFound("Lesson form not found");
  // Self-approval is never allowed — not even for admins.
  if (before.creatorId === req.currentUser!.id) {
    throw new HttpError(403, "You cannot review a lesson you created");
  }
  // Only the designated approver may review — there is no admin bypass.
  if (before.approverId !== req.currentUser!.id) {
    throw new HttpError(403, "Only the designated approver may review this form");
  }
  const scoped = await scopedApproverIds(before.organizationId, { projectId: before.projectId, disciplineId: before.disciplineId, categorisation: before.categorisation });
  if (scoped && !scoped.has(req.currentUser!.id)) {
    throw new HttpError(403, "Your approver scope does not cover this lesson's project, discipline and categorisation");
  }
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted forms may be reviewed");
  const state = body.decision === "approve" ? "approved" : "sent_back";
  const [row] = await db.update(lessonLearnedForms).set({
    workflowState: state,
    reviewedAt: new Date(),
    reviewedById: req.currentUser!.id,
    reviewDecision: body.decision,
    reviewComments: body.comments?.trim() || null,
    updatedAt: new Date(),
  }).where(and(
    eq(lessonLearnedForms.id, before.id),
    eq(lessonLearnedForms.organizationId, before.organizationId),
    eq(lessonLearnedForms.workflowState, "submitted"),
    eq(lessonLearnedForms.approverId, req.currentUser!.id),
    ne(lessonLearnedForms.creatorId, req.currentUser!.id),
    isNull(lessonLearnedForms.deletedAt),
  )).returning();
  if (!row) throw new HttpError(409, "This lesson has already been reviewed or is no longer available for review");
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
  const [beforeJson, rowJson] = await Promise.all([formJsonNamed(before), formJsonNamed(row!)]);
  await audit(req, body.decision, "lesson_form", before.id, beforeJson, { ...rowJson, remarks: body.comments });
  await notifyWithEmail(db, "lessons", { organizationId: before.organizationId, userId: before.creatorId, type: `lesson_${state}`, title: `Lesson ${publicState(state)}`, body: body.comments?.trim() || `${before.referenceNumber} was approved.`, entityType: "lesson_form", entityId: before.id });
  res.json({ ...rowJson, remarks: body.comments });
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

async function logWhere(req: any) {
  const q = req.query;
  const term = typeof q.search === "string" && q.search.trim() ? `%${q.search.trim()}%` : null;
  const from = typeof q.from === "string" ? new Date(q.from) : null;
  const to = typeof q.to === "string" ? new Date(q.to) : null;
  if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf()))) throw new HttpError(422, "Invalid date filter");
  const workflowStates: Record<string, string> = {
    Draft: "draft", Submitted: "submitted", Approved: "approved", "Sent Back": "sent_back",
  };
  const workflowState = typeof q.workflowState === "string" ? workflowStates[q.workflowState] : undefined;
  if (typeof q.workflowState === "string" && !workflowState) throw new HttpError(422, "Invalid workflow state filter");
  // Clients filter by the discipline LOV value (name); the column stores the UUID.
  let disciplineId: string | null = null;
  if (typeof q.disciplineId === "string") {
    disciplineId = await findLessonsDisciplineId(req.currentUser.organizationId, q.disciplineId);
    if (!disciplineId) disciplineId = "00000000-0000-0000-0000-000000000000";
  }
  return and(
    eq(lessonLearnedForms.organizationId, req.currentUser.organizationId), isNull(lessonLearnedForms.deletedAt),
    term ? or(
      ilike(lessonLearnedForms.referenceNumber, term),
      ilike(lessonLearnedForms.reference, term),
      ilike(lessonLearnedForms.title, term),
      ilike(lessonLearnedForms.description, term),
      ilike(lessonLearnedForms.rootCause, term),
      ilike(lessonLearnedForms.correctiveAction, term),
    ) : undefined,
    typeof q.projectId === "string" ? eq(lessonLearnedForms.projectId, q.projectId) : undefined,
    disciplineId ? eq(lessonLearnedForms.disciplineId, disciplineId) : undefined,
    typeof q.category === "string" ? eq(lessonLearnedForms.categorisation, q.category) : undefined,
    typeof q.impact === "string" ? eq(lessonLearnedForms.impact, q.impact) : undefined,
    from ? gte(lessonLearnedForms.capturedAt, from) : undefined, to ? lte(lessonLearnedForms.capturedAt, to) : undefined,
    workflowState ? eq(lessonLearnedForms.workflowState, workflowState) : undefined,
    q.pendingApproval === "true" ? and(
      eq(lessonLearnedForms.approverId, req.currentUser.id),
      eq(lessonLearnedForms.workflowState, "submitted"),
      ne(lessonLearnedForms.creatorId, req.currentUser.id),
    ) : undefined,
  );
}

router.get("/log", requirePermission("lessons", "lessons", "select"), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = await logWhere(req);
  const pending = req.query.pendingApproval === "true";
  const visibleWhere = await lessonVisibilityWhere(req, where, pending);
  const order = pending
    ? [asc(lessonLearnedForms.submittedAt), asc(lessonLearnedForms.id)]
    : [desc(lessonLearnedForms.capturedAt), asc(lessonLearnedForms.id)];
  const [rows, count] = await Promise.all([
    db.select().from(lessonLearnedForms).where(visibleWhere).orderBy(...order).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(visibleWhere),
  ]);
  const names = await disciplineNameMap(req.currentUser!.organizationId);
  res.json(paginated(formJsonList(rows, names), Number(count[0]?.count ?? 0), page, limit));
}));

router.post("/ai/rephrase", asyncHandler(async (req, res) => {
  const body = parseBody(RephraseLessonFieldBody, req, res);
  if (!body) return;
  if (!["description", "rootCause", "correction", "correctiveAction"].includes(body.field)) throw new HttpError(422, "Unsupported lesson field");
  try {
    const suggestion = await rephraseText({ app: "lessons", organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, field: body.field, text: body.text, tone: "clear and concise" });
    res.json({ suggestion });
  } catch (error) {
    if (error instanceof AiUnavailableError) throw new HttpError(503, "AI rephrasing is temporarily unavailable. Please try again later.");
    throw error;
  }
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
    return { id: row.id, recordType: row.recordType, recordId: row.recordId, priority: rule?.priority ?? "P1", level: row.currentLevel ?? String(rule?.configuration?.level ?? "P1"), dueAt: row.breachedAt ?? new Date(row.startedAt.getTime() + (rule?.slaWorkingDays ?? 0) * 86400000), status: row.status, lastNotifiedAt: row.breachedAt };
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

router.get("/reports/log", requirePermission("lessons", "lessons", "select"), asyncHandler(async (req, res) => {
  const format = typeof req.query.format === "string" ? req.query.format : "csv";
  if (format !== "csv" && format !== "json") throw new HttpError(422, "Only CSV and JSON exports are supported");
  const where = await logWhere(req);
  const pending = req.query.pendingApproval === "true";
  const visibleWhere = await lessonVisibilityWhere(req, where, pending);
  const rows = await db.select().from(lessonLearnedForms).where(visibleWhere).orderBy(
    ...(pending ? [asc(lessonLearnedForms.submittedAt), asc(lessonLearnedForms.id)] : [asc(lessonLearnedForms.referenceNumber), asc(lessonLearnedForms.id)]),
  );
  const fileName = `lessons-log.${format}`;
  const names = await disciplineNameMap(req.currentUser!.organizationId);
  const json = formJsonList(rows, names);
  const content = format === "csv" ? csv(json) : JSON.stringify(json, null, 2);
  res.json({ delivery: "download", fileName, downloadUrl: `data:${format === "csv" ? "text/csv" : "application/json"};charset=utf-8,${encodeURIComponent(content)}`, message: null });
}));

router.get("/forms/:id/report", asyncHandler(async (req, res) => {
  const row = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!row) notFound("Lesson form not found");
  if (!await canReadLesson(req, row)) throw new HttpError(403, "You do not have permission to view this lesson");
  const format = req.accepts(["json", "csv"]) ?? "json";
  const photos = (await listEvidence(db, "lessons", row.organizationId, "lesson_form", row.id)) as Array<typeof lessonsEvidenceFiles.$inferSelect>;
  const data = await formJsonNamed(row, photos);
  const content = format === "csv" ? csv([{ ...data, photos: undefined, photoSummary: photos.map((p) => `${p.category}:${p.fileName}`).join("; ") }]) : JSON.stringify(data, null, 2);
  const fileName = `${row.referenceNumber}.${format}`;
  res.json({ delivery: "download", fileName, downloadUrl: `data:${format === "csv" ? "text/csv" : "application/json"};charset=utf-8,${encodeURIComponent(content)}`, message: null });
}));

/** Per-lesson activity timeline (audit log filtered to this form). Visible to anyone who can see the form. */
router.get("/forms/:id/activity", asyncHandler(async (req, res) => {
  const form = await getForm(String(req.params.id), req.currentUser!.organizationId);
  if (!form) notFound("Lesson form not found");
  if (!await canReadLesson(req, form)) throw new HttpError(403, "You do not have permission to view this lesson");
  const where = and(eq(lessonsAuditLogEntries.organizationId, req.currentUser!.organizationId), eq(lessonsAuditLogEntries.entityId, form.id));
  const [rows, count] = await Promise.all([
    db.select().from(lessonsAuditLogEntries).where(where).orderBy(desc(lessonsAuditLogEntries.createdAt)).limit(50),
    db.select({ count: sql<number>`count(*)` }).from(lessonsAuditLogEntries).where(where),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => Boolean(v)))];
  const actors = actorIds.length ? await db.select().from(users).where(and(inArray(users.id, actorIds), isNull(users.deletedAt))) : [];
  const actorName = new Map(actors.map((u) => [u.id, u.fullName]));
  res.json(paginated(rows.map((r) => ({ id: r.id, actorId: r.actorId ?? "", actorName: actorName.get(r.actorId ?? "") ?? null, delegatedForId: null, action: r.action, entityType: r.entityType, entityId: r.entityId ?? "", before: null, after: r.after, ipAddress: null, occurredAt: r.createdAt })), Number(count[0]?.count ?? 0), 1, 50));
}));

router.get("/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(req.currentUser!.organizationId, "lessons"));
}));

router.use("/admin", requireAdmin);

router.get("/admin/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(req.currentUser!.organizationId, "lessons"));
}));

router.put("/admin/field-controls", asyncHandler(async (req, res) => {
  const body = parseBody<FieldControlsMatrix>(UpdateLessonsAdminFieldControlsBody, req, res); if (!body) return;
  assertKnownFieldControlKeys("lessons", body);
  const before = await writeFieldControls(req.currentUser!.organizationId, "lessons", body);
  await audit(req, "update", "field_controls", undefined, before, body);
  res.json(body);
}));

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
  res.json(paginated(rows.map((u) => ({ id: u.id, username: u.username, email: u.email, designation: u.designation, signatureUrl: u.signaturePath ? `/api/lessons/users/${u.id}/signature` : null, platformRole: platform.find((p) => p.id === u.platformRoleId)?.name ?? "Employee", workspaceRoles: assignments.filter((a) => a.userId === u.id).map((a) => rolePayload.get(a.workspaceRoleId)).filter(Boolean), status: u.accessStatus === "active" ? "Active" : "Deactivated", lastAccessAt: u.lastAccessAt })), Number(count[0]?.count ?? 0), page, limit));
}));

/** Admin: update a user's designation and signature image (used on lesson approval records). */
router.put("/admin/users/:userId/profile", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonsUserProfileBody, req, res);
  if (!body) return;
  const [target] = await db.select().from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, req.currentUser!.organizationId), isNull(users.deletedAt))).limit(1);
  if (!target) notFound("User not found");
  let signaturePath = target.signaturePath;
  if (body.signatureDataUrl) {
    // base64 inflates ~4/3; bound the encoded payload so the decoded 512KB cap is enforceable.
    if (body.signatureDataUrl.length > 720 * 1024) throw new HttpError(422, "Signature image exceeds the 512KB limit");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(body.signatureDataUrl);
    if (!match) throw new HttpError(422, "Signature must be a PNG, JPEG or WebP image");
    const bytes = Buffer.from(match[2]!, "base64");
    if (bytes.length > 512 * 1024) throw new HttpError(422, "Signature image exceeds the 512KB limit");
    signaturePath = `gcs:${await storeObject(`qms360/signatures/${target.id}`, bytes, match[1]!)}`;
  } else if (body.signatureDataUrl === null) {
    signaturePath = null;
  }
  const [row] = await db.update(users).set({
    designation: body.designation === undefined ? target.designation : (body.designation?.trim() || null),
    signaturePath,
    updatedAt: new Date(),
  }).where(eq(users.id, target.id)).returning();
  await audit(req, "update", "user_profile", row!.id, { designation: target.designation, hasSignature: Boolean(target.signaturePath) }, { designation: row!.designation, hasSignature: Boolean(row!.signaturePath) });
  res.json({ id: row!.id, designation: row!.designation, signatureUrl: row!.signaturePath ? `/api/lessons/users/${row!.id}/signature` : null });
}));

/** Stream a user's signature image to anyone in the same organization (shown on approval records). */
router.get("/users/:userId/signature", asyncHandler(async (req, res) => {
  const [target] = await db.select().from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, req.currentUser!.organizationId), isNull(users.deletedAt))).limit(1);
  if (!target?.signaturePath) throw new HttpError(404, "Signature not found");
  const signaturePath: string = target.signaturePath;
  const object = await getObject(signaturePath.startsWith("gcs:") ? signaturePath.slice(4) : signaturePath);
  res.setHeader("content-type", object.headers.get("content-type") ?? "image/png");
  res.setHeader("cache-control", "private, max-age=60");
  const { Readable } = await import("node:stream");
  Readable.fromWeb(object.body as any).pipe(res);
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
  const accessRows = await db.select({ id: applicationAccess.id }).from(applicationAccess).where(and(
    eq(applicationAccess.organizationId, req.currentUser!.organizationId),
    eq(applicationAccess.username, target[0]!.username),
    isNull(applicationAccess.deletedAt),
  ));
  if (accessRows.length) {
    await db.update(applicationAccess).set({
      canOpenLessons: true,
      status: "active",
      updatedAt: new Date(),
    }).where(inArray(applicationAccess.id, accessRows.map((access) => access.id)));
  } else {
    await db.insert(applicationAccess).values({
      organizationId: req.currentUser!.organizationId,
      username: target[0]!.username,
      canOpenLessons: true,
      status: "active",
    });
  }
  await audit(req, "assign_role", "user_role", row!.id, undefined, { userId: target[0]!.id, ...body });
  res.json(row);
}));

router.delete("/admin/users/:userId/roles/:id", asyncHandler(async (req, res) => {
  const userId = String(req.params.userId);
  const roleId = String(req.params.id);
  const [target, assignment] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, req.currentUser!.organizationId), isNull(users.deletedAt))).limit(1),
    db.select().from(lessonsUserWorkspaceRoles).where(and(eq(lessonsUserWorkspaceRoles.organizationId, req.currentUser!.organizationId), eq(lessonsUserWorkspaceRoles.userId, userId), eq(lessonsUserWorkspaceRoles.workspaceRoleId, roleId), isNull(lessonsUserWorkspaceRoles.deletedAt))).limit(1),
  ]);
  if (!target[0] || !assignment[0]) notFound("Role assignment not found");
  const now = new Date();
  await db.update(lessonsUserWorkspaceRoles).set({ deletedAt: now, status: "deleted", updatedAt: now }).where(eq(lessonsUserWorkspaceRoles.id, assignment[0]!.id));
  const remaining = await db.select({ id: lessonsUserWorkspaceRoles.id }).from(lessonsUserWorkspaceRoles).where(and(eq(lessonsUserWorkspaceRoles.organizationId, req.currentUser!.organizationId), eq(lessonsUserWorkspaceRoles.userId, userId), isNull(lessonsUserWorkspaceRoles.deletedAt))).limit(1);
  if (!remaining.length) {
    await db.update(applicationAccess).set({ canOpenLessons: false, updatedAt: now }).where(and(eq(applicationAccess.organizationId, req.currentUser!.organizationId), eq(applicationAccess.username, target[0]!.username), isNull(applicationAccess.deletedAt)));
  }
  await audit(req, "remove_role", "user_role", assignment[0]!.id, assignment[0], { userId, roleId });
  res.status(204).end();
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

function escalationRuleJson(r: typeof lessonEscalationRules.$inferSelect, staffed?: Set<string>) {
  const recipientRoles = String(r.recipientRole ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return { id: r.id, triggerType: r.triggerKey, priority: r.priority, level: typeof r.configuration.level === "string" ? r.configuration.level : null, slaWorkingDays: r.slaWorkingDays, recipientRoles, unstaffedRoles: staffed ? recipientRoles.filter((n) => !staffed.has(n)) : undefined, repeatCadenceDays: r.repeatCadenceDays ?? 2, enabled: r.status === "active" };
}
// Scoped approver assignments — blank scope dimensions act as wildcards, so a
// row with all three blank means "may approve any lesson".
router.get("/admin/approver-scopes", asyncHandler(async (req, res) => {
  const orgId = req.currentUser!.organizationId;
  const rows = await db.select({
    scope: lessonApproverScopes,
    userName: users.fullName,
    userEmail: users.email,
    projectName: projects.name,
    disciplineName: lessonsDisciplines.name,
  }).from(lessonApproverScopes)
    .innerJoin(users, eq(users.id, lessonApproverScopes.userId))
    .leftJoin(projects, eq(projects.id, lessonApproverScopes.projectId))
    .leftJoin(lessonsDisciplines, eq(lessonsDisciplines.id, lessonApproverScopes.disciplineId))
    .where(and(eq(lessonApproverScopes.organizationId, orgId), isNull(lessonApproverScopes.deletedAt)))
    .orderBy(asc(users.fullName));
  res.json(rows.map((r) => ({
    id: r.scope.id, userId: r.scope.userId, userName: r.userName, userEmail: r.userEmail,
    projectId: r.scope.projectId, projectName: r.projectName,
    disciplineId: r.scope.disciplineId, disciplineName: r.disciplineName,
    categorisation: r.scope.categorisation,
  })));
}));

router.post("/admin/approver-scopes", asyncHandler(async (req, res) => {
  const body = parseBody(CreateApproverScopeBody, req, res); if (!body) return;
  const orgId = req.currentUser!.organizationId;
  await assertUserInOrg(db, orgId, body.userId);
  // Scoping a user who is not an eligible approver would activate restrictive
  // scope matching while yielding no usable approver — reject it.
  const eligible = await eligibleApprovers(orgId);
  if (!eligible.some((approver) => approver.id === body.userId)) {
    throw new HttpError(422, "User is not an eligible lesson approver");
  }
  if (body.projectId) await assertProjectInOrg(db, orgId, body.projectId);
  if (body.disciplineId) {
    const [discipline] = await db.select({ id: lessonsDisciplines.id }).from(lessonsDisciplines).where(and(
      eq(lessonsDisciplines.id, body.disciplineId), eq(lessonsDisciplines.organizationId, orgId), isNull(lessonsDisciplines.deletedAt),
    ));
    if (!discipline) throw new HttpError(422, "Unknown discipline");
  }
  if (body.categorisation) await assertLovValue(db, orgId, "lesson_categorisations", body.categorisation);
  const [row] = await db.insert(lessonApproverScopes).values({
    organizationId: orgId, userId: body.userId,
    projectId: body.projectId ?? null, disciplineId: body.disciplineId ?? null, categorisation: body.categorisation ?? null,
  }).returning();
  await audit(req, "create", "approver_scope", row!.id, undefined, row);
  res.status(201).json({ id: row!.id });
}));

router.delete("/admin/approver-scopes/:id", asyncHandler(async (req, res) => {
  const orgId = req.currentUser!.organizationId;
  const [row] = await db.update(lessonApproverScopes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(lessonApproverScopes.id, String(req.params.id)), eq(lessonApproverScopes.organizationId, orgId), isNull(lessonApproverScopes.deletedAt),
  )).returning();
  if (!row) notFound("Approver scope not found");
  await audit(req, "delete", "approver_scope", row.id, row, undefined);
  res.status(204).end();
}));

router.get("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const [rows, staffed] = await Promise.all([
    db.select().from(lessonEscalationRules).where(and(eq(lessonEscalationRules.organizationId, req.currentUser!.organizationId), isNull(lessonEscalationRules.deletedAt))).orderBy(asc(lessonEscalationRules.slaWorkingDays)),
    staffedRoleNames(req.currentUser!.organizationId, lessonsWorkspaceRoles, lessonsUserWorkspaceRoles),
  ]);
  res.json(paginated(rows.map((r) => escalationRuleJson(r, staffed)), rows.length, 1, Math.max(1, rows.length)));
}));
router.put("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const body = parseBody(UpdateLessonsEscalationRulesBody, req, res); if (!body) return;
  const org = req.currentUser!.organizationId;
  await db.update(lessonEscalationRules).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() }).where(and(eq(lessonEscalationRules.organizationId, org), isNull(lessonEscalationRules.deletedAt)));
  const rows = body.length ? await db.insert(lessonEscalationRules).values(body.map((r) => ({ organizationId: org, triggerKey: r.triggerType, priority: r.priority, slaWorkingDays: r.slaWorkingDays, recipientRole: r.recipientRoles.join(","), repeatCadenceDays: r.repeatCadenceDays, configuration: { level: r.level }, status: r.enabled ? "active" : "inactive" }))).returning() : [];
  await audit(req, "replace", "escalation_rules", undefined, undefined, { count: rows.length });
  res.json(rows.map((r) => escalationRuleJson(r)));
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
  const where = and(eq(lessonsAuditLogEntries.organizationId, req.currentUser!.organizationId), typeof req.query.actorId === "string" ? eq(lessonsAuditLogEntries.actorId, req.query.actorId) : undefined, typeof req.query.action === "string" ? eq(lessonsAuditLogEntries.action, req.query.action) : undefined, typeof req.query.entityId === "string" ? eq(lessonsAuditLogEntries.entityId, req.query.entityId) : undefined, from ? gte(lessonsAuditLogEntries.createdAt, from) : undefined, to ? lte(lessonsAuditLogEntries.createdAt, to) : undefined);
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