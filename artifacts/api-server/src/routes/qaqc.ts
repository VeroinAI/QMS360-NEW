import { randomUUID } from "node:crypto";
import { applyExcelDateFormats } from "../lib/excel-date-cells";
import { formatSpreadsheetDate, isSpreadsheetDateField } from "@workspace/spreadsheet-dates";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql,
} from "drizzle-orm";
import {
  AiUnavailableError, draftQualityBrief, promptToTransaction, rephraseText,
} from "../lib/ai";
import { confirmEvidence, createEvidenceIntent, deleteEvidence, listEvidence } from "../lib/evidence";
import {
  asyncHandler, HttpError, listNotifications, notify, notifyWithEmail, paginated, pagination, staffedRoleNames, writeAuditLog,
} from "../lib/workspace";
import { allocateReferenceNumber } from "../lib/numbering";
import { requireAuth } from "../middlewares/auth";
import { assertCanManageAssignmentScope, assertProjectAccess, canManageAssignmentScope, getAuthorizedProjectScope, requireAppAccess, requireAppAdmin, requirePermission } from "../middlewares/rbac";
import { assertProjectInOrg, assertProjectScopeInOrg } from "../lib/tenancy";
import { assertLovValue } from "../lib/lov";
import { assertFieldAccess, filterReadOnlyValues, readOnlyFields } from "../lib/field-access";
import { assertFieldControls, assertKnownFieldControlKeys, readFieldControls, writeFieldControls, type FieldControlsMatrix } from "../lib/field-controls";
import { accessRequestIdentity, activeUserIdentityByUsername } from "../lib/access-request-identity";
import { saveQaqcRole } from "../lib/qaqc-role-permissions";
import { activeQaqcCapabilities, qaqcAdminTask } from "../lib/qaqc-capabilities";
import { qaqcOwnedRecordClause, qaqcRecordReadClauses } from "../lib/qaqc-record-scope";
import { decideApplicationAccess, loadPendingApplicationRequestPage } from "../lib/application-access-requests";
import {
  aiSuggestionLogs, applicationAccess, auditLogEntries, categorisationRiskMaster,
  customerSatisfactionEntries, db, delegations, disciplines, distributionLists,
  documentGovernanceLogEntries, escalationInstances, escalationRules,
  evidenceFiles, materialInspectionEntries, notificationTemplates, notifications,
  organizationSettings, permissions, platformRoles, qaqcMetricEntries,
  qualityAssessmentBriefs, qtbtEntries, targetBenchmarks, users,
  userWorkspaceRoles, workspaceRolePermissions, workspaceRoles,
} from "@workspace/db";
import * as api from "@workspace/api-zod";
import { qaqcActivityGroups, qaqcPermissionMatches } from "@workspace/field-controls";

const router: IRouter = Router();
router.use(requireAuth);
router.use(requireAppAccess("qaqc"));
router.get("/capabilities", asyncHandler(async (req, res) => {
  res.json(await activeQaqcCapabilities(req));
}));

const qaqcModules: Array<[string, string]> = [
  ["/metrics", "metrics"],
  ["/material-inspections", "material_inspections"],
  ["/qtbt", "qtbt"],
  ["/customer-satisfaction", "customer_satisfaction"],
  ["/document-governance-log", "document_governance"],
  ["/quality-briefs", "quality_briefs"],
];
for (const [path, module] of qaqcModules) {
  router.use(path, (req, res, next) =>
    requirePermission("qaqc", module, req.method === "GET" ? "select" : "own")(req, res, next));
}
router.use("/pqi", requirePermission("qaqc", "metrics", "select"));
router.use("/dashboard", requirePermission("qaqc", "metrics", "select"));
router.use("/reports/monthly", requirePermission("qaqc", "metrics", "select", { qaqcOperation: "export" }));
router.use("/reports/document-governance", requirePermission("qaqc", "document_governance", "select", { qaqcOperation: "export" }));
const qaqcEvidenceModules: Record<string, string> = {
  metric: "metrics", qaqc_metric: "metrics", material_inspection: "material_inspections",
  qtbt: "qtbt", customer_satisfaction: "customer_satisfaction",
  document_governance: "document_governance", quality_brief: "quality_briefs",
};
router.use("/evidence", asyncHandler(async (req, res, next) => {
  let recordType = typeof req.body?.recordType === "string" ? req.body.recordType
    : typeof req.query.recordType === "string" ? req.query.recordType : null;
  if (!recordType) {
    const evidenceId = req.path.split("/").filter(Boolean)[0];
    const [stored] = evidenceId ? await db.select({ recordType: evidenceFiles.recordType }).from(evidenceFiles).where(and(
      eq(evidenceFiles.id, evidenceId), eq(evidenceFiles.organizationId, req.currentUser!.organizationId), isNull(evidenceFiles.deletedAt),
    )).limit(1) : [];
    recordType = stored?.recordType ?? null;
  }
  const module = recordType ? qaqcEvidenceModules[recordType] : null;
  if (!module) throw new HttpError(422, "Unsupported evidence record type");
  await requirePermission("qaqc", module, req.method === "GET" ? "select" : "own",
    req.method === "GET" ? {} : { qaqcOperation: "create_edit" })(req, res, next);
}));
router.use("/ai", (req, res, next) =>
  requirePermission("qaqc", "metrics", "own", { qaqcOperation: "ai" })(req, res, next));
router.use("/metrics/template", requirePermission("qaqc", "metrics", "select", { qaqcOperation: "import" }));
router.use(asyncHandler(async (req, _res, next) => {
  if (req.method !== "GET" && typeof req.body?.projectId === "string") {
    await assertProjectInOrg(db, org(req), req.body.projectId);
    await assertProjectAccess(req, req.body.projectId);
  }
  next();
}));

type Table = any;
const org = (req: Request) => req.currentUser!.organizationId;
const actor = (req: Request) => req.currentUser!.id;

/** Approval eligibility follows active permission grants, not workspace role names. */
async function eligibleQaqcApprovers(organizationId: string, module?: string) {
  const rows = await db.select({
    id: users.id, fullName: users.fullName, email: users.email,
    platformRole: platformRoles.name, workspaceRole: workspaceRoles.name, permissionKey: permissions.key,
  })
    .from(users)
    .leftJoin(platformRoles, eq(users.platformRoleId, platformRoles.id))
    .leftJoin(userWorkspaceRoles, and(eq(userWorkspaceRoles.userId, users.id), eq(userWorkspaceRoles.status, "active"), isNull(userWorkspaceRoles.deletedAt)))
    .leftJoin(workspaceRoles, and(eq(workspaceRoles.id, userWorkspaceRoles.workspaceRoleId), isNull(workspaceRoles.deletedAt), eq(workspaceRoles.status, "active")))
    .leftJoin(workspaceRolePermissions, and(eq(workspaceRolePermissions.workspaceRoleId, workspaceRoles.id), eq(workspaceRolePermissions.status, "active"), isNull(workspaceRolePermissions.deletedAt)))
    .leftJoin(permissions, and(eq(permissions.id, workspaceRolePermissions.permissionId), eq(permissions.status, "active"), isNull(permissions.deletedAt)))
    .where(and(eq(users.organizationId, organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt)));
  const byUser = new Map<string, { fullName: string; email: string; platformRole: string | null; roles: Set<string>; canApprove: boolean }>();
  for (const row of rows) {
    const entry = byUser.get(row.id) ?? { fullName: row.fullName, email: row.email, platformRole: row.platformRole, roles: new Set<string>(), canApprove: false };
    if (row.workspaceRole) entry.roles.add(row.workspaceRole);
    if (row.permissionKey) entry.canApprove ||= (module ? [module] : qaqcActivityGroups.map(g => g.module))
      .some(m => qaqcPermissionMatches(row.permissionKey!, m, "approve_reject"));
    byUser.set(row.id, entry);
  }
  return [...byUser.entries()]
    .filter(([, entry]) => ["Super Admin", "Org Admin"].includes(entry.platformRole ?? "") || entry.canApprove)
    .map(([id, entry]) => ({ id, fullName: entry.fullName, email: entry.email, roles: [...entry.roles].sort() }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function assertQaqcApprover(req: Request, approverId: string) {
  if (approverId === actor(req)) throw new HttpError(422, "The approver must be different from the submitter");
  const approvers = await eligibleQaqcApprovers(org(req), req.originalUrl.includes("/quality-briefs") ? "quality_briefs" : "metrics");
  if (!approvers.some((a) => a.id === approverId)) throw new HttpError(422, "Selected approver is not an active QA/QC approver");
}

router.get("/approvers", asyncHandler(async (req, res) => {
  const approvers = await eligibleQaqcApprovers(req.currentUser!.organizationId);
  res.json(approvers.filter((approver) => approver.id !== req.currentUser!.id));
}));
const titleState = (value: string) => value.split("_").map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");

function body<T>(schema: { safeParse: (value: unknown) => any }, req: Request): T {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data as T;
}

async function audit(req: Request, action: string, entityType: string, entityId: string, before?: any, after?: any) {
  await writeAuditLog(db, "qaqc", {
    organizationId: org(req), actorId: actor(req), action, entityType, entityId,
    before, after, ipAddress: req.ip,
  });
}

function activeClauses(table: Table, organizationId: string, extra: any[] = []) {
  // Append-only tables (audit_log_entries) intentionally have no deletedAt column.
  const base: any[] = [eq(table.organizationId, organizationId)];
  if ("deletedAt" in table) base.push(isNull(table.deletedAt));
  return and(...base, ...extra);
}

async function pageTable(req: Request, table: Table, clauses: any[] = []) {
  const { page, limit, offset } = pagination(req);
  const scope = await getAuthorizedProjectScope(req, "qaqc");
  if (!scope.unrestricted && table.projectId) clauses.push(inArray(table.projectId, scope.projectIds));
  const ownership = qaqcOwnershipClause(req, table);
  if (ownership) clauses.push(ownership);
  const where = activeClauses(table, org(req), clauses);
  const [items, totals] = await Promise.all([
    db.select().from(table).where(where).orderBy(desc(table.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(table).where(where),
  ]);
  return paginated(items, Number(totals[0]?.value ?? 0), page, limit);
}

async function activeRow(req: Request, table: Table, id: string) {
  const scope = await getAuthorizedProjectScope(req, "qaqc");
  const [row] = await db.select().from(table).where(and(
    eq(table.id, id), activeClauses(table, org(req)),
    !req.permissionAdminBypass && !scope.unrestricted && table.projectId ? inArray(table.projectId, scope.projectIds) : undefined,
    qaqcOwnershipClause(req, table),
  )).limit(1);
  if (!row) throw new HttpError(404, "Resource not found");
  return row;
}
function qaqcOwnershipClause(req: Request, table: Table) {
  if (req.permissionAdminBypass) return undefined;
  const full = req.permissionFullProjectScope;
  if (full?.unrestricted) return undefined;
  const own = qaqcOwnedRecordClause(req, table);
  if (!own) return undefined;
  if (full?.projectIds.length && table.projectId) return or(inArray(table.projectId, full.projectIds), own);
  return req.permissionScope === "own" ? own : undefined;
}

async function softDelete(req: Request, res: Response, table: Table, type: string) {
  const before = await activeRow(req, table, String(req.params.id));
  const [deleted] = await db.update(table).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() })
    .where(eq(table.id, before.id)).returning();
  await audit(req, "delete", type, before.id, before, deleted);
  res.status(204).send();
}

function monthStart(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
}

function mapMetric(row: any, target = 100) {
  const closureRate = row.issuedCount === 0 && row.closedCount === 0
    ? 100 : row.issuedCount === 0 ? 0 : (row.closedCount / row.issuedCount) * 100;
  const variance = closureRate - target;
  return {
    ...row, period: row.reportingPeriod, workflowState: titleState(row.status),
    closureRate: +closureRate.toFixed(2), variance: +variance.toFixed(2),
    pqi: +Math.max(0, Math.min(100, closureRate)).toFixed(2),
  };
}

function mapMaterial(row: any) {
  return {
    ...row, period: row.reportingPeriod, approved: row.approvedCount,
    onHold: row.onHoldCount, rejected: row.rejectedCount, hazardous: row.hazardousCount,
    handleWithCare: row.handleWithCareCount,
  };
}

function mapQtbt(row: any) {
  return { ...row, period: row.reportingPeriod, attendance: row.attendanceCount };
}

function mapCustomer(row: any) {
  const dimensions = row.dimensions ?? {};
  return {
    ...row, period: row.reportingPeriod,
    serviceRatings: Array.isArray(dimensions) ? dimensions : Object.values(dimensions),
    outcomes: Array.isArray(row.outcomes) ? row.outcomes : Object.values(row.outcomes ?? {}),
  };
}

function mapDocument(row: any) {
  return {
    ...row, date: row.reportingPeriod, documentType: row.entity,
    status: row.statusValue, reviewDays: Number(row.averageReviewDays),
    pendingWith: row.status, correspondenceCount: row.count,
  };
}

function mapBrief(row: any) {
  return {
    ...row, period: row.reportingPeriod, workflowState: titleState(row.workflowState),
    aiReviewDecision: row.aiReviewState,
  };
}

// Reference data
router.get("/disciplines", asyncHandler(async (req, res) => {
  const page = await pageTable(req, disciplines);
  res.json({ ...page, items: page.items.map((r: any) => ({ id: r.id, code: r.code, name: r.name, active: r.status === "active", metadata: {} })) });
}));
router.get("/targets", asyncHandler(async (req, res) => {
  const page = await pageTable(req, targetBenchmarks);
  res.json({ ...page, items: page.items.map((r: any) => ({ id: r.id, code: r.metricKey, name: r.metricKey, active: r.status === "active", metadata: { targetValue: Number(r.targetValue), period: r.period } })) });
}));
router.get("/distribution-lists", asyncHandler(async (req, res) => {
  const page = await pageTable(req, distributionLists);
  res.json({ ...page, items: page.items.map((r: any) => ({ id: r.id, code: null, name: r.name, active: r.status === "active", metadata: { memberIds: r.memberIds, cadence: r.cadence } })) });
}));
router.get("/categorisation", asyncHandler(async (req, res) => {
  const page = await pageTable(req, categorisationRiskMaster);
  res.json({ ...page, items: page.items.map((r: any) => ({ id: r.id, code: null, name: r.category, active: r.status === "active", metadata: { impact: r.impact, riskLevel: r.riskLevel } })) });
}));

// Metrics
router.get("/metrics", asyncHandler(async (req, res) => {
  const filters: any[] = [];
  if (req.query.projectId) filters.push(eq(qaqcMetricEntries.projectId, String(req.query.projectId)));
  if (req.query.period) filters.push(eq(qaqcMetricEntries.reportingPeriod, monthStart(String(req.query.period))));
  const result = await pageTable(req, qaqcMetricEntries, filters);
  res.json({ ...result, items: result.items.map(mapMetric) });
}));
router.post("/metrics", asyncHandler(async (req, res) => {
  const value: any = body(api.CreateQaqcMetricBody, req);
  await assertFieldAccess(req, "qaqc", "metric-entry", { mode: "create" });
  await assertFieldControls(req, "qaqc", "metric", { mode: "create" });
  let row: any;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    // Reference numbers come from the org's QA/QC numbering pattern (Admin Settings → Numbering).
    const referenceNumber = await allocateReferenceNumber(org(req), "qaqc");
    try {
      [row] = await db.insert(qaqcMetricEntries).values({
        organizationId: org(req), projectId: value.projectId, reportingPeriod: monthStart(value.period),
        category: value.category, issuedCount: value.issuedCount, closedCount: value.closedCount,
        ageing0To15: value.ageing0To15, ageing15To45: value.ageing15To45,
        ageingOver45: value.ageingOver45, status: "draft", referenceNumber,
      }).returning();
    } catch (error) {
      if (!(error instanceof Error) || !String(error.message).includes("qaqc_metric_reference_active_idx")) throw error;
    }
  }
  if (!row) throw new HttpError(409, "Unable to allocate a unique metric reference number");
  await audit(req, "create", "metric", row.id, undefined, row);
  res.status(201).json(mapMetric(row));
}));
router.put("/metrics/:id", asyncHandler(async (req, res) => {
  const value: any = body(api.UpdateQaqcMetricBody, req);
  const before: any = await activeRow(req, qaqcMetricEntries, String(req.params.id));
  if (!["draft", "sent_back"].includes(before.status)) throw new HttpError(409, "Only draft or sent-back metrics can be edited");
  await assertFieldAccess(req, "qaqc", "metric-entry", { mode: "update", current: mapMetric(before) });
  await assertFieldControls(req, "qaqc", "metric", { mode: "update", current: mapMetric(before) });
  const [row] = await db.update(qaqcMetricEntries).set({
    projectId: value.projectId, reportingPeriod: monthStart(value.period), category: value.category,
    issuedCount: value.issuedCount, closedCount: value.closedCount, ageing0To15: value.ageing0To15,
    ageing15To45: value.ageing15To45, ageingOver45: value.ageingOver45, updatedAt: new Date(),
  }).where(eq(qaqcMetricEntries.id, before.id)).returning();
  await audit(req, "update", "metric", row.id, before, row);
  res.json(mapMetric(row));
}));
router.delete("/metrics/:id", asyncHandler((req, res) => softDelete(req, res, qaqcMetricEntries, "metric")));
router.post("/metrics/:id/submit", asyncHandler(async (req, res) => {
  const value: any = req.body && Object.keys(req.body).length ? body(api.SubmitQaqcMetricBody, req) : {};
  const before: any = await activeRow(req, qaqcMetricEntries, String(req.params.id));
  if (!["draft", "sent_back"].includes(before.status)) throw new HttpError(409, "Metric is not eligible for submission");
  const approverId = value.approverId ?? before.approverId;
  if (!approverId) throw new HttpError(422, "An approver is required before submission");
  await assertQaqcApprover(req, approverId);
  const [row] = await db.update(qaqcMetricEntries).set({ status: "submitted", approverId, submittedById: actor(req), updatedAt: new Date() }).where(eq(qaqcMetricEntries.id, before.id)).returning();
  await audit(req, "submit", "metric", row.id, before, row);
  await notifyWithEmail(db, "qaqc", { organizationId: org(req), userId: approverId, type: "approval", title: "Metric awaiting review", body: `${row.category} has been submitted.`, entityType: "metric", entityId: row.id });
  res.json(mapMetric(row));
}));
router.post("/metrics/:id/review", asyncHandler(async (req, res) => {
  const value: any = body(api.ReviewQaqcMetricBody, req);
  if (value.decision === "send_back" && !value.comments?.trim()) throw new HttpError(422, "Comments are required when sending back");
  const before: any = await activeRow(req, qaqcMetricEntries, String(req.params.id));
  if (before.status !== "submitted") throw new HttpError(409, "Only submitted metrics can be reviewed");
  // Self-review is never allowed — not even for admins with review bypass.
  if (before.submittedById === actor(req)) throw new HttpError(403, "You cannot review a metric you submitted");
  if (!req.permissionAdminBypass && before.approverId !== actor(req)) throw new HttpError(403, "Only the designated approver may review this metric");
  const state = value.decision === "approve" ? "approved" : "sent_back";
  const [row] = await db.update(qaqcMetricEntries).set({ status: state, updatedAt: new Date() }).where(eq(qaqcMetricEntries.id, before.id)).returning();
  await audit(req, value.decision, "metric", row.id, before, { ...row, reviewComments: value.comments });
  const recipient = before.submittedById ?? before.createdById;
  if (recipient) await notifyWithEmail(db, "qaqc", { organizationId: org(req), userId: recipient, type: "decision", title: `Metric ${state}`, body: value.comments || `Your metric was ${state}.`, entityType: "metric", entityId: row.id }).catch((error) => console.error(`qaqc decision notification failed for metric ${row.id}`, error));
  res.json(mapMetric(row));
}));

// Standard QA/QC entry CRUD
function inspectionValues(value: any) {
  return {
    projectId: value.projectId, reportingPeriod: monthStart(value.period), mirnTotal: value.mirnTotal,
    osdCount: value.osdCount ?? 0, approvedCount: value.approved, onHoldCount: value.onHold,
    rejectedCount: value.rejected, hazardousCount: value.hazardous,
    handleWithCareCount: value.handleWithCare,
  };
}
function validateInspection(v: any) {
  if (v.approved + v.onHold + v.rejected + v.hazardous + v.handleWithCare !== v.mirnTotal)
    throw new HttpError(422, "Material inspection status counts must reconcile exactly to mirnTotal");
}
router.get("/material-inspections", asyncHandler(async (req, res) => {
  const result = await pageTable(req, materialInspectionEntries); res.json({ ...result, items: result.items.map(mapMaterial) });
}));
router.post("/material-inspections", asyncHandler(async (req, res) => {
  const value: any = body(api.CreateMaterialInspectionBody, req); validateInspection(value);
  await assertFieldAccess(req, "qaqc", "material-inspection", { mode: "create" });
  await assertFieldControls(req, "qaqc", "material-inspection", { mode: "create" });
  const [row] = await db.insert(materialInspectionEntries).values({ organizationId: org(req), ...inspectionValues(value) }).returning();
  await audit(req, "create", "material_inspection", row.id, undefined, row); res.status(201).json(mapMaterial(row));
}));
router.put("/material-inspections/:id", asyncHandler(async (req, res) => {
  const value: any = body(api.UpdateMaterialInspectionBody, req); validateInspection(value);
  const before: any = await activeRow(req, materialInspectionEntries, String(req.params.id));
  await assertFieldAccess(req, "qaqc", "material-inspection", { mode: "update", current: mapMaterial(before) });
  await assertFieldControls(req, "qaqc", "material-inspection", { mode: "update", current: mapMaterial(before) });
  const [row] = await db.update(materialInspectionEntries).set({ ...inspectionValues(value), updatedAt: new Date() }).where(eq(materialInspectionEntries.id, before.id)).returning();
  await audit(req, "update", "material_inspection", row.id, before, row); res.json(mapMaterial(row));
}));
router.delete("/material-inspections/:id", asyncHandler((req, res) => softDelete(req, res, materialInspectionEntries, "material_inspection")));

router.get("/qtbt", asyncHandler(async (req, res) => {
  const result = await pageTable(req, qtbtEntries); res.json({ ...result, items: result.items.map(mapQtbt) });
}));
router.post("/qtbt", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateQtbtEntryBody, req);
  await assertFieldAccess(req, "qaqc", "qtbt", { mode: "create" });
  await assertFieldControls(req, "qaqc", "qtbt", { mode: "create" });
  const [row] = await db.insert(qtbtEntries).values({ organizationId: org(req), projectId: v.projectId, reportingPeriod: v.period, talkCount: v.talkCount, attendanceCount: v.attendance, durationMinutes: v.durationMinutes }).returning();
  await audit(req, "create", "qtbt", row.id, undefined, row); res.status(201).json(mapQtbt(row));
}));
router.put("/qtbt/:id", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateQtbtEntryBody, req); const before: any = await activeRow(req, qtbtEntries, String(req.params.id));
  await assertFieldAccess(req, "qaqc", "qtbt", { mode: "update", current: mapQtbt(before) });
  await assertFieldControls(req, "qaqc", "qtbt", { mode: "update", current: mapQtbt(before) });
  const [row] = await db.update(qtbtEntries).set({ projectId: v.projectId, reportingPeriod: v.period, talkCount: v.talkCount, attendanceCount: v.attendance, durationMinutes: v.durationMinutes, updatedAt: new Date() }).where(eq(qtbtEntries.id, before.id)).returning();
  await audit(req, "update", "qtbt", row.id, before, row); res.json(mapQtbt(row));
}));
router.delete("/qtbt/:id", asyncHandler((req, res) => softDelete(req, res, qtbtEntries, "qtbt")));

router.get("/customer-satisfaction", asyncHandler(async (req, res) => {
  const result = await pageTable(req, customerSatisfactionEntries); res.json({ ...result, items: result.items.map(mapCustomer) });
}));
router.post("/customer-satisfaction", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateCustomerSatisfactionEntryBody, req);
  await assertFieldAccess(req, "qaqc", "customer-satisfaction", { mode: "create" });
  await assertFieldControls(req, "qaqc", "customer-satisfaction", { mode: "create" });
  const [row] = await db.insert(customerSatisfactionEntries).values({ organizationId: org(req), projectId: v.projectId, reportingPeriod: v.period, dimensions: v.serviceRatings, outcomes: v.outcomes ?? [], feedback: v.feedback }).returning();
  await audit(req, "create", "customer_satisfaction", row.id, undefined, row); res.status(201).json(mapCustomer(row));
}));
router.put("/customer-satisfaction/:id", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateCustomerSatisfactionEntryBody, req); const before: any = await activeRow(req, customerSatisfactionEntries, String(req.params.id));
  await assertFieldAccess(req, "qaqc", "customer-satisfaction", { mode: "update", current: mapCustomer(before) });
  await assertFieldControls(req, "qaqc", "customer-satisfaction", { mode: "update", current: mapCustomer(before) });
  const [row] = await db.update(customerSatisfactionEntries).set({ projectId: v.projectId, reportingPeriod: v.period, dimensions: v.serviceRatings, outcomes: v.outcomes ?? [], feedback: v.feedback, updatedAt: new Date() }).where(eq(customerSatisfactionEntries.id, before.id)).returning();
  await audit(req, "update", "customer_satisfaction", row.id, before, row); res.json(mapCustomer(row));
}));
router.delete("/customer-satisfaction/:id", asyncHandler((req, res) => softDelete(req, res, customerSatisfactionEntries, "customer_satisfaction")));

function documentValues(v: any) {
  return { projectId: v.projectId, reportingPeriod: v.date.toISOString().slice(0, 10), disciplineId: v.disciplineId, entity: v.documentType, statusValue: v.status, averageReviewDays: String(v.reviewDays ?? 0), pendingDays: v.pendingDays ?? 0, count: v.correspondenceCount ?? 0, status: v.pendingWith };
}
router.get("/document-governance-log", asyncHandler(async (req, res) => {
  const result = await pageTable(req, documentGovernanceLogEntries); res.json({ ...result, items: result.items.map(mapDocument) });
}));
router.post("/document-governance-log", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateDocumentGovernanceEntryBody, req);
  await assertFieldAccess(req, "qaqc", "document-governance-log", { mode: "create" });
  await assertFieldControls(req, "qaqc", "document-log", { mode: "create" });
  await Promise.all([
    assertLovValue(db, org(req), "document_types", v.documentType),
    assertLovValue(db, org(req), "document_statuses", v.status),
    assertLovValue(db, org(req), "pending_with", v.pendingWith),
  ]);
  const [row] = await db.insert(documentGovernanceLogEntries).values({ organizationId: org(req), ...documentValues(v) }).returning();
  await audit(req, "create", "document_governance", row.id, undefined, row); res.status(201).json(mapDocument(row));
}));
router.put("/document-governance-log/:id", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateDocumentGovernanceEntryBody, req); const before: any = await activeRow(req, documentGovernanceLogEntries, String(req.params.id));
  await assertFieldAccess(req, "qaqc", "document-governance-log", { mode: "update", current: mapDocument(before) });
  await assertFieldControls(req, "qaqc", "document-log", { mode: "update", current: mapDocument(before) });
  await Promise.all([
    assertLovValue(db, org(req), "document_types", v.documentType, { allowLegacy: before.entity }),
    assertLovValue(db, org(req), "document_statuses", v.status, { allowLegacy: before.statusValue }),
    assertLovValue(db, org(req), "pending_with", v.pendingWith, { allowLegacy: before.status }),
  ]);
  const [row] = await db.update(documentGovernanceLogEntries).set({ ...documentValues(v), updatedAt: new Date() }).where(eq(documentGovernanceLogEntries.id, before.id)).returning();
  await audit(req, "update", "document_governance", row.id, before, row); res.json(mapDocument(row));
}));
router.delete("/document-governance-log/:id", asyncHandler((req, res) => softDelete(req, res, documentGovernanceLogEntries, "document_governance")));

// Quality briefs and approval workflow
router.get("/quality-briefs", asyncHandler(async (req, res) => {
  const result = await pageTable(req, qualityAssessmentBriefs); res.json({ ...result, items: result.items.map(mapBrief) });
}));
router.post("/quality-briefs", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateQualityBriefBody, req);
  await assertFieldAccess(req, "qaqc", "quality-brief", { mode: "create" });
  await assertFieldControls(req, "qaqc", "quality-brief", { mode: "create" });
  const [row] = await db.insert(qualityAssessmentBriefs).values({ organizationId: org(req), projectId: v.projectId, reportingPeriod: v.period, narrative: v.narrative, aiDraft: v.aiDraft, aiReviewState: v.aiReviewDecision, workflowState: "draft" }).returning();
  await audit(req, "create", "quality_brief", row.id, undefined, row); res.status(201).json(mapBrief(row));
}));
router.put("/quality-briefs/:id", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateQualityBriefBody, req); const before: any = await activeRow(req, qualityAssessmentBriefs, String(req.params.id));
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Only draft or sent-back briefs can be edited");
  await assertFieldAccess(req, "qaqc", "quality-brief", { mode: "update", current: mapBrief(before) });
  await assertFieldControls(req, "qaqc", "quality-brief", { mode: "update", current: mapBrief(before) });
  const [row] = await db.update(qualityAssessmentBriefs).set({ projectId: v.projectId, reportingPeriod: v.period, narrative: v.narrative, aiDraft: v.aiDraft, aiReviewState: v.aiReviewDecision, updatedAt: new Date() }).where(eq(qualityAssessmentBriefs.id, before.id)).returning();
  await audit(req, "update", "quality_brief", row.id, before, row); res.json(mapBrief(row));
}));
router.post("/quality-briefs/:id/ai-draft", asyncHandler(async (req, res) => {
  const brief: any = await activeRow(req, qualityAssessmentBriefs, String(req.params.id));
  try {
    const metrics = await db.select().from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, org(req)), eq(qaqcMetricEntries.projectId, brief.projectId), eq(qaqcMetricEntries.reportingPeriod, brief.reportingPeriod), isNull(qaqcMetricEntries.deletedAt), ...await qaqcRecordReadClauses(req, qaqcMetricEntries, "metrics")));
    const generated = await draftQualityBrief({ app: "qaqc", organizationId: org(req), actorId: actor(req), brief, metrics: metrics.map(mapMetric) });
    await db.update(qualityAssessmentBriefs).set({ aiDraft: generated.draft, aiReviewState: "pending", updatedAt: new Date() }).where(eq(qualityAssessmentBriefs.id, brief.id));
    await audit(req, "ai_draft", "quality_brief", brief.id, brief, { aiDraft: generated.draft });
    res.json(generated);
  } catch (error) {
    if (error instanceof AiUnavailableError) { res.status(503).json({ error: error.message }); return; }
    throw error;
  }
}));
router.post("/quality-briefs/:id/submit", asyncHandler(async (req, res) => {
  const value: any = req.body && Object.keys(req.body).length ? body(api.SubmitQualityBriefBody, req) : {};
  const before: any = await activeRow(req, qualityAssessmentBriefs, String(req.params.id));
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Brief is not eligible for submission");
  const approverId = value.approverId ?? before.approverId;
  if (!approverId) throw new HttpError(422, "An approver is required before submission");
  await assertQaqcApprover(req, approverId);
  const [row] = await db.update(qualityAssessmentBriefs).set({ workflowState: "submitted", submittedById: actor(req), approverId, updatedAt: new Date() }).where(eq(qualityAssessmentBriefs.id, before.id)).returning();
  await audit(req, "submit", "quality_brief", row.id, before, row);
  await notifyWithEmail(db, "qaqc", { organizationId: org(req), userId: approverId, type: "approval", title: "Quality brief awaiting review", body: "A quality assessment brief was submitted.", entityType: "quality_brief", entityId: row.id });
  res.json(mapBrief(row));
}));
router.post("/quality-briefs/:id/review", asyncHandler(async (req, res) => {
  const v: any = body(api.ReviewQualityBriefBody, req);
  if (v.decision === "send_back" && !v.comments?.trim()) throw new HttpError(422, "Comments are required when sending back");
  const before: any = await activeRow(req, qualityAssessmentBriefs, String(req.params.id));
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted briefs can be reviewed");
  // Self-review is never allowed — not even for admins with review bypass.
  if (before.submittedById === actor(req)) throw new HttpError(403, "You cannot review a brief you submitted");
  if (!req.permissionAdminBypass && before.approverId !== actor(req)) throw new HttpError(403, "Only the designated approver may review this brief");
  const state = v.decision === "approve" ? "approved" : "sent_back";
  const [row] = await db.update(qualityAssessmentBriefs).set({ workflowState: state, approvedById: state === "approved" ? actor(req) : null, updatedAt: new Date() }).where(eq(qualityAssessmentBriefs.id, before.id)).returning();
  await audit(req, v.decision, "quality_brief", row.id, before, { ...row, reviewComments: v.comments });
  if (before.submittedById) await notifyWithEmail(db, "qaqc", { organizationId: org(req), userId: before.submittedById, type: "decision", title: `Quality brief ${state}`, body: v.comments || `Your brief was ${state}.`, entityType: "quality_brief", entityId: row.id });
  res.json(mapBrief(row));
}));

async function pqiData(req: Request) {
  const projectId = String(req.query.projectId ?? "");
  const period = String(req.query.period ?? "");
  const clauses: any[] = [eq(qaqcMetricEntries.organizationId, org(req)), isNull(qaqcMetricEntries.deletedAt)];
  clauses.push(...await qaqcRecordReadClauses(req, qaqcMetricEntries, "metrics"));
  const scope = await getAuthorizedProjectScope(req, "qaqc", { module: "metrics", action: "select" });
  if (projectId) {
    if (!scope.unrestricted && !scope.projectIds.includes(projectId)) throw new HttpError(403, "You do not have access to this project");
    clauses.push(eq(qaqcMetricEntries.projectId, projectId));
  } else if (!scope.unrestricted) {
    clauses.push(inArray(qaqcMetricEntries.projectId, scope.projectIds));
  }
  if (period) clauses.push(eq(qaqcMetricEntries.reportingPeriod, monthStart(period)));
  const [rows, targets] = await Promise.all([
    db.select().from(qaqcMetricEntries).where(and(...clauses)),
    db.select().from(targetBenchmarks).where(and(eq(targetBenchmarks.organizationId, org(req)), isNull(targetBenchmarks.deletedAt))),
  ]);
  const targetMap = new Map(targets.map((t) => [t.metricKey, Number(t.targetValue)]));
  const categories = rows.map((r) => {
    const target = targetMap.get(r.category) ?? 100;
    const m = mapMetric(r, target);
    return { category: r.category, closureRate: m.closureRate, variance: m.variance, score: m.pqi };
  });
  const pqi = categories.length ? categories.reduce((sum, c) => sum + c.score, 0) / categories.length : 100;
  return { projectId, period, pqi: +pqi.toFixed(2), categories };
}
router.get("/pqi", asyncHandler(async (req, res) => res.json(await pqiData(req))));
router.get("/dashboard", asyncHandler(async (req, res) => {
  const pqi = await pqiData(req);
  const series = req.query.category ? pqi.categories.filter((c) => c.category === req.query.category) : pqi.categories;
  res.json({ generatedAt: new Date(), metrics: { pqi: pqi.pqi, categoryCount: series.length }, series });
}));

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
const toCsv = (headers: string[], rows: unknown[][]) => [headers, ...rows.map(row => row.map((value, index) =>
  isSpreadsheetDateField(headers[index] ?? "") ? formatSpreadsheetDate(value) : value))].map((row) => row.map(csvCell).join(",")).join("\r\n");
function sendDownload(res: Response, fileName: string, csv: string) {
  res.json({ delivery: "download", fileName, downloadUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`, message: null });
}
router.get("/reports/monthly", asyncHandler(async (req, res) => {
  const filters: any[] = await qaqcRecordReadClauses(req, qaqcMetricEntries, "metrics", "export");
  const scope = await getAuthorizedProjectScope(req, "qaqc");
  if (req.query.projectId) {
    await assertProjectAccess(req, String(req.query.projectId));
    filters.push(eq(qaqcMetricEntries.projectId, String(req.query.projectId)));
  } else if (!scope.unrestricted) filters.push(inArray(qaqcMetricEntries.projectId, scope.projectIds));
  if (req.query.period) filters.push(eq(qaqcMetricEntries.reportingPeriod, monthStart(String(req.query.period))));
  const rows = await db.select().from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, org(req)), isNull(qaqcMetricEntries.deletedAt), ...filters)).orderBy(asc(qaqcMetricEntries.category));
  sendDownload(res, "qaqc-monthly.csv", toCsv(["Project ID", "Period", "Category", "Issued", "Closed", "0-15", "15-45", ">45", "Closure Rate"], rows.map((r) => { const m = mapMetric(r); return [r.projectId, r.reportingPeriod, r.category, r.issuedCount, r.closedCount, r.ageing0To15, r.ageing15To45, r.ageingOver45, m.closureRate]; })));
}));
router.get("/reports/document-governance", asyncHandler(async (req, res) => {
  const filters: any[] = await qaqcRecordReadClauses(req, documentGovernanceLogEntries, "document_governance", "export");
  const scope = await getAuthorizedProjectScope(req, "qaqc", { module: "document_governance", action: "select" });
  if (req.query.projectId) {
    const projectId = String(req.query.projectId);
    if (!scope.unrestricted && !scope.projectIds.includes(projectId)) throw new HttpError(403, "You do not have access to this project");
    filters.push(eq(documentGovernanceLogEntries.projectId, projectId));
  } else if (!scope.unrestricted) filters.push(inArray(documentGovernanceLogEntries.projectId, scope.projectIds));
  if (req.query.period) filters.push(eq(documentGovernanceLogEntries.reportingPeriod, monthStart(String(req.query.period))));
  const rows = await db.select().from(documentGovernanceLogEntries).where(and(eq(documentGovernanceLogEntries.organizationId, org(req)), isNull(documentGovernanceLogEntries.deletedAt), ...filters));
  sendDownload(res, "document-governance.csv", toCsv(["Project ID", "Date", "Discipline ID", "Document Type", "Status", "Review Days", "Pending With", "Pending Days", "Correspondence Count"], rows.map((r) => { const m = mapDocument(r); return [m.projectId, m.date, m.disciplineId, m.documentType, m.status, m.reviewDays, m.pendingWith, m.pendingDays, m.correspondenceCount]; })));
}));
const TEMPLATE_HEADERS = ["id", "projectId", "period (DD/MM/YYYY)", "category", "issuedCount", "closedCount", "ageing0To15", "ageing15To45", "ageingOver45", "workflowState"];
router.get("/metrics/template", asyncHandler(async (req, res) => {
  if (String(req.query.format ?? "") === "xlsx") {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    const instructions = XLSX.utils.aoa_to_sheet([["Date format", "DD/MM/YYYY"], ["Period", "Enter the reporting date as DD/MM/YYYY. The reporting month is derived from this date."]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Metrics");
    XLSX.utils.book_append_sheet(book, instructions, "Instructions");
    const buffer = XLSX.write(applyExcelDateFormats(book), { type: "buffer", bookType: "xlsx", sheetStubs: true }) as Buffer;
    res.json({ delivery: "download", fileName: "qaqc-metrics-template.xlsx", downloadUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`, message: null });
    return;
  }
  sendDownload(res, "qaqc-metrics-template.csv", toCsv(TEMPLATE_HEADERS, []));
}));
router.post("/metrics/import", asyncHandler(async (req, res) => {
  if (!Array.isArray(req.body)) {
    res.status(422).json({ error: "Import validation failed", details: [{ message: "Request body must be an array of metric rows" }] }); return;
  }
  let created = 0; let updated = 0; const errors: Array<{ error: string }> = [];
  for (const [index, item] of (req.body as unknown[]).entries()) {
    const parsed = api.ImportQaqcMetricsBodyItem.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ error: `Row ${index + 1}: ${issue ? `${issue.path.join(".") || "row"}: ${issue.message}` : "Invalid row"}` });
      continue;
    }
    const v = parsed.data;
    try {
      await assertProjectInOrg(db, org(req), v.projectId);
      await assertProjectAccess(req, v.projectId);
      const [existing] = await db.select().from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, org(req)), eq(qaqcMetricEntries.projectId, v.projectId), eq(qaqcMetricEntries.reportingPeriod, monthStart(v.period)), eq(qaqcMetricEntries.category, v.category), isNull(qaqcMetricEntries.deletedAt))).limit(1);
      const values = { projectId: v.projectId, reportingPeriod: monthStart(v.period), category: v.category, issuedCount: v.issuedCount, closedCount: v.closedCount, ageing0To15: v.ageing0To15, ageing15To45: v.ageing15To45, ageingOver45: v.ageingOver45, status: v.workflowState.toLowerCase().replace(" ", "_"), updatedAt: new Date() };
      if (existing) {
        await activeRow(req, qaqcMetricEntries, existing.id);
        // Bulk imports must not overwrite admin-locked fields — same rule as the form APIs.
        await assertFieldAccess(req, "qaqc", "metric-entry", { mode: "update", current: mapMetric(existing), body: v as Record<string, unknown> });
        const [row] = await db.update(qaqcMetricEntries).set(values).where(eq(qaqcMetricEntries.id, existing.id)).returning(); await audit(req, "import_update", "metric", row.id, existing, row); updated++;
      } else {
        await assertFieldAccess(req, "qaqc", "metric-entry", { mode: "create", body: v as Record<string, unknown> });
        const [row] = await db.insert(qaqcMetricEntries).values({ organizationId: org(req), ...values }).returning(); await audit(req, "import_create", "metric", row.id, undefined, row); created++;
      }
    } catch (error) { errors.push({ error: `Row ${index + 1}: ${error instanceof Error ? error.message : "Import failed"}` }); }
  }
  res.json({ created, updated, rejected: errors.length, errors });
}));

router.get("/approvals", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const [metricScope, briefScope] = await Promise.all([
    getAuthorizedProjectScope(req, "qaqc", { module: "metrics", action: "select", operation: "review" }),
    getAuthorizedProjectScope(req, "qaqc", { module: "quality_briefs", action: "select", operation: "review" }),
  ]);
  const [metrics, briefs] = await Promise.all([
    db.select().from(qaqcMetricEntries).where(and(
      eq(qaqcMetricEntries.organizationId, org(req)),
      eq(qaqcMetricEntries.status, "submitted"),
      isNull(qaqcMetricEntries.deletedAt),
      metricScope.unrestricted ? undefined : inArray(qaqcMetricEntries.projectId, metricScope.projectIds),
    )),
    db.select().from(qualityAssessmentBriefs).where(and(
      eq(qualityAssessmentBriefs.organizationId, org(req)),
      eq(qualityAssessmentBriefs.workflowState, "submitted"),
      isNull(qualityAssessmentBriefs.deletedAt),
      briefScope.unrestricted ? undefined : inArray(qualityAssessmentBriefs.projectId, briefScope.projectIds),
    )),
  ]);
  const all = [
    ...metrics.map((r) => ({ id: r.id, recordType: "metric", recordId: r.id, title: `${r.category} metric`, submittedAt: r.updatedAt, delegatedFrom: null })),
    ...briefs.map((r) => ({ id: r.id, recordType: "quality_brief", recordId: r.id, title: "Quality assessment brief", submittedAt: r.updatedAt, delegatedFrom: null })),
  ].sort((a, b) => b.submittedAt.valueOf() - a.submittedAt.valueOf());
  res.json(paginated(all.slice((page - 1) * limit, page * limit), all.length, page, limit));
}));

// AI prompt sessions
type PromptSession = { organizationId: string; actorId: string; extracted: Record<string, unknown>; requiredFields: string[]; missing: Array<{ field: string; question: string; options: string[] }>; expiresAt: number };
const promptSessions = new Map<string, PromptSession>();
const metricRequiredFields = ["projectId", "period", "category"];
const metricFieldLabels: Record<string, string> = {
  projectId: "project", period: "reporting period", category: "metric category",
  issuedCount: "issued count", closedCount: "closed count", ageing0To15: "0–15 day ageing count",
  ageing15To45: "15–45 day ageing count", ageingOver45: "over 45 day ageing count",
};
const metricValueMissing = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && !value.trim());
function metricMissingFields(
  extracted: Record<string, unknown>,
  requiredFields: string[],
  aiMissing: Array<{ field: string; question: string; options?: string[] }> = [],
) {
  const aiByField = new Map(aiMissing.map((item) => [item.field, item]));
  return requiredFields.filter((field) => metricValueMissing(extracted[field])).map((field) => {
    const fromAi = aiByField.get(field);
    return { field, question: fromAi?.question ?? `What is the ${metricFieldLabels[field] ?? field}?`, options: fromAi?.options ?? [] };
  });
}
router.post("/ai/rephrase", asyncHandler(async (req, res) => {
  const v: any = body(api.RephraseQaqcFieldBody, req);
  try { res.json({ suggestion: await rephraseText({ app: "qaqc", organizationId: org(req), actorId: actor(req), field: v.field, text: v.text, tone: "clear and concise" }) }); }
  catch (error) { if (error instanceof AiUnavailableError) { res.status(503).json({ error: error.message }); return; } throw error; }
}));
router.post("/ai/prompt-to-transaction", asyncHandler(async (req, res) => {
  const v: any = body(api.PromptToQaqcTransactionBody, req);
  try {
    const result = await promptToTransaction({ app: "qaqc", organizationId: org(req), actorId: actor(req), prompt: v.prompt, schemaDescription: "QA/QC metric or quality transaction with projectId, period, category and applicable counts" });
    // Admin-locked (read-only) fields must not enter through AI extraction:
    // drop extracted values for them and never ask the user to supply them.
    const filtered = await filterReadOnlyValues(req.currentUser!, "qaqc", "metric-entry", result.extracted ?? {});
    const readOnly = await readOnlyFields(req.currentUser!, "qaqc", "metric-entry");
    const warnings = [
      ...filtered.skipped.map((field) => `Field "${field}" is read-only and was skipped`),
      ...result.missing.filter((m) => readOnly.has(m.field)).map((m) => `Field "${m.field}" is read-only; no answer is needed`),
    ];
    const controls = (await readFieldControls(org(req), "qaqc")).metric ?? {};
    const configuredRequired = Object.entries(controls).filter(([, setting]) => setting.requirement === "mandatory").map(([field]) => field);
    const requiredFields = [...new Set([...metricRequiredFields, ...configuredRequired])].filter((field) => !readOnly.has(field));
    const missing = metricMissingFields(filtered.values, requiredFields, result.missing.filter((m) => !readOnly.has(m.field)));
    const sessionId = randomUUID();
    promptSessions.set(sessionId, { organizationId: org(req), actorId: actor(req), extracted: filtered.values, requiredFields, missing, expiresAt: Date.now() + 15 * 60_000 });
    res.json({ ...result, extracted: filtered.values, missing, sessionId, warnings, ready: missing.length === 0 });
  } catch (error) { if (error instanceof AiUnavailableError) { res.status(503).json({ error: error.message }); return; } throw error; }
}));
router.post("/ai/prompt-to-transaction/:sessionId/answer", asyncHandler(async (req, res) => {
  const v: any = body(api.AnswerQaqcPromptQuestionBody, req); const id = String(req.params.sessionId);
  const session = promptSessions.get(id);
  if (!session || session.organizationId !== org(req) || session.actorId !== actor(req) || session.expiresAt < Date.now()) { promptSessions.delete(id); throw new HttpError(404, "Prompt session not found or expired"); }
  // Answers are writes too: apply the same read-only field rules as the form APIs.
  await assertFieldAccess(req, "qaqc", "metric-entry", { mode: "create", body: { [v.field]: v.value } });
  session.extracted[v.field] = v.value; session.missing = metricMissingFields(session.extracted, session.requiredFields, session.missing); session.expiresAt = Date.now() + 15 * 60_000;
  res.json({ sessionId: id, extracted: session.extracted, missing: session.missing, ready: session.missing.length === 0 });
}));

// Evidence
const evidenceRecordTables: Record<string, Table> = {
  metric: qaqcMetricEntries,
  qaqc_metric: qaqcMetricEntries,
  material_inspection: materialInspectionEntries,
  qtbt: qtbtEntries,
  customer_satisfaction: customerSatisfactionEntries,
  document_governance: documentGovernanceLogEntries,
  quality_brief: qualityAssessmentBriefs,
};

async function assertEvidenceParent(req: Request, recordType: string, recordId: string, invalidParentAs422 = false) {
  const recordTable = evidenceRecordTables[recordType];
  if (!recordTable) throw new HttpError(422, "Unsupported evidence record type");
  try {
    return await activeRow(req, recordTable, recordId);
  } catch (error) {
    if (invalidParentAs422 && error instanceof HttpError && error.status === 404) {
      throw new HttpError(422, "Evidence record does not belong to this organization");
    }
    throw error;
  }
}

async function scopedEvidenceRow(req: Request, id: string) {
  const [row] = await db.select().from(evidenceFiles).where(and(
    eq(evidenceFiles.id, id),
    eq(evidenceFiles.organizationId, org(req)),
    isNull(evidenceFiles.deletedAt),
  )).limit(1);
  if (!row) throw new HttpError(404, "Evidence not found");
  await assertEvidenceParent(req, row.recordType, row.recordId);
  return row;
}

router.post("/evidence", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateQaqcEvidenceIntentBody, req);
  await assertEvidenceParent(req, v.recordType, v.recordId, true);
  let intent: { id: string; uploadUrl: string };
  try {
    intent = await createEvidenceIntent({
      app: "qaqc", recordType: v.recordType, recordId: v.recordId, category: v.category,
      fileName: v.fileName, mimeType: v.mimeType, sizeBytes: v.sizeBytes,
      clientReference: v.clientReference, userId: actor(req), organizationId: org(req),
    });
  } catch (error) {
    if (error instanceof Error) throw new HttpError(422, error.message);
    throw error;
  }
  await audit(req, "create_evidence_intent", "evidence", intent.id, undefined, v);
  res.status(201).json(intent);
}));
router.put("/evidence/:id/confirm", asyncHandler(async (req, res) => {
  await scopedEvidenceRow(req, String(req.params.id));
  const row = await confirmEvidence(db, "qaqc", String(req.params.id), org(req));
  if (!row) throw new HttpError(404, "Evidence not found");
  await audit(req, "confirm", "evidence", row.id, undefined, row); res.json(row);
}));
router.get("/evidence", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const recordType = String(req.query.recordType);
  const recordId = String(req.query.recordId);
  await assertEvidenceParent(req, recordType, recordId);
  const rows = await listEvidence(db, "qaqc", org(req), recordType, recordId);
  res.json(paginated(rows.slice((page - 1) * limit, page * limit), rows.length, page, limit));
}));
router.delete("/evidence/:id", asyncHandler(async (req, res) => {
  await scopedEvidenceRow(req, String(req.params.id));
  const row = await deleteEvidence(db, "qaqc", String(req.params.id), org(req));
  if (!row) throw new HttpError(404, "Evidence not found");
  await audit(req, "delete", "evidence", row.id, undefined, row); res.status(204).send();
}));

router.get("/notifications", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const rows = await listNotifications(db, "qaqc", req.currentUser!.organizationId, actor(req));
  res.json(paginated(rows.slice((page - 1) * limit, page * limit).map((r) => ({ id: r.id, type: r.channel, title: r.title, message: r.body, critical: false, read: !!r.readAt, recordType: r.recordType, recordId: r.recordId, createdAt: r.createdAt, readAt: r.readAt })), rows.length, page, limit));
}));
router.post("/notifications/:id/read", asyncHandler(async (req, res) => {
  const [row] = await db.update(notifications).set({ readAt: new Date(), updatedAt: new Date() }).where(and(eq(notifications.id, String(req.params.id)), eq(notifications.organizationId, org(req)), eq(notifications.recipientId, actor(req)), isNull(notifications.deletedAt))).returning();
  if (!row) throw new HttpError(404, "Notification not found"); res.status(204).send();
}));

router.get("/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(org(req), "qaqc"));
}));

// Per-application administration
router.use("/admin", asyncHandler(qaqcAdminTask));
router.get("/admin/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(org(req), "qaqc"));
}));
router.put("/admin/field-controls", asyncHandler(async (req, res) => {
  const v = body<FieldControlsMatrix>(api.UpdateQaqcAdminFieldControlsBody, req);
  assertKnownFieldControlKeys("qaqc", v);
  const before = await writeFieldControls(org(req), "qaqc", v);
  await audit(req, "update", "field_controls", org(req), before, v);
  res.json(v);
}));
async function roleResponse(role: any) {
  const rows = await db.select({ key: permissions.key, name: permissions.label }).from(workspaceRolePermissions)
    .innerJoin(permissions, eq(workspaceRolePermissions.permissionId, permissions.id))
    .where(and(eq(workspaceRolePermissions.workspaceRoleId, role.id), isNull(workspaceRolePermissions.deletedAt), isNull(permissions.deletedAt)));
  return { id: role.id, name: role.name, description: role.description, permissions: rows, active: role.status === "active", systemDefault: role.isSystem, scopeType: "organization" as const, scopeIds: [] };
}
router.get("/admin/roles", asyncHandler(async (req, res) => {
  const result = await pageTable(req, workspaceRoles);
  res.json({ ...result, items: await Promise.all(result.items.map(roleResponse)) });
}));
router.post("/admin/roles", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateQaqcRoleBody, req);
  const { role: row } = await saveQaqcRole(org(req), v);
  await audit(req, "create", "workspace_role", row.id, undefined, row); res.status(201).json(await roleResponse(row));
}));
router.put("/admin/roles/:id", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateQaqcRoleBody, req);
  const { before, role: row } = await saveQaqcRole(org(req), v, String(req.params.id));
  await audit(req, "update", "workspace_role", row.id, before, row); res.json(await roleResponse(row));
}));
router.get("/admin/users", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const [allRows, allAssignments, availablePlatformRoles] = await Promise.all([
    db.select().from(users).where(and(eq(users.organizationId, org(req)), isNull(users.deletedAt))).orderBy(asc(users.fullName)),
    db.select().from(userWorkspaceRoles).where(and(eq(userWorkspaceRoles.organizationId, org(req)), isNull(userWorkspaceRoles.deletedAt))),
    db.select({ id: platformRoles.id, name: platformRoles.name }).from(platformRoles).where(and(eq(platformRoles.organizationId, org(req)), isNull(platformRoles.deletedAt))),
  ]);
  const visibleRows = req.permissionAdminBypass ? allRows : allRows.filter((u) =>
    u.id === actor(req) || allAssignments.some((a) => a.userId === u.id && canManageAssignmentScope(req, a.projectIds, a.businessUnitIds)));
  const rows = visibleRows.slice(offset, offset + limit);
  const items = await Promise.all(rows.map(async (u) => {
    const assigned = await db.select({ role: workspaceRoles, assignment: userWorkspaceRoles }).from(userWorkspaceRoles).innerJoin(workspaceRoles, eq(userWorkspaceRoles.workspaceRoleId, workspaceRoles.id)).where(and(eq(userWorkspaceRoles.userId, u.id), isNull(userWorkspaceRoles.deletedAt), isNull(workspaceRoles.deletedAt)));
    const visibleAssigned = assigned.filter((r) => canManageAssignmentScope(req, r.assignment.projectIds, r.assignment.businessUnitIds));
    return { id: u.id, username: u.username, fullName: u.fullName, email: u.email, platformRole: availablePlatformRoles.find((role) => role.id === u.platformRoleId)?.name ?? "Employee", workspaceRoles: await Promise.all(visibleAssigned.map(async (r) => ({ ...(await roleResponse(r.role)), scopeType: r.assignment.projectIds?.length ? "project" as const : "organization" as const, scopeIds: r.assignment.projectIds ?? [] }))), status: u.accessStatus === "active" ? "Active" : "Deactivated", lastAccessAt: u.lastAccessAt };
  }));
  res.json(paginated(items, visibleRows.length, page, limit));
}));
router.post("/admin/users/:userId/roles", asyncHandler(async (req, res) => {
  const v: any = body(api.AssignQaqcUserRoleBody, req);
  const [target, role] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, org(req)), isNull(users.deletedAt))).limit(1),
    db.select({ id: workspaceRoles.id }).from(workspaceRoles).where(and(eq(workspaceRoles.id, v.roleId), eq(workspaceRoles.organizationId, org(req)), eq(workspaceRoles.status, "active"), isNull(workspaceRoles.deletedAt))).limit(1),
  ]);
  if (!target[0] || !role[0]) throw new HttpError(404, "User or role not found");
  const [existing] = await db.select().from(userWorkspaceRoles).where(and(eq(userWorkspaceRoles.userId, String(req.params.userId)), eq(userWorkspaceRoles.workspaceRoleId, v.roleId), isNull(userWorkspaceRoles.deletedAt))).limit(1);
  if (v.scopeType === "business_unit") throw new HttpError(422, "Business-unit scope is not supported; choose organization or project");
  const scopes = { businessUnitIds: [], projectIds: v.scopeType === "project" ? await assertProjectScopeInOrg(db, org(req), v.scopeIds) : [] };
  assertCanManageAssignmentScope(req, scopes.projectIds, scopes.businessUnitIds);
  const [row] = existing ? await db.update(userWorkspaceRoles).set({ ...scopes, status: "active", updatedAt: new Date() }).where(eq(userWorkspaceRoles.id, existing.id)).returning() : await db.insert(userWorkspaceRoles).values({ organizationId: org(req), userId: String(req.params.userId), workspaceRoleId: v.roleId, ...scopes }).returning();
  await audit(req, "assign_role", "user_workspace_role", row.id, existing, row); res.json(row);
}));
router.delete("/admin/users/:userId/roles/:id", asyncHandler(async (req, res) => {
  const user: any = await activeRow(req, users, String(req.params.userId));
  const [assignment] = await db.select().from(userWorkspaceRoles).where(and(eq(userWorkspaceRoles.organizationId, org(req)), eq(userWorkspaceRoles.userId, user.id), eq(userWorkspaceRoles.workspaceRoleId, String(req.params.id)), isNull(userWorkspaceRoles.deletedAt))).limit(1);
  if (!assignment) throw new HttpError(404, "Role assignment not found");
  assertCanManageAssignmentScope(req, assignment.projectIds, assignment.businessUnitIds);
  const now = new Date();
  await db.update(userWorkspaceRoles).set({ deletedAt: now, status: "deleted", updatedAt: now }).where(eq(userWorkspaceRoles.id, assignment.id));
  const remaining = await db.select({ id: userWorkspaceRoles.id }).from(userWorkspaceRoles).where(and(eq(userWorkspaceRoles.organizationId, org(req)), eq(userWorkspaceRoles.userId, user.id), isNull(userWorkspaceRoles.deletedAt))).limit(1);
  if (!remaining.length) await db.update(applicationAccess).set({ canOpenQaqc: false, updatedAt: now }).where(and(eq(applicationAccess.organizationId, org(req)), eq(applicationAccess.username, user.username), isNull(applicationAccess.deletedAt)));
  await audit(req, "remove_role", "user_workspace_role", assignment.id, assignment, { userId: user.id, roleId: String(req.params.id) });
  res.status(204).end();
}));
router.get("/admin/access-queue", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const pending = await loadPendingApplicationRequestPage(req, "qaqc", offset, limit);
  const usernames = pending.items.map(row => row.username);
  const userRows = usernames.length ? await db.select().from(users).where(and(eq(users.organizationId, org(req)),
    isNull(users.deletedAt), inArray(users.username, usernames))) : [];
  const byUsername = activeUserIdentityByUsername(userRows, org(req));
  res.json(paginated(pending.items.map(r => ({
    id: r.id, ...accessRequestIdentity(r.username, byUsername), requestedRoleId: r.requestedRoleId,
    status: "pending", requestedAt: r.requestedAt,
  })), pending.total, page, limit));
}));
router.post("/admin/access-queue/:id/decision", asyncHandler(async (req, res) => {
  const v: any = body(api.DecideQaqcAccessRequestBody, req);
  res.json(await decideApplicationAccess(req, "qaqc", v.decision, v.comments));
}));
router.get("/admin/delegations", asyncHandler(async (req, res) => {
  const result = await pageTable(req, delegations);
  const userIds = [...new Set(result.items.flatMap((r: any) => [r.delegatorId, r.delegateId]))];
  const people = userIds.length
    ? await db.select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        email: users.email,
        accessStatus: users.accessStatus,
        deletedAt: users.deletedAt,
      }).from(users).where(and(eq(users.organizationId, org(req)), inArray(users.id, userIds)))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person]));
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
  const now = Date.now();
  res.json({ ...result, items: result.items.map((r: any) => ({ id: r.id, delegatorId: r.delegatorId, ...personFields("delegator", r.delegatorId), delegateId: r.delegateId, ...personFields("delegate", r.delegateId), scope: JSON.stringify(r.scope), approvalTypes: (r.scope as any)?.approvalTypes ?? [], startDate: r.startsAt, endDate: r.endsAt, status: r.status === "deleted" ? "revoked" : r.endsAt.valueOf() < now ? "expired" : r.startsAt.valueOf() <= now ? "active" : "pending", revokedAt: r.deletedAt })) });
}));
router.post("/admin/delegations", asyncHandler(async (req, res) => {
  const v: any = body(api.CreateQaqcDelegationBody, req);
  if (v.endDate <= v.startDate) throw new HttpError(422, "endDate must be after startDate");
  const [row] = await db.insert(delegations).values({ organizationId: org(req), delegatorId: v.delegatorId, delegateId: v.delegateId, startsAt: v.startDate, endsAt: v.endDate, scope: { scope: v.scope, approvalTypes: v.approvalTypes ?? [] } }).returning();
  await audit(req, "create", "delegation", row.id, undefined, row); res.status(201).json(row);
}));
router.delete("/admin/delegations/:id", asyncHandler((req, res) => softDelete(req, res, delegations, "delegation")));
// Open/resolved escalation instances for dashboard surfacing — mirrors the
// lessons module's GET /lessons/escalations shape (EscalationSummary).
router.get("/escalations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const metricScope = await getAuthorizedProjectScope(req, "qaqc", { module: "metrics", action: "select" });
  const briefScope = await getAuthorizedProjectScope(req, "qaqc", { module: "quality_briefs", action: "select" });
  const briefIds = briefScope.unrestricted ? [] : await db.select({ id: qualityAssessmentBriefs.id }).from(qualityAssessmentBriefs).where(and(
    eq(qualityAssessmentBriefs.organizationId, org(req)),
    inArray(qualityAssessmentBriefs.projectId, briefScope.projectIds),
    isNull(qualityAssessmentBriefs.deletedAt),
  ));
  const where = and(
    eq(escalationInstances.organizationId, org(req)),
    isNull(escalationInstances.deletedAt),
    or(
      metricScope.unrestricted
        ? eq(escalationInstances.recordType, "quality_performance")
        : and(eq(escalationInstances.recordType, "quality_performance"), inArray(escalationInstances.recordId, metricScope.projectIds)),
      briefScope.unrestricted
        ? eq(escalationInstances.recordType, "quality_brief")
        : and(eq(escalationInstances.recordType, "quality_brief"), inArray(escalationInstances.recordId, briefIds.map((row) => row.id))),
    ),
  );
  const [rows, count, rules] = await Promise.all([
    db.select().from(escalationInstances).where(where).orderBy(desc(escalationInstances.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(escalationInstances).where(where),
    db.select().from(escalationRules).where(and(eq(escalationRules.organizationId, org(req)), isNull(escalationRules.deletedAt))),
  ]);
  res.json(paginated(rows.map((row) => {
    const rule = rules.find((r) => r.id === row.ruleId);
    return { id: row.id, recordType: row.recordType, recordId: row.recordId, priority: rule?.priority ?? "P1", level: row.currentLevel ?? String((rule?.configuration as any)?.level ?? "P1"), dueAt: row.breachedAt ?? new Date(row.startedAt.getTime() + (rule?.slaWorkingDays ?? 0) * 86400000), status: row.status, lastNotifiedAt: row.breachedAt };
  }), Number(count[0]?.count ?? 0), page, limit));
}));
router.get("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const [result, staffed] = await Promise.all([pageTable(req, escalationRules), staffedRoleNames(org(req), workspaceRoles, userWorkspaceRoles)]);
  res.json({
    ...result, items: result.items.map((r: any) => {
      const recipientRoles = String(r.recipientRole ?? "").split(",").map((v: string) => v.trim()).filter(Boolean);
      const ccRecipientRoles = Array.isArray((r.configuration as any)?.ccRecipientRoles) ? (r.configuration as any).ccRecipientRoles.filter((name: unknown): name is string => typeof name === "string") : [];
      return { id: r.id, triggerType: r.triggerKey, priority: r.priority, level: (r.configuration as any)?.level ?? null, slaWorkingDays: r.slaWorkingDays, recipientRoles, ccRecipientRoles, unstaffedRoles: recipientRoles.filter((n: string) => !staffed.has(n)), unstaffedCcRoles: ccRecipientRoles.filter((n: string) => !staffed.has(n)), repeatCadenceDays: r.repeatCadenceDays ?? 1, enabled: r.status === "active" };
    }),
  });
}));
router.put("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const values: any[] = body(api.UpdateQaqcEscalationRulesBody, req);
  const old = await db.select().from(escalationRules).where(and(eq(escalationRules.organizationId, org(req)), isNull(escalationRules.deletedAt)));
  await db.update(escalationRules).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(escalationRules.organizationId, org(req)), isNull(escalationRules.deletedAt)));
  const inserted = [];
  for (const v of values) {
    const [row] = await db.insert(escalationRules).values({ organizationId: org(req), triggerKey: v.triggerType, priority: v.priority, slaWorkingDays: v.slaWorkingDays, recipientRole: v.recipientRoles.join(","), repeatCadenceDays: v.repeatCadenceDays, configuration: { level: v.level, ccRecipientRoles: v.ccRecipientRoles ?? [] }, status: v.enabled ? "active" : "inactive" }).returning(); inserted.push(row);
  }
  await audit(req, "replace", "escalation_rules", inserted[0]?.id ?? old[0]?.id ?? actor(req), { rules: old }, { rules: inserted }); res.json(inserted);
}));
const defaultAiSettings = { enabled: true, features: { rephrase: true, qualityBrief: true, promptToTransaction: true }, provider: "Anthropic", model: "claude-sonnet-5", timeoutSeconds: 10, stripPersonalData: true, retentionDays: 30, monthlyQuota: 1000 };
router.get("/admin/ai-settings", asyncHandler(async (req, res) => {
  const [settings] = await db.select().from(organizationSettings).where(and(eq(organizationSettings.organizationId, org(req)), isNull(organizationSettings.deletedAt))).limit(1);
  res.json((settings?.branding as any)?.qaqcAiSettings ?? defaultAiSettings);
}));
router.put("/admin/ai-settings", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateQaqcAiSettingsBody, req);
  const [existing] = await db.select().from(organizationSettings).where(and(eq(organizationSettings.organizationId, org(req)), isNull(organizationSettings.deletedAt))).limit(1);
  const before = existing ? (existing.branding as any)?.qaqcAiSettings : undefined;
  const branding = { ...(existing?.branding ?? {}), qaqcAiSettings: v };
  if (existing) await db.update(organizationSettings).set({ branding, updatedAt: new Date() }).where(eq(organizationSettings.id, existing.id));
  else await db.insert(organizationSettings).values({ organizationId: org(req), branding });
  await audit(req, "update", "ai_settings", existing?.id ?? actor(req), before, v); res.json(v);
}));
router.get("/admin/audit-log", asyncHandler(async (req, res) => {
  const filters: any[] = [];
  if (req.query.from) filters.push(gte(auditLogEntries.createdAt, new Date(String(req.query.from))));
  if (req.query.to) filters.push(lte(auditLogEntries.createdAt, new Date(String(req.query.to))));
  if (req.query.actorId) filters.push(eq(auditLogEntries.actorId, String(req.query.actorId)));
  if (req.query.action) filters.push(eq(auditLogEntries.action, String(req.query.action)));
  const result = await pageTable(req, auditLogEntries, filters);
  res.json({ ...result, items: result.items.map((r: any) => ({ ...r, occurredAt: r.createdAt })) });
}));
router.get("/admin/notification-templates", asyncHandler(async (req, res) => {
  const result = await pageTable(req, notificationTemplates);
  res.json({ ...result, items: result.items.map((r: any) => ({ id: r.id, key: r.key, subject: r.subject, body: r.bodyTemplate, channels: [r.channel], mergeFields: [], enabled: r.enabled })) });
}));
router.put("/admin/notification-templates/:id", asyncHandler(async (req, res) => {
  const v: any = body(api.UpdateQaqcNotificationTemplateBody, req); const before: any = await activeRow(req, notificationTemplates, String(req.params.id));
  if (!v.channels.includes("in_app") && !v.channels.includes("email")) throw new HttpError(422, "At least one supported channel (in_app or email) is required");
  const [row] = await db.update(notificationTemplates).set({ key: v.key, subject: v.subject, bodyTemplate: v.body, channel: v.channels.includes("email") ? "email" : "in_app", enabled: v.enabled, updatedAt: new Date() }).where(eq(notificationTemplates.id, before.id)).returning();
  await audit(req, "update", "notification_template", row.id, before, row); res.json({ id: row.id, key: row.key, subject: row.subject, body: row.bodyTemplate, channels: [row.channel], mergeFields: v.mergeFields ?? [], enabled: row.enabled });
}));

export default router;