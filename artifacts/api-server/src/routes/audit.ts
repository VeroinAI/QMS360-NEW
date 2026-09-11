import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Api from "@workspace/api-zod";
import { allocateReferenceNumber, hasNumberingPattern } from "../lib/numbering";
import {
  applicationAccess,
  auditAuditLogEntries,
  auditDelegations,
  auditEscalationInstances,
  auditEscalationRules,
  auditEvidenceFiles,
  auditFindings,
  auditNotificationTemplates,
  auditNotifications,
  auditPlans,
  auditSchedules,
  auditUserWorkspaceRoles,
  auditWorkspaceRoles,
  audits,
  correctiveActionReports,
  db,
  organizationSettings,
  platformRoles,
  users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { assertCanManageAssignmentScope, assertProjectAccess, canManageAssignmentScope, getAuthorizedProjectScope, requireAppAccess, requireAppAdmin, requirePermission } from "../middlewares/rbac";
import { assertProjectInOrg, assertProjectScopeInOrg } from "../lib/tenancy";
import { assertLovValue } from "../lib/lov";
import { assertFieldAccess } from "../lib/field-access";
import { assertFieldControls, assertKnownFieldControlKeys, readFieldControls, writeFieldControls, type FieldControlsMatrix } from "../lib/field-controls";
import { confirmEvidence, createEvidenceIntent, listEvidence } from "../lib/evidence";
import { asyncHandler, HttpError, listNotifications, notify, paginated, pagination, staffedRoleNames, writeAuditLog } from "../lib/workspace";
import { accessRequestIdentity, activeUserIdentityByUsername } from "../lib/access-request-identity";

const router = Router();
const requireAuditAdmin = requireAppAdmin("audit");
router.use(requireAuth);
router.use(requireAppAccess("audit"));
const auditModules: Array<[string, string]> = [
  ["/schedules", "schedules"], ["/plans", "plans"], ["/audits", "audits"],
  ["/findings", "findings"], ["/cars", "cars"],
];
for (const [path, module] of auditModules) {
  router.use(path, (req, res, next) =>
    requirePermission("audit", module, req.method === "GET" ? "select" : "full")(req, res, next));
}
const auditEvidenceModules: Record<string, string> = {
  audit_schedule: "schedules",
  audit: "audits", audit_execution: "audits",
  audit_finding: "findings", finding: "findings",
  corrective_action_report: "cars", car: "cars",
};
router.use("/evidence", asyncHandler(async (req, res, next) => {
  let recordType = typeof req.body?.recordType === "string" ? req.body.recordType
    : typeof req.query.recordType === "string" ? req.query.recordType : null;
  if (!recordType) {
    const evidenceId = req.path.split("/").filter(Boolean)[0];
    const [stored] = evidenceId ? await db.select({ recordType: auditEvidenceFiles.recordType }).from(auditEvidenceFiles).where(and(
      eq(auditEvidenceFiles.id, evidenceId), eq(auditEvidenceFiles.organizationId, req.currentUser!.organizationId), isNull(auditEvidenceFiles.deletedAt),
    )).limit(1) : [];
    recordType = stored?.recordType ?? null;
  }
  const module = recordType ? auditEvidenceModules[recordType] : null;
  if (!module) throw new HttpError(422, "Unsupported audit evidence record type");
  await requirePermission("audit", module, req.method === "GET" ? "select" : "full")(req, res, next);
}));
router.use(asyncHandler(async (req, _res, next) => {
  if (req.method !== "GET" && typeof req.body?.projectId === "string") {
    await assertProjectInOrg(db, actor(req).organizationId, req.body.projectId);
    await assertProjectAccess(req, req.body.projectId);
  }
  next();
}));

type AnyRow = Record<string, any>;
const active = (table: AnyRow, organizationId: string) =>
  and(eq(table.organizationId, organizationId), isNull(table.deletedAt));
const actor = (req: Request) => req.currentUser!;
const body = <T>(schema: { safeParse: (value: unknown) => any }, req: Request): T => {
  const result = schema.safeParse(req.body);
  if (!result.success) throw new HttpError(422, result.error.issues.map((i: any) => i.message).join("; "));
  return result.data as T;
};
const auditLog = (req: Request, action: string, entityType: string, entityId: string, before?: AnyRow, after?: AnyRow) =>
  writeAuditLog(db, "audit", {
    organizationId: actor(req).organizationId, actorId: actor(req).id, action, entityType, entityId,
    before, after, ipAddress: req.ip,
  });
const dateOnly = (value: Date | string | null | undefined) => value ? new Date(value).toISOString().slice(0, 10) : null;
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const csv = (res: Response, name: string, rows: AnyRow[]) => {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  res.send([keys.map(escape).join(","), ...rows.map((row) => keys.map((key) =>
    escape(typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key])).join(","))].join("\n"));
};
const maybeCsv = (req: Request, res: Response, name: string, rows: AnyRow[]) => {
  if (String(req.query.format ?? "").toLowerCase() === "csv" || req.accepts(["json", "text/csv"]) === "text/csv") {
    csv(res, name, rows);
    return true;
  }
  return false;
};

type ScheduleMeta = {
  projectIds?: string[]; auditTypes?: string[]; plannedStartDate?: string;
  plannedEndDate?: string; reviewComments?: string | null;
  auditCategory?: string; departmentProject?: string; location?: string;
  gpsLat?: number | null; gpsLng?: number | null;
  processProductOwner?: string; qaqcReference?: string; auditNumber?: string;
  qaqcScope?: string; qaqcClauses?: string; remarks?: string | null;
  l1Name?: string; l1ReviewStatus?: string; l1ReviewComments?: string | null; l1Attachments?: string[];
  l2Name?: string; l2ReviewStatus?: string; l2ReviewComments?: string | null; l2Attachments?: string[];
  memoDescription?: string; memoCirculation?: string;
};
const scheduleMeta = (row: AnyRow): ScheduleMeta => parseJson(row.status, {});
async function scheduleInScope(req: Request, row: AnyRow) {
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (scope.unrestricted) return true;
  const ids = scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []);
  return ids.length > 0 && ids.every((id) => scope.projectIds.includes(id));
}
async function assertAuditProject(req: Request, projectId: string | null | undefined) {
  if (req.permissionAdminBypass) return;
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (!projectId) {
    if (!scope.unrestricted) throw new HttpError(403, "You do not have access to a projectless Audit record");
    return;
  }
  if (!scope.unrestricted && !scope.projectIds.includes(projectId)) throw new HttpError(403, "You do not have access to this project");
}

async function assertAuditRecordAccess(req: Request, recordType: string, recordId: string) {
  let projectId: string | null | undefined;
  if (recordType === "audit_schedule") {
    const [row] = await db.select().from(auditSchedules)
      .where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, recordId)));
    if (!row) throw new HttpError(404, "Audit evidence record not found");
    if (!await scheduleInScope(req, row)) throw new HttpError(403, "You do not have access to this project");
    return;
  } else if (recordType === "audit" || recordType === "audit_execution") {
    const [row] = await db.select({ projectId: audits.projectId }).from(audits)
      .where(and(active(audits, actor(req).organizationId), eq(audits.id, recordId)));
    projectId = row?.projectId;
  } else if (recordType === "audit_finding" || recordType === "finding") {
    const [row] = await db.select({ projectId: audits.projectId }).from(auditFindings)
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(auditFindings.id, recordId), active(auditFindings, actor(req).organizationId), isNull(audits.deletedAt)));
    projectId = row?.projectId;
  } else if (recordType === "corrective_action_report" || recordType === "car") {
    const [row] = await db.select({ projectId: audits.projectId }).from(correctiveActionReports)
      .innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id))
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(correctiveActionReports.id, recordId), active(correctiveActionReports, actor(req).organizationId), isNull(auditFindings.deletedAt), isNull(audits.deletedAt)));
    projectId = row?.projectId;
  } else {
    throw new HttpError(422, "Unsupported audit evidence record type");
  }
  if (!projectId) throw new HttpError(404, "Audit evidence record not found");
  await assertAuditProject(req, projectId);
}

// Resolve the project through audit's parent chain before every detail,
// workflow, evidence, and export operation. This keeps authorization intact
// even where the child table does not store a project column.
router.use(asyncHandler(async (req, _res, next) => {
  const match = /^\/(schedules|plans|audits|findings|cars)(?:\/([^/]+))?/i.exec(req.path);
  let projectIds: string[] = [];
  let recordFound = false;
  const id = match?.[2];
  const routeType = match?.[1]?.toLowerCase();
  if (routeType === "schedules" && id) {
    const [row] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, id)));
    if (row) { recordFound = true; projectIds = scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []); }
  } else if (routeType === "plans" && id) {
    const [row] = await db.select({ projectId: auditPlans.projectId }).from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, id)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; }
  } else if (routeType === "audits" && id) {
    const [row] = await db.select({ projectId: audits.projectId }).from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, id)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; }
  } else if (routeType === "findings" && id) {
    const [row] = await db.select({ projectId: audits.projectId }).from(auditFindings)
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(auditFindings.id, id), eq(audits.organizationId, actor(req).organizationId), isNull(auditFindings.deletedAt)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; }
  } else if (routeType === "cars" && id) {
    const [row] = await db.select({ projectId: audits.projectId }).from(correctiveActionReports)
      .innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id))
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(correctiveActionReports.id, id), eq(audits.organizationId, actor(req).organizationId), isNull(correctiveActionReports.deletedAt)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; }
  }
  if (recordFound) {
    const scope = await getAuthorizedProjectScope(req, "audit");
    if (!scope.unrestricted && (!projectIds.length || projectIds.some((projectId) => !scope.projectIds.includes(projectId)))) {
      throw new HttpError(403, "You do not have access to this project");
    }
  }
  next();
}));
const scheduleDto = (row: AnyRow) => {
  const meta = scheduleMeta(row);
  return {
    id: row.id, year: row.year, title: row.title, projectIds: meta.projectIds ?? (row.projectId ? [row.projectId] : []),
    auditTypes: meta.auditTypes ?? [], plannedStartDate: new Date(meta.plannedStartDate ?? `${row.year}-01-01`),
    plannedEndDate: new Date(meta.plannedEndDate ?? `${row.year}-12-31`), ownerId: row.ownerId ?? undefined,
    workflowState: ({ draft: "Draft", submitted: "Submitted", approved: "Approved", sent_back: "Sent Back" } as AnyRow)[row.workflowState] ?? "Draft",
    reviewComments: meta.reviewComments ?? null,
    auditCategory: meta.auditCategory ?? "", departmentProject: meta.departmentProject ?? "",
    location: meta.location ?? "", processProductOwner: meta.processProductOwner ?? "",
    gpsLat: meta.gpsLat ?? null, gpsLng: meta.gpsLng ?? null,
    qaqcReference: meta.qaqcReference ?? "", auditNumber: meta.auditNumber ?? "",
    qaqcScope: meta.qaqcScope ?? "System and Process audits against ISO 9001:2015",
    qaqcClauses: meta.qaqcClauses ?? "ISO 9001 — All clauses", remarks: meta.remarks ?? null,
    l1Name: meta.l1Name ?? "", l1ReviewStatus: meta.l1ReviewStatus ?? "Pending",
    l1ReviewComments: meta.l1ReviewComments ?? null, l1Attachments: meta.l1Attachments ?? [],
    l2Name: meta.l2Name ?? "", l2ReviewStatus: meta.l2ReviewStatus ?? "Pending",
    l2ReviewComments: meta.l2ReviewComments ?? null, l2Attachments: meta.l2Attachments ?? [],
    memoDescription: meta.memoDescription ?? "", memoCirculation: meta.memoCirculation ?? "",
  };
};
const scheduleValues = (data: AnyRow) => ({
  id: data.id, year: data.year, title: data.title, projectId: data.projectIds[0] ?? null,
  ownerId: data.ownerId || null,
  workflowState: ({ Draft: "draft", Submitted: "submitted", Approved: "approved", "Sent Back": "sent_back", Deleted: "deleted" } as AnyRow)[data.workflowState],
  status: JSON.stringify({
    projectIds: data.projectIds, auditTypes: data.auditTypes ?? [], plannedStartDate: dateOnly(data.plannedStartDate),
    plannedEndDate: dateOnly(data.plannedEndDate), reviewComments: data.reviewComments ?? null,
    auditCategory: data.auditCategory, departmentProject: data.departmentProject, location: data.location,
    gpsLat: data.gpsLat ?? null, gpsLng: data.gpsLng ?? null,
    processProductOwner: data.processProductOwner, qaqcReference: data.qaqcReference, auditNumber: data.auditNumber,
    qaqcScope: data.qaqcScope, qaqcClauses: data.qaqcClauses, remarks: data.remarks ?? null,
    l1Name: data.l1Name, l1ReviewStatus: data.l1ReviewStatus, l1ReviewComments: data.l1ReviewComments ?? null,
    l1Attachments: data.l1Attachments ?? [], l2Name: data.l2Name, l2ReviewStatus: data.l2ReviewStatus,
    l2ReviewComments: data.l2ReviewComments ?? null, l2Attachments: data.l2Attachments ?? [],
    memoDescription: data.memoDescription, memoCirculation: data.memoCirculation,
  }),
});
const isMatchingScheduleCreate = (row: AnyRow, values: ReturnType<typeof scheduleValues>) =>
  row.deletedAt == null
  && row.year === values.year
  && row.title === values.title
  && row.projectId === values.projectId
  && (row.ownerId ?? null) === (values.ownerId ?? null)
  && row.workflowState === values.workflowState
  && row.status === values.status;

/** Validate schedule fields against audit-scope master data; blank values are allowed (field controls govern requiredness). */
async function assertScheduleLovs(organizationId: string, data: AnyRow, legacy?: ScheduleMeta) {
  const checks: Array<[string, unknown, string | null | undefined]> = [
    ["process_product_owners", data.processProductOwner, legacy?.processProductOwner],
    ["audit_levels", data.l1Name, legacy?.l1Name],
    ["audit_levels", data.l2Name, legacy?.l2Name],
  ];
  for (const [group, value, legacyValue] of checks) {
    if (typeof value === "string" && value.trim()) {
      await assertLovValue(db, organizationId, group, value, { allowLegacy: legacyValue });
    }
  }
}

/** Business rule: the To date may not be before the From date. Inputs may be ISO strings or zod-coerced Dates. */
function assertScheduleDates(data: AnyRow) {
  const from = data.plannedStartDate ? new Date(data.plannedStartDate) : null;
  const to = data.plannedEndDate ? new Date(data.plannedEndDate) : null;
  if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to.getTime() < from.getTime()) {
    throw new HttpError(422, "To Date must be on or after From Date");
  }
}

router.get("/schedules", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const where = active(auditSchedules, actor(req).organizationId);
  const allItems = await db.select().from(auditSchedules).where(where).orderBy(desc(auditSchedules.year), desc(auditSchedules.updatedAt));
  const scoped = (await Promise.all(allItems.map(async (row) => (await scheduleInScope(req, row)) ? row : null))).filter(Boolean) as AnyRow[];
  const offset = (page - 1) * limit;
  res.json(paginated(scoped.slice(offset, offset + limit).map(scheduleDto), scoped.length, page, limit));
}));
router.post("/schedules", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditScheduleBody, req);
  const requestedProjectIds = data.projectIds?.length ? data.projectIds : [data.projectId].filter(Boolean);
  const projectIds = requestedProjectIds.length
    ? await assertProjectScopeInOrg(db, actor(req).organizationId, requestedProjectIds)
    : [];
  data.projectIds = projectIds;
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (!scope.unrestricted && !projectIds.length) throw new HttpError(422, "At least one project is required for a project-scoped Audit schedule");
  if (!scope.unrestricted && projectIds.some((id) => !scope.projectIds.includes(id))) throw new HttpError(403, "You do not have access to every selected project");
  await assertFieldAccess(req, "audit", "schedule", { mode: "create" });
  await assertFieldControls(req, "audit", "schedule", { mode: "create" });
  await Promise.all((data.auditTypes ?? []).map((value: string) =>
    assertLovValue(db, actor(req).organizationId, "audit_types", value)));
  await assertLovValue(db, actor(req).organizationId, "audit_categories", data.auditCategory);
  assertScheduleDates(data);
  await assertScheduleLovs(actor(req).organizationId, data);
  const values = scheduleValues(data);
  const [row] = await db.insert(auditSchedules)
    .values({ organizationId: actor(req).organizationId, ...values })
    .onConflictDoNothing({ target: auditSchedules.id })
    .returning();
  if (!row) {
    const [existing] = await db.select().from(auditSchedules).where(eq(auditSchedules.id, values.id)).limit(1);
    if (existing?.organizationId === actor(req).organizationId && isMatchingScheduleCreate(existing, values)) {
      res.status(201).json(scheduleDto(existing));
      return;
    }
    throw new HttpError(409, "A schedule with this form identifier already exists. Refresh the schedule list before creating another schedule.");
  }
  await auditLog(req, "create", "audit_schedule", row.id, undefined, row);
  res.status(201).json(scheduleDto(row));
}));
router.get("/schedules/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit schedule not found");
  if (!await scheduleInScope(req, row)) throw new HttpError(403, "You do not have access to this schedule");
  res.json(scheduleDto(row));
}));
router.put("/schedules/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditScheduleBody, req);
  const requestedProjectIds = data.projectIds?.length ? data.projectIds : [data.projectId].filter(Boolean);
  const projectIds = requestedProjectIds.length
    ? await assertProjectScopeInOrg(db, actor(req).organizationId, requestedProjectIds)
    : [];
  data.projectIds = projectIds;
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (!scope.unrestricted && !projectIds.length) throw new HttpError(422, "At least one project is required for a project-scoped Audit schedule");
  if (!scope.unrestricted && projectIds.some((id) => !scope.projectIds.includes(id))) throw new HttpError(403, "You do not have access to every selected project");
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit schedule not found");
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Only draft or sent-back schedules may be edited");
  await assertFieldAccess(req, "audit", "schedule", { mode: "update", current: scheduleDto(before) });
  await assertFieldControls(req, "audit", "schedule", { mode: "update", current: scheduleDto(before) });
  await Promise.all((data.auditTypes ?? []).map((value: string) =>
    assertLovValue(db, actor(req).organizationId, "audit_types", value, { allowLegacy: scheduleMeta(before).auditTypes })));
  await assertLovValue(db, actor(req).organizationId, "audit_categories", data.auditCategory, { allowLegacy: [scheduleMeta(before).auditCategory ?? ""] });
  assertScheduleDates(data);
  await assertScheduleLovs(actor(req).organizationId, data, scheduleMeta(before));
  const [row] = await db.update(auditSchedules).set({ ...scheduleValues(data), id: undefined, updatedAt: new Date() })
    .where(eq(auditSchedules.id, before.id)).returning();
  await auditLog(req, "update", "audit_schedule", row.id, before, row);
  res.json(scheduleDto(row));
}));
router.delete("/schedules/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditSchedules).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit schedule not found");
  await auditLog(req, "delete", "audit_schedule", row.id, row);
  res.status(204).end();
}));
router.post("/schedules/:id/submit", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit schedule not found");
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Schedule is not eligible for submission");
  const [row] = await db.update(auditSchedules).set({ workflowState: "submitted", updatedAt: new Date() }).where(eq(auditSchedules.id, before.id)).returning();
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, actor(req).organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt)));
  await Promise.all(admins.filter((u) => u.id !== actor(req).id).map((u) => notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: u.id, type: "schedule_submitted",
    title: "Audit schedule awaiting review", body: `${row.title} has been submitted.`, entityType: "audit_schedule", entityId: row.id,
  })));
  await auditLog(req, "submit", "audit_schedule", row.id, before, row);
  res.json(scheduleDto(row));
}));
router.post("/schedules/:id/review", requireAuditAdmin, asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.ReviewAuditScheduleBody, req);
  if (data.decision === "send_back" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when sending back");
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit schedule not found");
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted schedules may be reviewed");
  const meta = scheduleMeta(before);
  const [row] = await db.update(auditSchedules).set({
    workflowState: data.decision === "approve" ? "approved" : "sent_back",
    status: JSON.stringify({ ...meta, reviewComments: data.comments ?? null }), updatedAt: new Date(),
  }).where(eq(auditSchedules.id, before.id)).returning();
  if (before.ownerId) await notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: before.ownerId, type: "schedule_decision",
    title: `Audit schedule ${data.decision === "approve" ? "approved" : "sent back"}`,
    body: data.comments || row.title, entityType: "audit_schedule", entityId: row.id,
  });
  await auditLog(req, data.decision, "audit_schedule", row.id, before, row);
  res.json(scheduleDto(row));
}));

type PlanMeta = { objectives?: string | null; leadAuditorId?: string; processOwnerIds?: string[]; feasibilityNotes?: string | null };
const planMeta = (row: AnyRow): PlanMeta => parseJson(row.status, {});
const planDto = (row: AnyRow) => {
  const meta = planMeta(row);
  return {
    id: row.id, scheduleId: row.auditScheduleId!, scope: row.scope ?? "", objectives: meta.objectives ?? null,
    criteria: parseJson(row.criteria, row.criteria ? [row.criteria] : []), auditDate: new Date(row.auditDate!),
    location: row.location ?? "", leadAuditorId: meta.leadAuditorId, teamMemberIds: row.teamMemberIds,
    processOwnerIds: meta.processOwnerIds ?? [], feasibilityNotes: meta.feasibilityNotes ?? null,
    status: ({ draft: "Draft", shared: "Shared", active: "Active", completed: "Completed" } as AnyRow)[row.workflowState] ?? "Draft",
  };
};
const planValues = (data: AnyRow) => ({
  id: data.id, auditScheduleId: data.scheduleId, scope: data.scope, criteria: JSON.stringify(data.criteria),
  auditDate: dateOnly(data.auditDate)!, location: data.location, teamMemberIds: data.teamMemberIds,
  workflowState: String(data.status).toLowerCase(),
  status: JSON.stringify({ objectives: data.objectives ?? null, leadAuditorId: data.leadAuditorId, processOwnerIds: data.processOwnerIds ?? [], feasibilityNotes: data.feasibilityNotes ?? null }),
});
router.get("/plans", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const scope = await getAuthorizedProjectScope(req, "audit");
  const where = and(active(auditPlans, actor(req).organizationId), scope.unrestricted ? undefined : inArray(auditPlans.projectId, scope.projectIds));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditPlans).where(where).orderBy(desc(auditPlans.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditPlans).where(where),
  ]);
  res.json(paginated(rows.map(planDto), Number(count), page, limit));
}));
router.post("/plans", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditPlanBody, req);
  await assertFieldAccess(req, "audit", "plan", { mode: "create" });
  await assertFieldControls(req, "audit", "plan", { mode: "create" });
  const [schedule] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, data.scheduleId)));
  if (!schedule) throw new HttpError(404, "Audit schedule not found");
  if (!await scheduleInScope(req, schedule)) throw new HttpError(403, "You do not have access to this schedule");
  const [row] = await db.insert(auditPlans).values({ organizationId: actor(req).organizationId, projectId: schedule.projectId, ...planValues(data) }).returning();
  await auditLog(req, "create", "audit_plan", row.id, undefined, row); res.status(201).json(planDto(row));
}));
router.get("/plans/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit plan not found"); res.json(planDto(row));
}));
router.put("/plans/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditPlanBody, req);
  const [before] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit plan not found");
  const [schedule] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, data.scheduleId)));
  if (!schedule) throw new HttpError(404, "Audit schedule not found");
  if (!await scheduleInScope(req, schedule)) throw new HttpError(403, "You do not have access to this schedule");
  const linkedAudits = await db.select({ projectId: audits.projectId }).from(audits).where(and(
    active(audits, actor(req).organizationId), eq(audits.auditPlanId, before.id),
  ));
  if (linkedAudits.some((audit) => audit.projectId !== schedule.projectId)) {
    throw new HttpError(409, "This plan cannot move to another project while audits are linked to it");
  }
  await assertFieldAccess(req, "audit", "plan", { mode: "update", current: planDto(before) });
  await assertFieldControls(req, "audit", "plan", { mode: "update", current: planDto(before) });
  const [row] = await db.update(auditPlans).set({ ...planValues(data), id: undefined, projectId: schedule.projectId, updatedAt: new Date() }).where(eq(auditPlans.id, before.id)).returning();
  await auditLog(req, "update", "audit_plan", row.id, before, row); res.json(planDto(row));
}));
router.delete("/plans/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditPlans).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit plan not found"); await auditLog(req, "delete", "audit_plan", row.id, row); res.status(204).end();
}));
router.post("/plans/:id/share", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit plan not found");
  if (before.workflowState !== "draft") throw new HttpError(409, "Only draft plans can be shared");
  const [row] = await db.update(auditPlans).set({ workflowState: "shared", updatedAt: new Date() }).where(eq(auditPlans.id, before.id)).returning();
  await Promise.all((planMeta(row).processOwnerIds ?? []).map((id) => notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: id, type: "plan_shared", title: "Audit plan shared",
    body: row.scope ?? "An audit plan has been shared with you.", entityType: "audit_plan", entityId: row.id,
  })));
  await auditLog(req, "share", "audit_plan", row.id, before, row); res.status(202).json(planDto(row));
}));

type AuditMeta = { title?: string; openingMeeting?: AnyRow; closingMeeting?: AnyRow; startedAt?: string | null; closedAt?: string | null };
const auditMeta = (row: AnyRow): AuditMeta => parseJson(row.status, {});
const auditDto = (row: AnyRow) => {
  const meta = auditMeta(row);
  return {
    id: row.id, planId: row.auditPlanId!, projectId: row.projectId!, title: meta.title ?? row.referenceNumber,
    status: ({ planned: "Planned", "in progress": "In Progress", "report draft": "Report Draft", "car follow-up": "CAR Follow-up", closed: "Closed", scheduled: "Planned" } as AnyRow)[row.workflowState.toLowerCase()] ?? "Planned",
    openingMeeting: meta.openingMeeting ? { ...meta.openingMeeting, heldAt: new Date(meta.openingMeeting.heldAt) } : undefined,
    closingMeeting: meta.closingMeeting ? { ...meta.closingMeeting, heldAt: new Date(meta.closingMeeting.heldAt) } : undefined,
    checklist: Array.isArray(row.checklistState) ? row.checklistState : [],
    startedAt: meta.startedAt ? new Date(meta.startedAt) : null, closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
};
const auditValues = (data: AnyRow) => ({
  id: data.id, auditPlanId: data.planId, projectId: data.projectId, referenceNumber: data.title,
  workflowState: String(data.status).toLowerCase(), checklistState: data.checklist ?? [],
  openingMeetingMinutes: data.openingMeeting?.minutes, closingMeetingMinutes: data.closingMeeting?.minutes,
  status: JSON.stringify({
    title: data.title, openingMeeting: data.openingMeeting, closingMeeting: data.closingMeeting,
    startedAt: data.startedAt?.toISOString?.() ?? data.startedAt ?? null, closedAt: data.closedAt?.toISOString?.() ?? data.closedAt ?? null,
  }),
});
router.get("/audits", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const scope = await getAuthorizedProjectScope(req, "audit");
  const where = and(active(audits, actor(req).organizationId), scope.unrestricted ? undefined : inArray(audits.projectId, scope.projectIds));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(audits).where(where).orderBy(desc(audits.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(audits).where(where),
  ]); res.json(paginated(rows.map(auditDto), Number(count), page, limit));
}));
router.post("/audits", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditBody, req);
  await assertFieldAccess(req, "audit", "audit-execution", { mode: "create" });
  const [plan] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, data.planId)));
  if (!plan) throw new HttpError(422, "Audit plan does not belong to this organization");
  await assertAuditProject(req, plan.projectId);
  if (data.projectId && plan.projectId && data.projectId !== plan.projectId) {
    throw new HttpError(422, "Audit project must match the selected plan");
  }
  if (plan.auditScheduleId) {
    const [schedule] = await db.select({ projectId: auditSchedules.projectId }).from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, plan.auditScheduleId),
    )).limit(1);
    if (!schedule) throw new HttpError(422, "Audit plan is not linked to a valid schedule");
    if (data.projectId && schedule.projectId && data.projectId !== schedule.projectId) {
      throw new HttpError(422, "Audit project must match the plan schedule");
    }
  }
  // When an audit numbering pattern is configured, the reference number is
  // generated from it; otherwise the manually supplied title remains the reference.
  const usePattern = await hasNumberingPattern(actor(req).organizationId, "audit");
  const values: Omit<typeof audits.$inferInsert, "organizationId"> = auditValues(data);
  let row: typeof audits.$inferSelect | undefined;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    if (usePattern) {
      values.referenceNumber = await allocateReferenceNumber(actor(req).organizationId, "audit");
      values.referenceGenerated = true;
    }
    try {
      [row] = await db.insert(audits).values({ organizationId: actor(req).organizationId, ...values }).returning();
    } catch (error: any) {
      if (error?.code === "23505" && usePattern && String(error?.message ?? "").includes("audit_reference_active_idx")) continue;
      if (error?.code === "23505") throw new HttpError(409, "An active audit with this title already exists");
      throw error;
    }
  }
  if (!row) throw new HttpError(409, "Unable to allocate a unique audit reference number");
  await auditLog(req, "create", "audit", row.id, undefined, row); res.status(201).json(auditDto(row));
}));
router.get("/audits/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit not found"); res.json(auditDto(row));
}));
router.put("/audits/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditBody, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const [plan] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, data.planId)));
  if (!plan) throw new HttpError(404, "Audit plan not found");
  await assertAuditProject(req, plan.projectId);
  if (data.projectId && plan.projectId && data.projectId !== plan.projectId) {
    throw new HttpError(422, "Audit project must match the selected plan");
  }
  const values = auditValues(data);
  values.projectId = plan.projectId;
  // Generated reference numbers are immutable, regardless of the current pattern config.
  if (before.referenceGenerated) values.referenceNumber = before.referenceNumber;
  await assertFieldAccess(req, "audit", "audit-execution", { mode: "update", current: auditDto(before) });
  const [row] = await db.update(audits).set({ ...values, id: undefined, updatedAt: new Date() }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, "update", "audit", row.id, before, row); res.json(auditDto(row));
}));
router.delete("/audits/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(audits).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit not found"); await auditLog(req, "delete", "audit", row.id, row); res.status(204).end();
}));
async function updateMeeting(req: Request, kind: "opening" | "closing", schema: { safeParse: (value: unknown) => any }) {
  const data = body<AnyRow>(schema, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  await assertFieldAccess(req, "audit", "audit-execution", {
    mode: "update",
    body: { [`${kind}Meeting`]: data },
    current: { [`${kind}Meeting`]: auditMeta(before)[`${kind}Meeting`] ?? null },
  });
  const meta = auditMeta(before); meta[`${kind}Meeting`] = { ...data, heldAt: data.heldAt.toISOString() };
  if (kind === "opening" && !meta.startedAt) meta.startedAt = data.heldAt.toISOString();
  const [row] = await db.update(audits).set({
    status: JSON.stringify(meta), [kind === "opening" ? "openingMeetingMinutes" : "closingMeetingMinutes"]: data.minutes,
    workflowState: kind === "opening" && before.workflowState === "planned" ? "in progress" : before.workflowState, updatedAt: new Date(),
  }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, `${kind}_meeting`, "audit", row.id, before, row); return row;
}
router.put("/audits/:id/opening-meeting", asyncHandler(async (req, res) => res.json(auditDto(await updateMeeting(req, "opening", Api.UpdateAuditOpeningMeetingBody)))));
router.put("/audits/:id/closing-meeting", asyncHandler(async (req, res) => res.json(auditDto(await updateMeeting(req, "closing", Api.UpdateAuditClosingMeetingBody)))));
router.put("/audits/:id/checklist", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.UpdateAuditChecklistBody, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const legacyResults = (Array.isArray(before.checklistState) ? before.checklistState : [])
    .map((item: AnyRow) => item.result).filter((value: unknown): value is string => typeof value === "string");
  await Promise.all(data.map((item) =>
    assertLovValue(db, actor(req).organizationId, "checklist_results", item.result, { allowLegacy: legacyResults })));
  const [row] = await db.update(audits).set({ checklistState: data as any, updatedAt: new Date() }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, "update_checklist", "audit", row.id, before, row); res.json(auditDto(row));
}));

type FindingMeta = { title?: string; clause?: string | null; responsibleDepartments?: string[]; evidenceIds?: string[]; raisedAt?: string };
const findingMeta = (row: AnyRow): FindingMeta => row.evidence ?? {};
const findingDto = (row: AnyRow) => {
  const meta = findingMeta(row);
  return {
    id: row.id, auditId: row.auditId, title: meta.title ?? "Audit finding", description: row.description ?? "",
    clause: meta.clause ?? null, classification: row.classification, priority: row.priority ?? "P6",
    riskLevel: row.riskLevel ?? "Low", responsibleDepartments: meta.responsibleDepartments ?? (row.responsibleDepartment ? [row.responsibleDepartment] : []),
    evidenceIds: meta.evidenceIds ?? [], status: row.status === "active" ? "Open" : row.status,
    raisedAt: new Date(meta.raisedAt ?? row.createdAt),
  };
};
const findingValues = (data: AnyRow) => ({
  id: data.id, auditId: data.auditId, responsibleDepartment: data.responsibleDepartments[0] ?? null,
  classification: data.classification, priority: data.priority, riskLevel: data.riskLevel, description: data.description,
  status: data.status === "Open" ? "active" : data.status,
  evidence: { title: data.title, clause: data.clause ?? null, responsibleDepartments: data.responsibleDepartments, evidenceIds: data.evidenceIds ?? [], raisedAt: data.raisedAt?.toISOString?.() ?? data.raisedAt ?? new Date().toISOString() },
});
const prioritySla: Record<string, number> = { P1: 2, P2: 2, P3: 2, P4: 2, P5: 3, P6: 3 };
router.get("/findings", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const scope = await getAuthorizedProjectScope(req, "audit");
  const where = and(active(auditFindings, actor(req).organizationId), scope.unrestricted ? undefined : inArray(audits.projectId, scope.projectIds));
  const [rows, [{ count }]] = await Promise.all([
    db.select({ finding: auditFindings }).from(auditFindings).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where).orderBy(desc(auditFindings.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditFindings).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where),
  ]); res.json(paginated(rows.map((row) => findingDto(row.finding)), Number(count), page, limit));
}));
router.post("/findings", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditFindingBody, req);
  await assertFieldAccess(req, "audit", "finding", { mode: "create" });
  await assertFieldControls(req, "audit", "finding", { mode: "create" });
  await Promise.all([
    assertLovValue(db, actor(req).organizationId, "nc_classifications", data.classification),
    assertLovValue(db, actor(req).organizationId, "finding_priorities", data.priority),
    assertLovValue(db, actor(req).organizationId, "risk_levels", data.riskLevel),
  ]);
  const [audit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, data.auditId)));
  if (!audit) throw new HttpError(404, "Audit not found");
  await assertAuditProject(req, audit.projectId);
  const [row] = await db.insert(auditFindings).values({ organizationId: actor(req).organizationId, ...findingValues(data) }).returning();
  await auditLog(req, "create", "audit_finding", row.id, undefined, row); res.status(201).json(findingDto(row));
}));
router.get("/findings/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit finding not found"); res.json(findingDto(row));
}));
router.put("/findings/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditFindingBody, req);
  const [before] = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit finding not found");
  const [parentAudit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, data.auditId)));
  if (!parentAudit) throw new HttpError(404, "Audit not found");
  await assertAuditProject(req, parentAudit.projectId);
  await assertFieldAccess(req, "audit", "finding", { mode: "update", current: findingDto(before) });
  await assertFieldControls(req, "audit", "finding", { mode: "update", current: findingDto(before) });
  await Promise.all([
    assertLovValue(db, actor(req).organizationId, "nc_classifications", data.classification, { allowLegacy: before.classification }),
    assertLovValue(db, actor(req).organizationId, "finding_priorities", data.priority, { allowLegacy: before.priority }),
    assertLovValue(db, actor(req).organizationId, "risk_levels", data.riskLevel, { allowLegacy: before.riskLevel }),
  ]);
  const [row] = await db.update(auditFindings).set({ ...findingValues(data), id: undefined, updatedAt: new Date() }).where(eq(auditFindings.id, before.id)).returning();
  await auditLog(req, "update", "audit_finding", row.id, before, row); res.json(findingDto(row));
}));
router.delete("/findings/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditFindings).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit finding not found"); await auditLog(req, "delete", "audit_finding", row.id, row); res.status(204).end();
}));

type CarMeta = {
  extensionReason?: string | null; extensionReviewedBy?: string | null; extensionReviewedAt?: string | null;
  extensionPriorState?: string | null;
  reviewComments?: string | null; effectivenessVerified?: boolean; closedAt?: string | null;
};
// A due-date extension may only be requested once the CAR response has been reviewed and
// accepted (implementation stage). Allowing earlier requests would let an extension approval
// promote a CAR past its response and review steps straight into a closable state.
const CAR_EXTENSION_ELIGIBLE_STATES: readonly string[] = ["accepted"];
// States a CAR may legitimately resume after an extension decision ("extension_requested" and
// "closed" are never valid restore targets).
const CAR_EXTENSION_RESTORABLE_STATES: readonly string[] = ["open", "draft", "submitted", "accepted", "rejected"];
// Resolves the workflow state a CAR was in when its pending extension was requested. Rows
// requested after the safeguard record it in the CAR metadata; older rows recover it from the
// audit trail, whose request_extension entries store the pre-request snapshot. Returns null
// when the original state cannot be verified.
const extensionPriorState = async (before: AnyRow): Promise<string | null> => {
  const recorded = carMeta(before).extensionPriorState;
  if (typeof recorded === "string" && CAR_EXTENSION_RESTORABLE_STATES.includes(recorded)) return recorded;
  const [entry] = await db.select({ before: auditAuditLogEntries.before }).from(auditAuditLogEntries)
    .where(and(
      eq(auditAuditLogEntries.organizationId, before.organizationId),
      eq(auditAuditLogEntries.entityType, "corrective_action_report"),
      eq(auditAuditLogEntries.entityId, before.id),
      eq(auditAuditLogEntries.action, "request_extension"),
    ))
    .orderBy(desc(auditAuditLogEntries.createdAt)).limit(1);
  const state = (entry?.before as AnyRow | null | undefined)?.workflowState;
  return typeof state === "string" && CAR_EXTENSION_RESTORABLE_STATES.includes(state) ? state : null;
};
const carMeta = (row: AnyRow): CarMeta => parseJson(row.effectivenessNotes, {});
const carDto = (row: AnyRow) => {
  const meta = carMeta(row);
  return {
    id: row.id, findingId: row.auditFindingId, responsibleDepartment: row.responsibleDepartment,
    ownerId: row.ownerId ?? row.id, rootCause: row.rootCause, correction: row.correction, correctiveAction: row.correctiveAction,
    status: ({ open: "Open", draft: "Draft", submitted: "Submitted", accepted: "Accepted", rejected: "Rejected", extension_requested: "Extension Requested", closed: "Closed" } as AnyRow)[row.workflowState] ?? "Open",
    dueDate: new Date(row.dueDate ?? row.createdAt), extensionRequestedTo: row.extensionDueDate ? new Date(row.extensionDueDate) : null,
    extensionReason: meta.extensionReason ?? null,
    extensionStatus: row.extensionStatus === "none" ? null : row.extensionStatus === "requested" ? "pending" : row.extensionStatus,
    extensionReviewedBy: meta.extensionReviewedBy ?? null,
    extensionReviewedAt: meta.extensionReviewedAt ? new Date(meta.extensionReviewedAt) : null,
    effectivenessVerified: meta.effectivenessVerified ?? false, closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
};
router.post("/findings/:id/cars", asyncHandler(async (req, res) => {
  const data = body<{ responsibleDepartments: string[] }>(Api.CreateFindingCarsBody, req);
  const departments = [...new Set(data.responsibleDepartments.map((x) => x.trim()).filter(Boolean))];
  const [finding] = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id))));
  if (!finding) throw new HttpError(404, "Audit finding not found");
  const existing = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.auditFindingId, finding.id), inArray(correctiveActionReports.responsibleDepartment, departments)));
  if (existing.length) throw new HttpError(409, `CAR already exists for: ${existing.map((x) => x.responsibleDepartment).join(", ")}`);
  const dueDate = new Date(Date.now() + (prioritySla[finding.priority ?? "P6"] ?? 3) * 86400000).toISOString().slice(0, 10);
  const rows = await db.insert(correctiveActionReports).values(departments.map((department) => ({
    organizationId: actor(req).organizationId, auditFindingId: finding.id, responsibleDepartment: department,
    ownerId: actor(req).id, workflowState: "open", dueDate,
  }))).returning();
  await db.update(auditFindings).set({ status: "CAR Issued", updatedAt: new Date() }).where(eq(auditFindings.id, finding.id));
  await Promise.all(rows.map((row) => auditLog(req, "create", "corrective_action_report", row.id, undefined, row)));
  res.status(201).json(paginated(rows.map(carDto), rows.length, 1, Math.max(1, rows.length)));
}));
router.get("/cars", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const clauses: any[] = [active(correctiveActionReports, actor(req).organizationId)];
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (!scope.unrestricted) clauses.push(inArray(audits.projectId, scope.projectIds));
  if (req.query.status) clauses.push(eq(correctiveActionReports.workflowState, String(req.query.status).toLowerCase().replaceAll(" ", "_")));
  const where = and(...clauses);
  const [rows, [{ count }]] = await Promise.all([
    db.select({ car: correctiveActionReports }).from(correctiveActionReports).innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id)).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where).orderBy(desc(correctiveActionReports.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(correctiveActionReports).innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id)).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where),
  ]); res.json(paginated(rows.map((row) => carDto(row.car)), Number(count), page, limit));
}));
router.put("/cars/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateCorrectiveActionReportBody, req);
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (!["open", "draft", "rejected"].includes(before.workflowState)) throw new HttpError(409, "CAR cannot be edited in its current state");
  await assertFieldAccess(req, "audit", "car", { mode: "update", current: carDto(before) });
  await assertFieldControls(req, "audit", "car", { mode: "update", current: carDto(before) });
  const [row] = await db.update(correctiveActionReports).set({
    rootCause: data.rootCause, correction: data.correction, correctiveAction: data.correctiveAction,
    ownerId: data.ownerId, dueDate: dateOnly(data.dueDate), workflowState: "draft", updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "update", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/submit", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (!["open", "draft", "rejected"].includes(before.workflowState)) throw new HttpError(409, "CAR is not eligible for submission");
  if (!before.rootCause || !before.correction || !before.correctiveAction) throw new HttpError(422, "Root cause, correction, and corrective action are required");
  const [row] = await db.update(correctiveActionReports).set({ workflowState: "submitted", updatedAt: new Date() }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "submit", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/review", requireAuditAdmin, asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.ReviewCorrectiveActionReportBody, req);
  if (data.decision === "reject" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when rejecting");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted CARs may be reviewed");
  const [row] = await db.update(correctiveActionReports).set({
    workflowState: data.decision === "accept" ? "accepted" : "rejected",
    effectivenessNotes: JSON.stringify({ ...carMeta(before), reviewComments: data.comments ?? null }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  if (row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "car_decision", title: `CAR ${data.decision}ed`, body: data.comments || "Your CAR has been reviewed.", entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, data.decision, "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension", asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.RequestCarExtensionBody, req);
  if (!data.reason.trim()) throw new HttpError(422, "Extension reason is required");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.workflowState === "extension_requested" || before.extensionStatus === "requested") throw new HttpError(409, "An extension request is already awaiting review");
  if (!CAR_EXTENSION_ELIGIBLE_STATES.includes(before.workflowState)) throw new HttpError(409, `Extension can only be requested once the CAR is accepted (current state: ${before.workflowState})`);
  if (before.dueDate && dateOnly(data.requestedDueDate)! <= before.dueDate) throw new HttpError(422, "Requested due date must be after the current due date");
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: "requested", extensionRequestedAt: new Date(), extensionDueDate: dateOnly(data.requestedDueDate),
    workflowState: "extension_requested",
    effectivenessNotes: JSON.stringify({ ...carMeta(before), extensionReason: data.reason, extensionPriorState: before.workflowState }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "request_extension", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension/review", requireAuditAdmin, asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.ReviewCarExtensionBody, req);
  if (data.decision === "reject" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when rejecting");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.extensionStatus !== "requested" || before.workflowState !== "extension_requested") throw new HttpError(409, "No extension is awaiting review");
  // Restore the state the CAR was in before the extension request so an approval can never
  // promote it past response/review. When the original state cannot be verified (legacy rows
  // predate the safeguard and have no audit-trail snapshot), refuse to decide: the request
  // must be withdrawn and re-submitted so the CAR cannot skip its required steps.
  const priorState = await extensionPriorState(before);
  if (!priorState) throw new HttpError(409, "This extension request predates the workflow safeguards and its original state cannot be verified. Withdraw the request and submit a new extension.");
  const meta = { ...carMeta(before), extensionReviewedBy: actor(req).id, extensionReviewedAt: new Date().toISOString(), reviewComments: data.comments ?? null };
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: data.decision === "approve" ? "approved" : "rejected",
    extensionApprovedAt: data.decision === "approve" ? new Date() : null,
    extensionDueDate: data.decision === "approve" ? before.extensionDueDate : null,
    workflowState: priorState, effectivenessNotes: JSON.stringify(meta), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  if (row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "extension_decision", title: `CAR extension ${data.decision}d`, body: data.comments || "Your extension request has been reviewed.", entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, `${data.decision}_extension`, "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension/cancel", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.extensionStatus !== "requested" || before.workflowState !== "extension_requested") throw new HttpError(409, "No extension is awaiting review");
  // Fall back to "open" when the original state cannot be verified: a reopened CAR must go
  // through the full response and review cycle again, so it can never skip required steps.
  const priorState = (await extensionPriorState(before)) ?? "open";
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: "none", extensionRequestedAt: null, extensionDueDate: null,
    workflowState: priorState, updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "cancel_extension", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/close", requireAuditAdmin, asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.workflowState !== "accepted") throw new HttpError(409, "Only accepted CARs may be closed");
  const [row] = await db.update(correctiveActionReports).set({
    workflowState: "closed", effectivenessNotes: JSON.stringify({ ...carMeta(before), effectivenessVerified: true, closedAt: new Date().toISOString() }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "close", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));

const evidenceDto = (row: AnyRow) => ({
  id: row.id, recordType: row.recordType, recordId: row.recordId, category: row.category, fileName: row.fileName,
  mimeType: row.mimeType, sizeBytes: row.sizeBytes,
  status: ({ uploading: "pending", stored: "confirmed", failed: "failed" } as AnyRow)[row.status] ?? row.status,
  clientReference: row.clientReference ?? row.id, storageUrl: row.status === "stored" ? `/api/files/${row.id}` : null,
  gpsLat: null, gpsLng: null, createdAt: row.createdAt,
});
router.post("/evidence", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditEvidenceIntentBody, req);
  await assertAuditRecordAccess(req, data.recordType, data.recordId);
  const [settings] = await db.select().from(organizationSettings).where(and(eq(organizationSettings.organizationId, actor(req).organizationId), isNull(organizationSettings.deletedAt)));
  if (settings) {
    const limits = settings.evidenceLimits;
    const maxMb = data.mimeType.startsWith("image/") ? limits.photoMaxMb : data.mimeType.startsWith("video/") ? limits.videoMaxMb : limits.docMaxMb;
    if (data.sizeBytes > maxMb * 1024 * 1024) throw new HttpError(422, `File exceeds the organization's ${maxMb}MB limit`);
  }
  try {
    const intent = await createEvidenceIntent({
      app: "audit", recordType: data.recordType, recordId: data.recordId, category: data.category,
      fileName: data.fileName, mimeType: data.mimeType, sizeBytes: data.sizeBytes,
      clientReference: data.clientReference, userId: actor(req).id, organizationId: actor(req).organizationId,
    });
    await auditLog(req, "create", "evidence", intent.id, undefined, data); res.status(201).json(intent);
  } catch (error) {
    if (error instanceof Error) throw new HttpError(422, error.message);
    throw error;
  }
}));
router.put("/evidence/:id/confirm", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditEvidenceFiles).where(and(
    eq(auditEvidenceFiles.id, String(req.params.id)),
    eq(auditEvidenceFiles.organizationId, actor(req).organizationId),
    isNull(auditEvidenceFiles.deletedAt),
  )).limit(1);
  if (!before) throw new HttpError(404, "Evidence not found");
  await assertAuditRecordAccess(req, before.recordType, before.recordId);
  const row = await confirmEvidence(db, "audit", String(req.params.id), actor(req).organizationId);
  if (!row) throw new HttpError(404, "Evidence not found");
  await auditLog(req, "confirm", "evidence", row.id, undefined, row); res.json(evidenceDto(row));
}));
router.get("/evidence", asyncHandler(async (req, res) => {
  const parsed = Api.ListAuditEvidenceQueryParams.safeParse(req.query);
  if (!parsed.success) throw new HttpError(422, parsed.error.message);
  const { page, limit } = parsed.data;
  await assertAuditRecordAccess(req, parsed.data.recordType, parsed.data.recordId);
  const all = await listEvidence(db, "audit", actor(req).organizationId, parsed.data.recordType, parsed.data.recordId);
  res.json(paginated(all.slice((page - 1) * limit, page * limit).map(evidenceDto), all.length, page, limit));
}));

async function scopedAuditRows(req: Request, projectId?: string, module = "audits") {
  const scope = await getAuthorizedProjectScope(req, "audit", { module, action: "select" });
  if (projectId && !scope.unrestricted && !scope.projectIds.includes(projectId)) {
    throw new HttpError(403, "You do not have access to this project");
  }
  return db.select().from(audits).where(and(
    active(audits, actor(req).organizationId),
    projectId ? eq(audits.projectId, projectId) : scope.unrestricted ? undefined : inArray(audits.projectId, scope.projectIds),
  ));
}

async function scopedAuditData(req: Request, projectId?: string) {
  const [auditRows, findingAudits, carAudits] = await Promise.all([
    scopedAuditRows(req, projectId, "audits"),
    scopedAuditRows(req, projectId, "findings"),
    scopedAuditRows(req, projectId, "cars"),
  ]);
  const findingAuditIds = findingAudits.map((row) => row.id);
  const findingRows = findingAuditIds.length
    ? await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), inArray(auditFindings.auditId, findingAuditIds)))
    : [];
  const carAuditIds = carAudits.map((row) => row.id);
  const carParents = carAuditIds.length
    ? await db.select({ id: auditFindings.id }).from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), inArray(auditFindings.auditId, carAuditIds)))
    : [];
  const carRows = carParents.length
    ? await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), inArray(correctiveActionReports.auditFindingId, carParents.map((row) => row.id))))
    : [];
  return { auditRows, findingRows, carRows };
}

async function dashboardData(req: Request, projectId?: string) {
  const { auditRows, findingRows, carRows } = await scopedAuditData(req, projectId);
  const countBy = (rows: AnyRow[], key: string) => rows.reduce((out: AnyRow, row) => ({ ...out, [row[key]]: (out[row[key]] ?? 0) + 1 }), {});
  const now = dateOnly(new Date())!;
  return {
    generatedAt: new Date(),
    metrics: {
      audits: { open: auditRows.filter((x) => x.workflowState !== "closed").length, closed: auditRows.filter((x) => x.workflowState === "closed").length },
      findingsByClassification: countBy(findingRows, "classification"),
      carStatus: countBy(carRows, "workflowState"),
      overdueCars: carRows.filter((x) => x.workflowState !== "closed" && (x.extensionDueDate ?? x.dueDate) && (x.extensionDueDate ?? x.dueDate)! < now).length,
      openFindings: findingRows.filter((x) => !["Closed", "Verified"].includes(x.status)).length,
    },
    series: Object.entries(countBy(findingRows, "classification")).map(([classification, count]) => ({ classification, count })),
  };
}
router.get("/dashboard", asyncHandler(async (req, res) => res.json(await dashboardData(req, req.query.projectId ? String(req.query.projectId) : undefined))));
router.get("/reports/open-vs-closed", asyncHandler(async (req, res) => {
  const report = await dashboardData(req, req.query.projectId ? String(req.query.projectId) : undefined);
  const rows = Object.entries(report.metrics.audits as AnyRow).map(([status, count]) => ({ status, count }));
  if (!maybeCsv(req, res, "audit-open-vs-closed", rows)) res.json(report);
}));
router.get("/reports/findings-log", requirePermission("audit", "findings", "select"), asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const { findingRows } = await scopedAuditData(req, req.query.projectId ? String(req.query.projectId) : undefined);
  const sorted = findingRows.sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf());
  const result = sorted.slice((page - 1) * limit, page * limit).map(findingDto);
  if (!maybeCsv(req, res, "audit-findings-log", result)) res.json(paginated(result, sorted.length, page, limit));
}));
router.get("/reports/ageing", asyncHandler(async (req, res) => {
  const { findingRows: findings, carRows: cars } = await scopedAuditData(req, req.query.projectId ? String(req.query.projectId) : undefined);
  const bucket = (createdAt: Date) => { const days = Math.floor((Date.now() - createdAt.valueOf()) / 86400000); return days <= 15 ? "0-15" : days <= 45 ? "16-45" : ">45"; };
  const rows = [...findings.map((x) => ({ type: "finding", bucket: bucket(x.createdAt), id: x.id })), ...cars.map((x) => ({ type: "CAR", bucket: bucket(x.createdAt), id: x.id }))];
  const metrics = rows.reduce((out: AnyRow, x) => ({ ...out, [`${x.type}:${x.bucket}`]: (out[`${x.type}:${x.bucket}`] ?? 0) + 1 }), {});
  if (!maybeCsv(req, res, "audit-ageing", rows)) res.json({ generatedAt: new Date(), metrics, series: rows });
}));
router.get("/reports/car-status", asyncHandler(async (req, res) => {
  const { carRows: rows } = await scopedAuditData(req, req.query.projectId ? String(req.query.projectId) : undefined);
  const metrics = rows.reduce((out: AnyRow, x) => ({ ...out, [x.workflowState]: (out[x.workflowState] ?? 0) + 1 }), {});
  const series = Object.entries(metrics).map(([status, count]) => ({ status, count }));
  if (!maybeCsv(req, res, "car-status", series)) res.json({ generatedAt: new Date(), metrics, series });
}));
router.get("/reports/schedule", asyncHandler(async (req, res) => {
  const all = await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId)).orderBy(desc(auditSchedules.year));
  const scope = await getAuthorizedProjectScope(req, "audit", { module: "schedules", action: "select" });
  const scoped = all.filter((row) => {
    const ids = scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []);
    return scope.unrestricted || (ids.length > 0 && ids.every((id) => scope.projectIds.includes(id)));
  });
  const rows = scoped.map(scheduleDto);
  if (!maybeCsv(req, res, "annual-audit-schedule", rows)) res.json(paginated(rows, rows.length, 1, Math.max(1, rows.length)));
}));
router.get("/audits/:id/report", asyncHandler(async (req, res) => {
  const [audit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!audit) throw new HttpError(404, "Audit not found");
  const [plan] = audit.auditPlanId ? await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, audit.auditPlanId))) : [];
  if (plan) await assertAuditProject(req, plan.projectId);
  const findings = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.auditId, audit.id)));
  const cars = findings.length ? await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), inArray(correctiveActionReports.auditFindingId, findings.map((x) => x.id)))) : [];
  const payload = { audit: auditDto(audit), plan: plan ? planDto(plan) : null, findings: findings.map(findingDto), cars: cars.map(carDto), generatedAt: new Date(), downloadUrl: null };
  if (!maybeCsv(req, res, `audit-${audit.referenceNumber}`, findings.map((finding) => ({ ...findingDto(finding), cars: cars.filter((car) => car.auditFindingId === finding.id).map(carDto) })))) res.json(payload);
}));

router.get("/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(actor(req).organizationId, "audit"));
}));

router.use("/admin", requireAuditAdmin);
router.get("/admin/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(actor(req).organizationId, "audit"));
}));
router.put("/admin/field-controls", asyncHandler(async (req, res) => {
  const data = body<FieldControlsMatrix>(Api.UpdateAuditAdminFieldControlsBody, req);
  assertKnownFieldControlKeys("audit", data);
  const before = await writeFieldControls(actor(req).organizationId, "audit", data);
  await auditLog(req, "update", "field_controls", actor(req).organizationId, before, data);
  res.json(data);
}));
router.get("/admin/roles", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditWorkspaceRoles, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditWorkspaceRoles).where(where).orderBy(asc(auditWorkspaceRoles.name)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditWorkspaceRoles).where(where),
  ]);
  res.json(paginated(rows.map((x) => ({ id: x.id, name: x.name, description: x.description, permissions: [], active: x.status === "active", systemDefault: x.isSystem })), Number(count), page, limit));
}));
router.post("/admin/roles", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditRoleBody, req);
  try {
    const [row] = await db.insert(auditWorkspaceRoles).values({ id: data.id, organizationId: actor(req).organizationId, name: data.name, description: data.description, isSystem: data.systemDefault ?? false, status: data.active ? "active" : "inactive" }).returning();
    await auditLog(req, "create", "workspace_role", row.id, undefined, row); res.status(201).json({ ...data, id: row.id });
  } catch (error: any) { if (error?.code === "23505") throw new HttpError(409, "Role name already exists"); throw error; }
}));
router.put("/admin/roles/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditRoleBody, req);
  const [before] = await db.select().from(auditWorkspaceRoles).where(and(active(auditWorkspaceRoles, actor(req).organizationId), eq(auditWorkspaceRoles.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Role not found");
  const [row] = await db.update(auditWorkspaceRoles).set({ name: data.name, description: data.description, status: data.active ? "active" : "inactive", updatedAt: new Date() }).where(eq(auditWorkspaceRoles.id, before.id)).returning();
  await auditLog(req, "update", "workspace_role", row.id, before, row); res.json({ ...data, id: row.id });
}));
router.get("/admin/users", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = and(eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt));
  const [allRows, allAssignments, availablePlatformRoles] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.username)),
    db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), isNull(auditUserWorkspaceRoles.deletedAt))),
    db.select({ id: platformRoles.id, name: platformRoles.name }).from(platformRoles).where(and(eq(platformRoles.organizationId, actor(req).organizationId), isNull(platformRoles.deletedAt))),
  ]);
  const visibleRows = req.permissionAdminBypass ? allRows : allRows.filter((u) =>
    u.id === actor(req).id || allAssignments.some((a) => a.userId === u.id && canManageAssignmentScope(req, a.projectIds, a.businessUnitIds)));
  const rows = visibleRows.slice(offset, offset + limit);
  const assignments = rows.length ? await db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), inArray(auditUserWorkspaceRoles.userId, rows.map((x) => x.id)), isNull(auditUserWorkspaceRoles.deletedAt))) : [];
  const visibleAssignments = assignments.filter((assignment) => canManageAssignmentScope(req, assignment.projectIds, assignment.businessUnitIds));
  const roles = visibleAssignments.length ? await db.select().from(auditWorkspaceRoles).where(inArray(auditWorkspaceRoles.id, visibleAssignments.map((x) => x.workspaceRoleId))) : [];
  res.json(paginated(rows.map((x) => ({
    id: x.id, username: x.username, fullName: x.fullName, email: x.email, platformRole: availablePlatformRoles.find((role) => role.id === x.platformRoleId)?.name ?? "Employee",
    workspaceRoles: roles.filter((role) => visibleAssignments.some((a) => a.userId === x.id && a.workspaceRoleId === role.id)).map((role) => {
      const assignment = visibleAssignments.find((a) => a.userId === x.id && a.workspaceRoleId === role.id)!;
      return { id: role.id, name: role.name, description: role.description, permissions: [], active: role.status === "active", systemDefault: role.isSystem, scopeType: assignment.projectIds?.length ? "project" as const : "organization" as const, scopeIds: assignment.projectIds ?? [] };
    }),
    status: x.accessStatus === "active" ? "Active" : x.accessStatus === "deactivated" ? "Deactivated" : "Not Requested", lastAccessAt: x.lastAccessAt,
  })), visibleRows.length, page, limit));
}));
router.post("/admin/users/:userId/roles", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.AssignAuditUserRoleBody, req);
  const [user, role] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt))).then((x) => x[0]),
    db.select().from(auditWorkspaceRoles).where(and(eq(auditWorkspaceRoles.id, data.roleId), active(auditWorkspaceRoles, actor(req).organizationId))).then((x) => x[0]),
  ]);
  if (!user || !role) throw new HttpError(404, !user ? "User not found" : "Role not found");
  const [existing] = await db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.userId, user.id), eq(auditUserWorkspaceRoles.workspaceRoleId, role.id), isNull(auditUserWorkspaceRoles.deletedAt)));
  if (data.scopeType === "business_unit") throw new HttpError(422, "Business-unit scope is not supported; choose organization or project");
  const values = { organizationId: actor(req).organizationId, userId: user.id, workspaceRoleId: role.id, projectIds: data.scopeType === "project" ? await assertProjectScopeInOrg(db, actor(req).organizationId, data.scopeIds) : [], businessUnitIds: [], status: "active", updatedAt: new Date() };
  assertCanManageAssignmentScope(req, values.projectIds, values.businessUnitIds);
  const [row] = existing ? await db.update(auditUserWorkspaceRoles).set(values).where(eq(auditUserWorkspaceRoles.id, existing.id)).returning() : await db.insert(auditUserWorkspaceRoles).values(values).returning();
  await auditLog(req, "assign_role", "user_workspace_role", row.id, existing, row); res.json(row);
}));
router.delete("/admin/users/:userId/roles/:id", asyncHandler(async (req, res) => {
  const userId = String(req.params.userId);
  const roleId = String(req.params.id);
  const [user, assignment] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt))).then((x) => x[0]),
    db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), eq(auditUserWorkspaceRoles.userId, userId), eq(auditUserWorkspaceRoles.workspaceRoleId, roleId), isNull(auditUserWorkspaceRoles.deletedAt))).then((x) => x[0]),
  ]);
  if (!user || !assignment) throw new HttpError(404, "Role assignment not found");
  assertCanManageAssignmentScope(req, assignment.projectIds, assignment.businessUnitIds);
  const now = new Date();
  await db.update(auditUserWorkspaceRoles).set({ deletedAt: now, status: "deleted", updatedAt: now }).where(eq(auditUserWorkspaceRoles.id, assignment.id));
  const remaining = await db.select({ id: auditUserWorkspaceRoles.id }).from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), eq(auditUserWorkspaceRoles.userId, userId), isNull(auditUserWorkspaceRoles.deletedAt))).limit(1);
  if (!remaining.length) await db.update(applicationAccess).set({ canOpenAudit: false, updatedAt: now }).where(and(eq(applicationAccess.organizationId, actor(req).organizationId), eq(applicationAccess.username, user.username), isNull(applicationAccess.deletedAt)));
  await auditLog(req, "remove_role", "user_workspace_role", assignment.id, assignment, { userId, roleId });
  res.status(204).end();
}));
router.get("/admin/access-queue", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(applicationAccess.organizationId, actor(req).organizationId), eq(applicationAccess.canOpenAudit, false), isNull(applicationAccess.deletedAt));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(applicationAccess).where(where).orderBy(desc(applicationAccess.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(applicationAccess).where(where),
  ]);
  const orgUsers = await db.select().from(users).where(and(eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt)));
  const byUsername = activeUserIdentityByUsername(orgUsers, actor(req).organizationId);
  res.json(paginated(rows.map((x) => ({ id: x.id, ...accessRequestIdentity(x.username, byUsername), requestedRoleId: "", status: "pending", requestedAt: x.createdAt })), Number(count), page, limit));
}));
router.post("/admin/access-queue/:id/decision", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.DecideAuditAccessRequestBody, req);
  const [before] = await db.select().from(applicationAccess).where(and(eq(applicationAccess.id, String(req.params.id)), eq(applicationAccess.organizationId, actor(req).organizationId), isNull(applicationAccess.deletedAt)));
  if (!before) throw new HttpError(404, "Access request not found");
  if (before.canOpenAudit) throw new HttpError(409, "Access request has already been decided");
  const [row] = await db.update(applicationAccess).set({ canOpenAudit: data.decision === "approve", status: data.decision === "approve" ? "active" : "rejected", updatedAt: new Date() }).where(eq(applicationAccess.id, before.id)).returning();
  await auditLog(req, `${data.decision}_access`, "application_access", row.id, before, row); res.json(row);
}));
const delegationDto = (x: AnyRow, peopleById = new Map<string, AnyRow>()) => {
  const personFields = (prefix: "delegator" | "delegate", userId: string) => {
    const person = peopleById.get(userId);
    return {
      [`${prefix}FullName`]: person?.fullName ?? null,
      [`${prefix}Username`]: person?.username ?? null,
      [`${prefix}Email`]: person?.email ?? null,
      [`${prefix}UserStatus`]: person
        ? person.accessStatus === "active" && !person.deletedAt ? "active" : "deactivated"
        : "unavailable",
    };
  };
  return ({
    id: x.id, delegatorId: x.delegatorId, delegateId: x.delegateId,
    ...personFields("delegator", x.delegatorId), ...personFields("delegate", x.delegateId),
    scope: typeof x.scope?.scope === "string" ? x.scope.scope : "audit",
    approvalTypes: x.scope?.approvalTypes ?? [], startDate: x.startsAt, endDate: x.endsAt,
    status: x.status === "active" && x.endsAt < new Date() ? "expired" : x.status, revokedAt: x.deletedAt,
  });
};
router.get("/admin/delegations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditDelegations, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditDelegations).where(where).orderBy(desc(auditDelegations.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditDelegations).where(where),
  ]);
  const userIds = [...new Set(rows.flatMap((row) => [row.delegatorId, row.delegateId]))];
  const people = userIds.length
    ? await db.select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        email: users.email,
        accessStatus: users.accessStatus,
        deletedAt: users.deletedAt,
      }).from(users).where(and(eq(users.organizationId, actor(req).organizationId), inArray(users.id, userIds)))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person]));
  res.json(paginated(rows.map((row) => delegationDto(row, peopleById)), Number(count), page, limit));
}));
router.post("/admin/delegations", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditDelegationBody, req);
  if (data.endDate <= data.startDate) throw new HttpError(422, "End date must be after start date");
  const [row] = await db.insert(auditDelegations).values({ id: data.id, organizationId: actor(req).organizationId, delegatorId: data.delegatorId, delegateId: data.delegateId, startsAt: data.startDate, endsAt: data.endDate, scope: { scope: data.scope, approvalTypes: data.approvalTypes ?? [] }, status: data.status }).returning();
  await auditLog(req, "create", "delegation", row.id, undefined, row); res.status(201).json(delegationDto(row));
}));
router.delete("/admin/delegations/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditDelegations).set({ deletedAt: new Date(), status: "revoked", updatedAt: new Date() })
    .where(and(active(auditDelegations, actor(req).organizationId), eq(auditDelegations.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Delegation not found"); await auditLog(req, "revoke", "delegation", row.id, row); res.status(204).end();
}));
const ruleDto = (x: AnyRow, staffed?: Set<string>) => {
  const recipientRoles = (x.configuration?.recipientRoles ?? String(x.recipientRole ?? "").split(",").map((v: string) => v.trim()).filter(Boolean)) as string[];
  return {
    id: x.id, triggerType: x.triggerKey, priority: x.priority, level: x.configuration?.level ?? null,
    slaWorkingDays: x.slaWorkingDays, recipientRoles,
    unstaffedRoles: staffed ? recipientRoles.filter((n) => !staffed.has(n)) : undefined,
    repeatCadenceDays: x.repeatCadenceDays ?? 1, enabled: x.status === "active",
  };
};
// Open/resolved escalation instances for dashboard surfacing — mirrors the
// lessons module's GET /lessons/escalations shape (EscalationSummary).
router.get("/escalations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const findingScope = await getAuthorizedProjectScope(req, "audit", { module: "findings", action: "select" });
  const carScope = await getAuthorizedProjectScope(req, "audit", { module: "cars", action: "select" });
  const findingIds = findingScope.unrestricted ? [] : await db.select({ id: auditFindings.id }).from(auditFindings)
    .innerJoin(audits, eq(auditFindings.auditId, audits.id))
    .where(and(
      eq(auditFindings.organizationId, actor(req).organizationId),
      eq(audits.organizationId, actor(req).organizationId),
      inArray(audits.projectId, findingScope.projectIds),
      isNull(auditFindings.deletedAt),
      isNull(audits.deletedAt),
    ));
  const carFindingIds = carScope.unrestricted ? [] : await db.select({ id: auditFindings.id }).from(auditFindings)
    .innerJoin(audits, eq(auditFindings.auditId, audits.id))
    .where(and(
      eq(auditFindings.organizationId, actor(req).organizationId),
      eq(audits.organizationId, actor(req).organizationId),
      inArray(audits.projectId, carScope.projectIds),
      isNull(auditFindings.deletedAt),
      isNull(audits.deletedAt),
    ));
  const carIds = carScope.unrestricted ? [] : await db.select({ id: correctiveActionReports.id }).from(correctiveActionReports).where(and(
    eq(correctiveActionReports.organizationId, actor(req).organizationId),
    inArray(correctiveActionReports.auditFindingId, carFindingIds.map((row) => row.id)),
    isNull(correctiveActionReports.deletedAt),
  ));
  const where = and(
    eq(auditEscalationInstances.organizationId, actor(req).organizationId),
    isNull(auditEscalationInstances.deletedAt),
    or(
      findingScope.unrestricted
        ? eq(auditEscalationInstances.recordType, "audit_finding")
        : and(eq(auditEscalationInstances.recordType, "audit_finding"), inArray(auditEscalationInstances.recordId, findingIds.map((row) => row.id))),
      carScope.unrestricted
        ? eq(auditEscalationInstances.recordType, "corrective_action")
        : and(eq(auditEscalationInstances.recordType, "corrective_action"), inArray(auditEscalationInstances.recordId, carIds.map((row) => row.id))),
    ),
  );
  const [rows, count, rules] = await Promise.all([
    db.select().from(auditEscalationInstances).where(where).orderBy(desc(auditEscalationInstances.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditEscalationInstances).where(where),
    db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId)),
  ]);
  res.json(paginated(rows.map((row) => {
    const rule = rules.find((r) => r.id === row.ruleId);
    return { id: row.id, recordType: row.recordType, recordId: row.recordId, priority: rule?.priority ?? "P1", level: row.currentLevel ?? String((rule?.configuration as any)?.level ?? "P1"), dueAt: row.breachedAt ?? new Date(row.startedAt.getTime() + (rule?.slaWorkingDays ?? 0) * 86400000), status: row.status, lastNotifiedAt: row.breachedAt };
  }), Number(count[0]?.count ?? 0), page, limit));
}));
router.get("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const [rows, staffed] = await Promise.all([
    db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId)).orderBy(asc(auditEscalationRules.priority)),
    staffedRoleNames(actor(req).organizationId, auditWorkspaceRoles, auditUserWorkspaceRoles),
  ]);
  res.json(paginated(rows.map((r) => ruleDto(r, staffed)), rows.length, 1, Math.max(1, rows.length)));
}));
router.put("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.UpdateAuditEscalationRulesBody, req);
  const before = await db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId));
  await db.update(auditEscalationRules).set({ deletedAt: new Date(), updatedAt: new Date() }).where(active(auditEscalationRules, actor(req).organizationId));
  const rows = data.length ? await db.insert(auditEscalationRules).values(data.map((x) => ({
    id: x.id, organizationId: actor(req).organizationId, triggerKey: x.triggerType, priority: x.priority,
    slaWorkingDays: x.slaWorkingDays, recipientRole: x.recipientRoles[0] ?? "Quality Manager",
    repeatCadenceDays: x.repeatCadenceDays, configuration: { level: x.level, recipientRoles: x.recipientRoles },
    status: x.enabled ? "active" : "inactive",
  }))).returning() : [];
  await auditLog(req, "replace", "escalation_rules", rows[0]?.id ?? actor(req).id, { rules: before }, { rules: rows });
  res.json(paginated(rows.map((x) => ruleDto(x)), rows.length, 1, Math.max(1, rows.length)));
}));
router.get("/admin/audit-log", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const clauses: any[] = [eq(auditAuditLogEntries.organizationId, actor(req).organizationId)];
  if (req.query.actorId) clauses.push(eq(auditAuditLogEntries.actorId, String(req.query.actorId)));
  if (req.query.action) clauses.push(eq(auditAuditLogEntries.action, String(req.query.action)));
  if (req.query.from) clauses.push(gte(auditAuditLogEntries.createdAt, new Date(String(req.query.from))));
  if (req.query.to) clauses.push(lte(auditAuditLogEntries.createdAt, new Date(String(req.query.to))));
  const where = and(...clauses);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditAuditLogEntries).where(where).orderBy(desc(auditAuditLogEntries.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditAuditLogEntries).where(where),
  ]);
  res.json(paginated(rows.map((x) => ({ id: x.id, actorId: x.actorId ?? actor(req).id, delegatedForId: null, action: x.action, entityType: x.entityType, entityId: x.entityId ?? x.id, before: x.before, after: x.after, ipAddress: (x.after as AnyRow)?._requestIp ?? null, occurredAt: x.createdAt })), Number(count), page, limit));
}));
const templateDto = (x: AnyRow) => ({
  id: x.id, key: x.key, subject: x.subject, body: x.bodyTemplate,
  channels: [x.channel], mergeFields: [], enabled: x.enabled,
});
router.get("/admin/notification-templates", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditNotificationTemplates, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditNotificationTemplates).where(where).orderBy(asc(auditNotificationTemplates.name)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditNotificationTemplates).where(where),
  ]); res.json(paginated(rows.map(templateDto), Number(count), page, limit));
}));
router.put("/admin/notification-templates/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditNotificationTemplateBody, req);
  const [before] = await db.select().from(auditNotificationTemplates).where(and(active(auditNotificationTemplates, actor(req).organizationId), eq(auditNotificationTemplates.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Notification template not found");
  const supportedChannel = data.channels.find((x: string) => x === "in_app" || x === "email") ?? "in_app";
  const [row] = await db.update(auditNotificationTemplates).set({ key: data.key, subject: data.subject, bodyTemplate: data.body, channel: supportedChannel, enabled: data.enabled, updatedAt: new Date() }).where(eq(auditNotificationTemplates.id, before.id)).returning();
  await auditLog(req, "update", "notification_template", row.id, before, row); res.json(templateDto(row));
}));

router.get("/notifications", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const rows = await listNotifications(db, "audit", actor(req).organizationId, actor(req).id);
  res.json(paginated(rows.slice((page - 1) * limit, page * limit).map((x) => ({ id: x.id, type: "audit", title: x.title, message: x.body, critical: false, read: Boolean(x.readAt), recordType: x.recordType, recordId: x.recordId, createdAt: x.createdAt, readAt: x.readAt })), rows.length, page, limit));
}));
router.post("/notifications/:id/read", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditNotifications).set({ readAt: new Date(), updatedAt: new Date() }).where(and(active(auditNotifications, actor(req).organizationId), eq(auditNotifications.id, String(req.params.id)), eq(auditNotifications.recipientId, actor(req).id))).returning();
  if (!row) throw new HttpError(404, "Notification not found"); res.status(204).end();
}));

export default router;