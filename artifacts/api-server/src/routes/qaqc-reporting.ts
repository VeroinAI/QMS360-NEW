import { Router, type IRouter, type Request } from "express";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  auditPlans, businessUnits, db, organizations, projects, qaqcMetricEntries, materialInspectionEntries, qtbtEntries,
  qaqcReportDeliveryRuns, qaqcReportSubmissions, targetBenchmarks, users,
} from "@workspace/db";
import { AiUnavailableError, draftQualityBrief } from "../lib/ai";
import { assertFieldAccess, isAdminUser } from "../lib/field-access";
import { assertFieldControls } from "../lib/field-controls";
import { asyncHandler, HttpError, notifyWithEmail, pagination, writeAuditLog } from "../lib/workspace";
import { requireAuth } from "../middlewares/auth";
import { getAppAdminScope, getAuthorizedFullProjectScope, getAuthorizedProjectScope, requireAppAccess, requireAppAdmin, requirePermission } from "../middlewares/rbac";
import { assertProjectInOrg, assertUserInOrg } from "../lib/tenancy";
import { assertLovValue, getLovValues } from "../lib/lov";
import { logger } from "../lib/logger";
import { reportDepartmentReferences } from "../lib/qaqc-reporting-department-policy";
import {
  calculateReport, subtractReportSnapshot, validateReportData, type CsatReportComputed, type DailyReportComputed,
  type MonthlyReportComputed, type ReportType,
} from "../lib/qaqc-reporting-model";

const router: IRouter = Router();
router.use(requireAuth);
router.use(requireAppAccess("qaqc"));

const org = (req: Request) => req.currentUser!.organizationId;
const actor = (req: Request) => req.currentUser!.id;
async function orgLocalToday(req: Request) {
  const [organization] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, org(req))).limit(1);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: organization?.timezone ?? "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
const allowedTypes = new Set<ReportType>(["monthly", "daily", "csat"]);
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const REPORT_MODULE: Record<ReportType, string> = {
  monthly: "metrics", daily: "document_governance", csat: "customer_satisfaction",
};
export type QaqcReportingDashboard = {
  filters: { projectId: string | null; projectGroup: string | null; from: string | null; to: string | null; category: string };
  monthly: Array<{ id: string; projectId: string; projectName: string | null; period: string; state: string; computed: MonthlyReportComputed; data: Record<string, any> }>;
  aggregates: Array<{ period: string; projects: number; averagePqi: number; metrics: Record<string, number> }>;
  csat: Array<{ id: string; projectId: string; projectName: string | null; period: string; computed: CsatReportComputed; data: Record<string, any> }>;
  csatAverage: number;
  daily: Array<{
    id: string; projectId: string; projectName: string | null; period: string; snapshot: DailyReportComputed;
    movement: Record<string, any> | null; absoluteSnapshot: boolean; globalPeriod: string; baselinePeriod: string | null;
  }>;
};
const typeFor = (req: Request): ReportType => {
  const provided = req.body?.reportType ?? req.query.reportType ?? (req as any).qaqcReportType ?? "monthly";
  return parseType(provided);
};
function reportPermission(typeResolver: (req: Request) => Promise<ReportType> | ReportType, action: "select" | "own") {
  return (req: Request, res: any, next: (error?: unknown) => void) => {
    Promise.resolve(typeResolver(req)).then((type) =>
      requirePermission("qaqc", REPORT_MODULE[type], action)(req, res, next),
    ).catch(next);
  };
}
async function reportAccess(req: Request, type: ReportType) {
  const target = { module: REPORT_MODULE[type], action: "select" as const };
  const scope = await getAuthorizedProjectScope(req, "qaqc", target);
  const fullScope = await getAuthorizedFullProjectScope(req, "qaqc", target);
  return {
    allowed: req.permissionAdminBypass || scope.unrestricted || scope.projectIds.length > 0,
    scope,
    fullScope,
  };
}
function multipleReportAccess() {
  return async (req: Request, _res: any, next: (error?: unknown) => void) => {
    try {
      const types = req.query.reportType ? [parseType(req.query.reportType)] : [...allowedTypes];
      const access = new Map<ReportType, Awaited<ReturnType<typeof reportAccess>>>();
      for (const type of types) {
        const current = await reportAccess(req, type);
        if (current.allowed) access.set(type, current);
      }
      if (!access.size) throw new HttpError(403, "This action is not permitted for your role");
      (req as any).qaqcReportAccess = access;
      next();
    } catch (error) { next(error); }
  };
}
function canReadByCapability(req: Request, row: any) {
  const access = ((req as any).qaqcReportAccess as Map<ReportType, Awaited<ReturnType<typeof reportAccess>>> | undefined)?.get(row.reportType as ReportType);
  if (!access?.allowed) return false;
  const inScope = access.scope.unrestricted || access.scope.projectIds.includes(row.projectId);
  if (!inScope) return false;
  const fullInScope = access.fullScope.unrestricted || access.fullScope.projectIds.includes(row.projectId);
  return fullInScope || row.createdById === actor(req) || row.approverId === actor(req);
}
function reportPermissionById(action: "select" | "own") {
  return (req: Request, res: any, next: (error?: unknown) => void) => {
    db.select({ reportType: qaqcReportSubmissions.reportType }).from(qaqcReportSubmissions).where(and(
      eq(qaqcReportSubmissions.id, String(req.params.id)), eq(qaqcReportSubmissions.organizationId, org(req)),
      isNull(qaqcReportSubmissions.deletedAt),
    )).limit(1).then(([row]) => {
      if (!row) return next(new HttpError(404, "Report not found"));
      (req as any).qaqcReportType = row.reportType;
      return reportPermission(() => parseType(row.reportType), action)(req, res, next);
    }).catch(next);
  };
}
const active = (table: any, organizationId: string, clauses: any[] = []) =>
  and(eq(table.organizationId, organizationId), isNull(table.deletedAt), ...clauses);

function parseType(value: unknown): ReportType {
  if (typeof value !== "string" || !allowedTypes.has(value as ReportType)) throw new HttpError(422, "reportType must be monthly, daily, or csat");
  return value as ReportType;
}

function normalizePeriod(type: ReportType, value: unknown, today = new Date().toISOString().slice(0, 10)): string {
  if (typeof value !== "string") throw new HttpError(422, "period is required");
  const period = type === "monthly"
    ? (/^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value)
    : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || Number.isNaN(Date.parse(`${period}T00:00:00Z`)) || new Date(`${period}T00:00:00Z`).toISOString().slice(0, 10) !== period)
    throw new HttpError(422, "period must be a valid calendar date");
  if (type === "monthly" && !period.endsWith("-01")) throw new HttpError(422, "Monthly periods must be the first day of the month");
  if (type === "daily" && period > today) throw new HttpError(422, "Daily report period cannot be in the future");
  if (type === "monthly" && period > `${today.slice(0, 7)}-01`) throw new HttpError(422, "Reporting period cannot be in the future");
  if (type === "csat" && period > today) throw new HttpError(422, "CSAT survey date cannot be in the future");
  return period;
}

function zeroFill(type: ReportType, value: Record<string, any>) {
  const data = structuredClone(value);
  const clearNumbers = (node: any): any => {
    if (typeof node === "number") return 0;
    if (Array.isArray(node)) return node.map(clearNumbers);
    if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, clearNumbers(item)]));
    return node;
  };
  const mergeDefaults = (defaults: any, incoming: any): any => {
    if (isObject(defaults) && isObject(incoming)) {
      return Object.fromEntries([...new Set([...Object.keys(defaults), ...Object.keys(incoming)])].map((key) => [
        key, key in incoming ? mergeDefaults(defaults[key], incoming[key]) : defaults[key],
      ]));
    }
    return incoming === undefined ? defaults : incoming;
  };
  if (!data.noUpdates) return data;
  if (type === "daily") {
    const zero = { noUpdates: true } as Record<string, any>;
    zero.disciplines = {};
    for (const section of ["drawings", "submittals"]) {
      zero.disciplines[section] = {};
      for (const discipline of ["Civil", "Mechanical", "Structural", "Electrical", "Instrumentation"])
        zero.disciplines[section][discipline] = { approved: 0, resubmit: 0, rejected: 0, underReview: 0 };
    }
    zero.revisions = { drawings: [], submittals: [] };
    zero.documentTypes = Object.fromEntries(["Drawings", "Material Submittals", "Method Statements", "ITPs", "CVs", "PQP", "IFR", "Vendors"].map((key) => [key, 0]));
    zero.pending = {};
    for (const entity of ["Client", "Algihaz", "Supplier"]) {
      zero.pending[entity] = {};
      for (const status of ["underReview", "A", "B", "C", "D", "E"])
        zero.pending[entity][status] = { upTo7: 0, days8To30: 0, over30: 0 };
    }
    zero.correspondence = { incoming: 0, outgoing: 0 };
    return clearNumbers(mergeDefaults(zero, data));
  }
  if (type === "monthly") {
    if (Array.isArray(data.manpower)) data.manpower = data.manpower.map((row: any) => ({ ...row, count: 0, approved: 0, rejected: 0 }));
    for (const value of Object.values(data.metrics ?? {})) if (isObject(value)) {
      value.issued = 0; value.closed = 0;
      if (Array.isArray(value.ageing)) value.ageing = value.ageing.map((row: any) => ({ ...row, count: 0 }));
    }
    for (const key of ["issued", "closed", "osdMirns", "overage", "shortage", "damage", "defective", "totalItems", "approved", "onHold", "rejectedDoNotUse", "rejectedReturn", "hazardous", "handleWithCare"]) {
      if (data.material) data.material[key] = 0;
    }
    if (data.qtbt) for (const key of ["talkCount", "attendance", "durationMinutes"]) data.qtbt[key] = 0;
    for (const section of ["drawings", "submittals"]) if (data.documents?.[section]) {
      for (const key of ["approved", "resubmitted", "rejected", "underReview", "clientReviewDays", "internalReviewDays"]) data.documents[section][key] = 0;
    }
  }
  return data;
}

const shiftPeriod = (period: string, type: ReportType, delta: number) => {
  const date = new Date(`${period}T00:00:00Z`);
  if (type === "monthly" || type === "csat") date.setUTCMonth(date.getUTCMonth() + delta);
  else date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

async function projectAllowed(req: Request, projectId: string) {
  await assertProjectInOrg(db, org(req), projectId);
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, org(req)), eq(projects.status, "active"), isNull(projects.deletedAt),
  )).limit(1);
  if (!project) throw new HttpError(422, "Project must be active");
  let projectHasCapability = !!req.permissionAdminBypass;
  const typeAccess = (req as any).qaqcReportAccess as Map<ReportType, Awaited<ReturnType<typeof reportAccess>>> | undefined;
  if (typeAccess?.size) {
    projectHasCapability ||= [...typeAccess.values()].some((access) =>
      access.scope.unrestricted || access.scope.projectIds.includes(projectId));
  } else if ((req as any).qaqcReportType) {
    const access = await reportAccess(req, parseType((req as any).qaqcReportType));
    projectHasCapability ||= access.scope.unrestricted || access.scope.projectIds.includes(projectId);
  } else if (req.permissionProjectScope) {
    projectHasCapability ||= req.permissionProjectScope.unrestricted || req.permissionProjectScope.projectIds.includes(projectId);
  }
  if (!projectHasCapability) throw new HttpError(403, "You do not have reporting capability for this project");
}

async function reportRow(req: Request, id: string) {
  const scope = await getAuthorizedProjectScope(req, "qaqc");
  const rows = await db.select().from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.id, id), active(qaqcReportSubmissions, org(req)),
    !scope.unrestricted ? inArray(qaqcReportSubmissions.projectId, scope.projectIds) : undefined,
    req.permissionScope === "own" ? or(
      eq(qaqcReportSubmissions.createdById, actor(req)), eq(qaqcReportSubmissions.approverId, actor(req)),
    ) : undefined,
  )).limit(1);
  if (!rows[0]) throw new HttpError(404, "Report not found");
  return rows[0];
}

async function latestPrior(projectId: string, type: ReportType, period: string) {
  const rows = await db.select().from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.projectId, projectId), eq(qaqcReportSubmissions.reportType, type),
    lte(qaqcReportSubmissions.period, shiftPeriod(period, type, -1)),
    inArray(qaqcReportSubmissions.state, ["submitted", "approved"]), isNull(qaqcReportSubmissions.deletedAt),
  )).orderBy(desc(qaqcReportSubmissions.period)).limit(1);
  return rows[0] ?? null;
}

async function historyBaseline(projectId: string, type: ReportType, period: string) {
  if (type === "csat") return { baseline: {}, previous: null };
  const previous = await latestPrior(projectId, type, period);
  if (!previous) return { baseline: {}, previous: null };
  if (type === "daily") return { baseline: previous.data as Record<string, any>, previous };
  if (type === "monthly") {
    const computed = previous.computed as Record<string, any>;
    const metrics: Record<string, any> = {};
    for (const key of ["external_ncr", "internal_ncr", "rfi", "rmi"]) {
      const metric = computed.metrics?.[key] ?? {};
      metrics[key] = { accumulatedIssued: Number(metric.accumulatedIssued ?? 0), accumulatedClosed: Number(metric.accumulatedClosed ?? 0) };
    }
    return { baseline: {
      metrics,
      material: { accumulatedIssued: Number(computed.material?.accumulatedIssued ?? 0), accumulatedClosed: Number(computed.material?.accumulatedClosed ?? 0) },
      qtbt: { accumulatedTalkCount: Number(computed.qtbt?.accumulatedTalkCount ?? 0), accumulatedManhours: Number(computed.qtbt?.accumulatedManhours ?? 0) },
    }, previous };
  }
  return { baseline: {}, previous };
}

async function legacyBaseline(projectId: string, type: ReportType, period: string) {
  if (type !== "monthly") return {};
  const through = shiftPeriod(period, type, -1);
  const [metrics, materials, talks] = await Promise.all([
    db.select().from(qaqcMetricEntries).where(and(
      eq(qaqcMetricEntries.projectId, projectId), lte(qaqcMetricEntries.reportingPeriod, through),
      inArray(qaqcMetricEntries.status, ["submitted", "approved"]), isNull(qaqcMetricEntries.deletedAt),
    )).orderBy(desc(qaqcMetricEntries.reportingPeriod)),
    db.select().from(materialInspectionEntries).where(and(eq(materialInspectionEntries.projectId, projectId), lte(materialInspectionEntries.reportingPeriod, through), isNull(materialInspectionEntries.deletedAt))).orderBy(desc(materialInspectionEntries.reportingPeriod)),
    db.select().from(qtbtEntries).where(and(eq(qtbtEntries.projectId, projectId), lte(qtbtEntries.reportingPeriod, through), isNull(qtbtEntries.deletedAt))).orderBy(asc(qtbtEntries.reportingPeriod)),
  ]);
  const baseline: Record<string, any> = {};
  const aliases: Record<string, string> = {
    "external ncr": "external_ncr", "external_ncr": "external_ncr",
    "internal ncr": "internal_ncr", "internal_ncr": "internal_ncr",
    "rfi": "rfi", "rmi": "rmi",
  };
  for (const key of ["external_ncr", "internal_ncr", "rfi", "rmi"]) {
    const rows = metrics.filter((item) => aliases[String(item.category).toLowerCase()] === key);
    if (rows.length) {
      baseline.metrics ??= {};
      baseline.metrics[key] = {
        accumulatedIssued: rows.reduce((sum, row) => sum + Number(row.issuedCount ?? 0), 0),
        accumulatedClosed: rows.reduce((sum, row) => sum + Number(row.closedCount ?? 0), 0),
      };
    }
  }
  const material = materials[0];
  if (material) baseline.material = { accumulatedIssued: material.mirnTotal, accumulatedClosed: material.approvedCount };
  if (talks.length) baseline.qtbt = {
    accumulatedTalkCount: talks.reduce((sum, row) => sum + row.talkCount, 0),
    accumulatedManhours: talks.reduce((sum, row) => sum + row.attendanceCount * row.durationMinutes / 60, 0),
  };
  return baseline;
}

async function sequenceBlock(projectId: string, type: ReportType, period: string, currentId?: string) {
  if (type === "csat") return null;
  const [project] = await db.select({ customFields: projects.customFields }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const projectSettings = isObject(project?.customFields.qaqcReporting) ? project.customFields.qaqcReporting : {};
  let configuredStart = typeof projectSettings.reportingStartDate === "string" ? projectSettings.reportingStartDate : null;
  if (configuredStart && (type === "monthly")) configuredStart = /^\d{4}-\d{2}$/.test(configuredStart)
    ? `${configuredStart}-01` : `${configuredStart.slice(0, 7)}-01`;
  const reports = await db.select({
    id: qaqcReportSubmissions.id, period: qaqcReportSubmissions.period,
    state: qaqcReportSubmissions.state, submittedAt: qaqcReportSubmissions.submittedAt,
  }).from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.projectId, projectId), eq(qaqcReportSubmissions.reportType, type),
    isNull(qaqcReportSubmissions.deletedAt),
  )).orderBy(asc(qaqcReportSubmissions.period));
  const otherReports = reports.filter((row) => row.id !== currentId);
  const priorPeriod = shiftPeriod(period, type, -1);
  const prior = otherReports.find((row) => row.period === priorPeriod);
  if (prior && !["submitted", "approved"].includes(prior.state)) return `The immediately prior report for ${priorPeriod} must be submitted`;
  if (!prior && otherReports.some((row) => row.period < period))
    return `The immediately prior submitted report for ${priorPeriod} is required`;
  const downstream = otherReports.find((row) => row.period > period && ["submitted", "approved"].includes(row.state));
  if (downstream) return `Cannot change ${period}; downstream report ${downstream.period} has already been submitted`;
  if (configuredStart && period < configuredStart) return `The first reporting period is ${configuredStart}`;
  const earliest = otherReports[0];
  if (!prior && configuredStart && period > configuredStart)
    return `The required prior report ${priorPeriod} has not been submitted`;
  if (!prior && earliest && period > earliest.period)
    return `The required prior report ${priorPeriod} has not been submitted`;
  return null;
}

async function assertSequence(projectId: string, type: ReportType, period: string, current?: any) {
  if (type === "csat") return;
  if (current?.state === "sent_back" && current.submittedAt) {
    const [downstream] = await db.select({ id: qaqcReportSubmissions.id }).from(qaqcReportSubmissions).where(and(
      eq(qaqcReportSubmissions.projectId, projectId), eq(qaqcReportSubmissions.reportType, type),
      gte(qaqcReportSubmissions.period, shiftPeriod(period, type, 1)),
      inArray(qaqcReportSubmissions.state, ["submitted", "approved"]), isNull(qaqcReportSubmissions.deletedAt),
    )).limit(1);
    if (downstream) return;
  }
  const reason = await sequenceBlock(projectId, type, period, current?.id);
  if (reason) throw new HttpError(409, reason);
}

async function hasDownstreamSubmission(projectId: string, type: ReportType, period: string) {
  if (type === "csat") return false;
  const [downstream] = await db.select({ id: qaqcReportSubmissions.id }).from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.projectId, projectId), eq(qaqcReportSubmissions.reportType, type),
    gte(qaqcReportSubmissions.period, shiftPeriod(period, type, 1)),
    inArray(qaqcReportSubmissions.state, ["submitted", "approved"]), isNull(qaqcReportSubmissions.deletedAt),
  )).limit(1);
  return !!downstream;
}

function reportDto(row: any, projectName?: string) {
  return {
    id: row.id, organizationId: row.organizationId, projectId: row.projectId, projectName,
    reportType: row.reportType, period: row.period, state: row.state, data: row.data,
    computed: row.computed, baseline: row.baseline, approverId: row.approverId,
    submittedById: row.submittedById, submittedAt: row.submittedAt, approvedAt: row.approvedAt,
    reviewComments: row.reviewComments, referenceNumber: row.referenceNumber,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function withProject(row: any) {
  const [project] = await db.select({ name: projects.name }).from(projects).where(and(
    eq(projects.id, row.projectId), eq(projects.organizationId, row.organizationId),
  )).limit(1);
  return reportDto(row, project?.name);
}

async function audit(req: Request, action: string, id: string, before?: any, after?: any, database: any = db) {
  await writeAuditLog(database, "qaqc", {
    organizationId: org(req), actorId: actor(req), action, entityType: "qaqc_report",
    entityId: id, before, after, ipAddress: req.ip,
  });
}

async function activeProjects(req: Request, type?: ReportType) {
  const scope = type
    ? await getAuthorizedProjectScope(req, "qaqc", { module: REPORT_MODULE[type], action: "select" })
    : await getAuthorizedProjectScope(req, "qaqc");
  const clauses = [eq(projects.organizationId, org(req)), eq(projects.status, "active"), isNull(projects.deletedAt)];
  if (!scope.unrestricted) clauses.push(inArray(projects.id, scope.projectIds) as any);
  return db.select({
    id: projects.id, name: projects.name, code: projects.code, location: projects.location,
    businessUnitId: projects.businessUnitId, customFields: projects.customFields,
    businessUnitName: businessUnits.name,
  }).from(projects).leftJoin(businessUnits, and(
    eq(projects.businessUnitId, businessUnits.id), eq(businessUnits.organizationId, org(req)), isNull(businessUnits.deletedAt),
  )).where(and(...clauses));
}

async function activeUsers(req: Request) {
  return db.select({ id: users.id, fullName: users.fullName, designation: users.designation })
    .from(users).where(and(eq(users.organizationId, org(req)), eq(users.accessStatus, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.fullName));
}

async function targetsFor(req: Request, projectCustomFields: Record<string, any>, settings: Record<string, any>) {
  const rows = await db.select({ metricKey: targetBenchmarks.metricKey, targetValue: targetBenchmarks.targetValue })
    .from(targetBenchmarks).where(and(
      eq(targetBenchmarks.organizationId, org(req)), isNull(targetBenchmarks.deletedAt),
    ));
  const defaults = Object.fromEntries(rows.map((row) => [row.metricKey, Number(row.targetValue)]));
  const projectOverrides = isObject(projectCustomFields.targets) ? projectCustomFields.targets
    : isObject(settings.targets) ? settings.targets : {};
  return { ...defaults, ...projectOverrides };
}

async function assertReportLovValues(req: Request, type: ReportType, data: Record<string, any>) {
  for (const department of reportDepartmentReferences(type, data))
    await assertLovValue(db, org(req), "departments", department);
}

function userId(customFields: Record<string, unknown>, key: string): string | undefined {
  const value = customFields[key];
  return typeof value === "string" ? value : undefined;
}

router.get("/context", reportPermission((req) => typeFor(req), "select"), asyncHandler(async (req, res) => {
  const type = typeFor(req);
  const today = await orgLocalToday(req);
  const selectedPeriod = req.query.period ?? (type === "daily" ? today : `${today.slice(0, 7)}-01`);
  let period = normalizePeriod(type, selectedPeriod, today);
  const projectsInScope = await activeProjects(req, type);
  const allUsers = await activeUsers(req);
  const adminScope = await getAppAdminScope(req, "qaqc");
  const isQaqcAdmin = isAdminUser(req.currentUser!) || adminScope !== null;
  const userKeys = ["pmId", "peId", "dcId", "qualityRepresentativeId", "projectHeadId", "buHeadId", "corporateQualityManagerId", "dataGovernanceManagerId", "directorId"];
  const assignedIds = new Set<string>();
  const approverIds = new Set<string>();
  for (const item of projectsInScope) {
    const settings = isObject(item.customFields.qaqcReporting) ? item.customFields.qaqcReporting : {};
    for (const key of userKeys) {
      const id = userId(settings, key);
      if (id) assignedIds.add(id);
      if (["qualityRepresentativeId", "projectHeadId", "buHeadId", "corporateQualityManagerId", "dataGovernanceManagerId", "directorId"].includes(key) && id)
        approverIds.add(id);
    }
    if (Array.isArray(settings.distributionMemberIds)) for (const id of settings.distributionMemberIds) if (typeof id === "string") assignedIds.add(id);
  }
  const relevantUsers = isQaqcAdmin ? allUsers : allUsers.filter((user) => assignedIds.has(user.id) || user.id === actor(req));
  const departments = await getLovValues(db, org(req), "departments");
  const resultBase = {
    reportType: type,
    projects: projectsInScope.map((item) => ({
      id: item.id, name: item.name, code: item.code,
      costCentre: item.customFields.costCentre ?? item.customFields.cost_centre ?? null,
      group: item.businessUnitName ?? null,
    })),
    users: relevantUsers,
    approvers: relevantUsers.filter((user) => approverIds.has(user.id) && user.id !== actor(req)),
    masterData: {
      departments,
      pqpStatuses: ["Approved A", "Approved B", "Approved C", "Under Preparation", "Under Review with Client", "Rejected", "Others"],
      meetings: ["Project Management Review Meeting", "Internal Meeting", "External Meeting", "Project Quality Meeting"],
      disciplines: ["Civil", "Mechanical", "Structural", "Electrical", "Instrumentation"],
      qmsDepartments: ["HSSE", "Quality", "Finance", "Fleet & Facilities Management", "Human Resources", "Group Digital & Technology", "Operations"],
      qmsTypes: ["Manual", "Policy", "SOP", "Form"],
      qmsStatuses: ["Under Review and Signature", "Approved & Published"],
      csatRatings: ["quality", "timeline", "communication", "professionalism", "valueForMoney", "issueHandling"],
    },
  };
  const projectId = String(req.query.projectId ?? "");
  if (!projectId) {
    const initialProject = projectsInScope[0];
    const initialSettings = initialProject && isObject(initialProject.customFields.qaqcReporting) ? initialProject.customFields.qaqcReporting : {};
    res.json({
      ...resultBase, projectDetails: null, baseline: {}, canStart: false,
      blockedReason: null, targets: await targetsFor(req, {}, {}), settings: {},
      initialPeriod: type !== "csat" && typeof initialSettings.reportingStartDate === "string" ? initialSettings.reportingStartDate : period,
    });
    return;
  }
  await projectAllowed(req, projectId);
  const periodEndDate = new Date(`${period}T00:00:00Z`);
  if (type === "monthly") {
    periodEndDate.setUTCMonth(periodEndDate.getUTCMonth() + 1);
    periodEndDate.setUTCDate(0);
  }
  const periodEnd = periodEndDate.toISOString().slice(0, 10);
  const [projectRows] = await Promise.all([db.select().from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, org(req)), isNull(projects.deletedAt),
  )).limit(1)]);
  const project = projectRows[0];
  if (!project || project.status !== "active") throw new HttpError(404, "Active project not found");
  const settings = isObject(project.customFields.qaqcReporting) ? project.customFields.qaqcReporting : {};
  const effectiveSettings = { ...settings, dailyDistributionDays: settings.dailyDistributionDays ?? [1, 15] };
  if (req.query.period === undefined) {
    if (type !== "csat") {
      const [latestReport] = await db.select({
        period: qaqcReportSubmissions.period, state: qaqcReportSubmissions.state,
      }).from(qaqcReportSubmissions).where(and(
        eq(qaqcReportSubmissions.projectId, projectId), eq(qaqcReportSubmissions.reportType, type),
        isNull(qaqcReportSubmissions.deletedAt),
      )).orderBy(desc(qaqcReportSubmissions.period)).limit(1);
      const configuredStart = typeof settings.reportingStartDate === "string" ? settings.reportingStartDate : null;
      const defaultPeriod = latestReport
        ? (["draft", "sent_back"].includes(latestReport.state) ? latestReport.period : shiftPeriod(latestReport.period, type, 1))
        : configuredStart ?? selectedPeriod;
      period = normalizePeriod(type, defaultPeriod, today);
    }
  }
  const history = await historyBaseline(projectId, type, period);
  const legacy = Object.keys(history.baseline).length ? {} : await legacyBaseline(projectId, type, period);
  const auditPrefill = type === "monthly" ? await db.select({ auditDate: auditPlans.auditDate, workflowState: auditPlans.workflowState })
    .from(auditPlans).where(and(
      eq(auditPlans.organizationId, org(req)), eq(auditPlans.projectId, projectId),
      isNull(auditPlans.deletedAt), lte(auditPlans.auditDate, periodEnd),
    )).orderBy(desc(auditPlans.auditDate)).limit(20) : [];
  const last = history.previous;
  const baseline = Object.keys(history.baseline).length ? history.baseline : legacy;
  const targets = await targetsFor(req, project.customFields, settings);
  const blockedReason = await sequenceBlock(projectId, type, period);
  const projectUserIds = new Set<string>();
  const selectedApproverIds = new Set<string>();
  const settingsUserKeys = [...userKeys, "distributionMemberIds"];
  for (const key of settingsUserKeys) {
    if (key === "distributionMemberIds" && Array.isArray(settings[key])) {
      for (const id of settings[key] as unknown[]) if (typeof id === "string") projectUserIds.add(id);
    } else {
      const id = userId(settings, key);
      if (id) projectUserIds.add(id);
      if (id && ["qualityRepresentativeId", "projectHeadId", "buHeadId", "corporateQualityManagerId", "dataGovernanceManagerId", "directorId"].includes(key))
        selectedApproverIds.add(id);
    }
  }
  const result = {
    ...resultBase,
    users: isQaqcAdmin ? allUsers : allUsers.filter((user) => projectUserIds.has(user.id) || user.id === actor(req)),
    approvers: allUsers.filter((user) => selectedApproverIds.has(user.id) && user.id !== actor(req)),
    masterData: { ...resultBase.masterData, auditPrefill: auditPrefill.filter((item) => !!item.auditDate) },
    projectDetails: {
      costCentre: project.customFields.costCentre ?? project.customFields.cost_centre ?? null,
      pmName: allUsers.find((u) => u.id === userId(settings, "pmId"))?.fullName ?? null,
      peName: allUsers.find((u) => u.id === userId(settings, "peId"))?.fullName ?? null,
      dcName: allUsers.find((u) => u.id === userId(settings, "dcId"))?.fullName ?? null,
    },
    baseline: { ...baseline, previousPeriod: last?.period ?? null, hasBaseline: !!last || Object.keys(legacy).length > 0, legacyFallback: Object.keys(legacy).length > 0 },
    canStart: !blockedReason,
    blockedReason,
    targets,
    settings: { ...effectiveSettings, targets },
    initialPeriod: last ? shiftPeriod(last.period, type, 1) : period,
  };
  res.json(result);
}));

router.get("/reports", multipleReportAccess(), asyncHandler(async (req, res) => {
  const filters: any[] = [];
  const access = (req as any).qaqcReportAccess as Map<ReportType, Awaited<ReturnType<typeof reportAccess>>>;
  const reportTypes = [...access.keys()];
  filters.push(inArray(qaqcReportSubmissions.reportType, reportTypes));
  if (req.query.projectId) {
    const projectId = String(req.query.projectId);
    await projectAllowed(req, projectId);
    filters.push(eq(qaqcReportSubmissions.projectId, projectId));
  }
  if (req.query.period) filters.push(eq(qaqcReportSubmissions.period, String(req.query.period)));
  if (req.query.state) filters.push(eq(qaqcReportSubmissions.state, String(req.query.state)));
  const { page, limit, offset } = pagination(req);
  const where = active(qaqcReportSubmissions, org(req), filters);
  const rows = await db.select().from(qaqcReportSubmissions).where(where).orderBy(desc(qaqcReportSubmissions.period), desc(qaqcReportSubmissions.createdAt));
  const visible = rows.filter((row) => canReadByCapability(req, row));
  const items = await Promise.all(visible.slice(offset, offset + limit).map(withProject));
  res.json({ items, total: visible.length, page, limit });
}));

router.post("/reports", reportPermission((req) => typeFor(req), "own"), asyncHandler(async (req, res) => {
  const type = parseType(req.body?.reportType);
  const today = await orgLocalToday(req);
  const period = normalizePeriod(type, req.body?.period, today);
  const projectId = String(req.body?.projectId ?? "");
  if (!projectId || !isObject(req.body?.data)) throw new HttpError(422, "projectId and object data are required");
  const data = zeroFill(type, req.body.data);
  await projectAllowed(req, projectId);
  const fieldBody = { projectId, reportType: type, period, data };
  await assertFieldAccess(req, "qaqc", "report-envelope", { mode: "create", body: fieldBody });
  await assertFieldControls(req, "qaqc", "report-envelope", { mode: "create", body: fieldBody });
  await assertSequence(projectId, type, period);
  const { baseline: historicalBaseline } = await historyBaseline(projectId, type, period);
  const baseline = Object.keys(historicalBaseline).length ? historicalBaseline : await legacyBaseline(projectId, type, period);
  await assertReportLovValues(req, type, data);
  const validation = validateReportData(type, data, baseline, false);
  if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
  const [project] = await db.select({ customFields: projects.customFields }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const settings = isObject(project?.customFields.qaqcReporting) ? project.customFields.qaqcReporting : {};
  try {
    const [row] = await db.insert(qaqcReportSubmissions).values({
      organizationId: org(req), projectId, reportType: type, period, data, createdById: actor(req),
      baseline, computed: calculateReport(type, data, baseline, await targetsFor(req, project.customFields as any, settings)),
    }).returning();
    await audit(req, "create", row.id, undefined, row);
    res.status(201).json(await withProject(row));
  } catch (error) {
    if (error instanceof Error && error.message.includes("qaqc_report_project_type_period_active_idx")) throw new HttpError(409, "A report already exists for this project, type, and period");
    throw error;
  }
}));

router.get("/reports/:id", reportPermissionById("select"), asyncHandler(async (req, res) => res.json(await withProject(await reportRow(req, String(req.params.id))))));

router.patch("/reports/:id", reportPermissionById("own"), asyncHandler(async (req, res) => {
  const before = await reportRow(req, String(req.params.id));
  if (before.createdById !== actor(req)) throw new HttpError(403, "Only the report creator may edit this report");
  if (!["draft", "sent_back"].includes(before.state)) throw new HttpError(409, "Only draft or sent-back reports can be edited");
  if (await hasDownstreamSubmission(before.projectId, before.reportType as ReportType, before.period))
    throw new HttpError(409, `Cannot edit ${before.period}; a later report has already been submitted`);
  if (!isObject(req.body?.data)) throw new HttpError(422, "data must be an object");
  const fieldBody = { projectId: before.projectId, reportType: before.reportType, period: before.period, data: req.body.data };
  await assertFieldAccess(req, "qaqc", "report-envelope", { mode: "update", current: before as any, body: fieldBody });
  await assertFieldControls(req, "qaqc", "report-envelope", { mode: "update", current: before as any, body: fieldBody });
  const data = zeroFill(before.reportType as ReportType, req.body.data);
  await assertReportLovValues(req, before.reportType as ReportType, data);
  const validation = validateReportData(before.reportType as ReportType, data, before.baseline as any, false);
  if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
  const [project] = await db.select({ customFields: projects.customFields }).from(projects).where(eq(projects.id, before.projectId)).limit(1);
  const settings = isObject(project?.customFields.qaqcReporting) ? project.customFields.qaqcReporting : {};
  const targets = await targetsFor(req, project?.customFields as any ?? {}, settings);
  const [row] = await db.update(qaqcReportSubmissions).set({
    data, computed: calculateReport(before.reportType as ReportType, data, before.baseline as any, targets),
    updatedAt: new Date(),
  }).where(and(eq(qaqcReportSubmissions.id, before.id), inArray(qaqcReportSubmissions.state, ["draft", "sent_back"]))).returning();
  if (!row) throw new HttpError(409, "Report state changed; reload before editing");
  await audit(req, "update", row.id, before, row);
  res.json(await withProject(row));
}));

router.delete("/reports/:id", reportPermissionById("own"), asyncHandler(async (req, res) => {
  const before = await reportRow(req, String(req.params.id));
  if (before.createdById !== actor(req)) throw new HttpError(403, "Only the report creator may delete this report");
  if (!["draft", "sent_back"].includes(before.state)) throw new HttpError(409, "Only draft or sent-back reports can be deleted");
  if (await hasDownstreamSubmission(before.projectId, before.reportType as ReportType, before.period))
    throw new HttpError(409, `Cannot delete ${before.period}; a later report has already been submitted`);
  const [row] = await db.update(qaqcReportSubmissions).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(qaqcReportSubmissions.id, before.id), inArray(qaqcReportSubmissions.state, ["draft", "sent_back"]))).returning();
  if (!row) throw new HttpError(409, "Report state changed; reload before deleting");
  await audit(req, "delete", row.id, before, row);
  res.status(204).send();
}));

router.post("/reports/:id/submit", reportPermissionById("own"), asyncHandler(async (req, res) => {
  const before = await reportRow(req, String(req.params.id));
  if (before.createdById !== actor(req)) throw new HttpError(403, "Only the report creator may submit this report");
  if (!["draft", "sent_back"].includes(before.state)) throw new HttpError(409, "Report is not eligible for submission");
  const approverId = String(req.body?.approverId ?? before.approverId ?? "");
  if (!approverId) throw new HttpError(422, "approverId is required");
  if (approverId === actor(req)) throw new HttpError(422, "The approver must be different from the submitter");
  await assertUserInOrg(db, org(req), approverId);
  const [approver] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.id, approverId), eq(users.organizationId, org(req)), eq(users.accessStatus, "active"), isNull(users.deletedAt),
  )).limit(1);
  if (!approver) throw new HttpError(422, "Approver must be an active user in this organization");
  const [projectForApproval] = await db.select({ customFields: projects.customFields }).from(projects).where(and(
    eq(projects.id, before.projectId), eq(projects.organizationId, org(req)), isNull(projects.deletedAt),
  )).limit(1);
  const projectSettings = isObject(projectForApproval?.customFields.qaqcReporting) ? projectForApproval.customFields.qaqcReporting : {};
  const designatedApproverIds = ["qualityRepresentativeId", "projectHeadId", "buHeadId", "corporateQualityManagerId", "dataGovernanceManagerId", "directorId"]
    .map((key) => userId(projectSettings, key));
  if (!designatedApproverIds.includes(approverId)) throw new HttpError(422, "Approver must be assigned in this project's QA/QC reporting settings");
  await projectAllowed(req, before.projectId);
  const today = await orgLocalToday(req);
  const period = normalizePeriod(before.reportType as ReportType, before.period, today);
  await assertSequence(before.projectId, before.reportType as ReportType, period, before);
  const downstreamSubmission = await hasDownstreamSubmission(before.projectId, before.reportType as ReportType, period);
  const { baseline: historicalBaseline } = await historyBaseline(before.projectId, before.reportType as ReportType, period);
  const baseline = before.state === "sent_back" && before.submittedAt && downstreamSubmission
    ? before.baseline as Record<string, any>
    : Object.keys(historicalBaseline).length ? historicalBaseline : await legacyBaseline(before.projectId, before.reportType as ReportType, period);
  await assertReportLovValues(req, before.reportType as ReportType, before.data as any);
  const validation = validateReportData(before.reportType as ReportType, before.data as any, baseline, true);
  if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
  const [project] = await db.select({ customFields: projects.customFields }).from(projects).where(eq(projects.id, before.projectId)).limit(1);
  const settings = isObject(project?.customFields.qaqcReporting) ? project.customFields.qaqcReporting : {};
  const targets = await targetsFor(req, project?.customFields as any ?? {}, settings);
  const submittedAt = new Date();
  const [row] = await db.update(qaqcReportSubmissions).set({
    state: "submitted", approverId, submittedById: actor(req), submittedAt,
    baseline, computed: calculateReport(before.reportType as ReportType, before.data as any, baseline, targets),
    updatedAt: submittedAt,
  }).where(and(eq(qaqcReportSubmissions.id, before.id), inArray(qaqcReportSubmissions.state, ["draft", "sent_back"]))).returning();
  if (!row) throw new HttpError(409, "Report state changed; reload before submitting");
  await audit(req, "submit", row.id, before, row);
  await notifyWithEmail(db, "qaqc", {
    organizationId: org(req), userId: approverId, type: "approval", title: "QA/QC report awaiting review",
    body: `${row.reportType} report for ${row.period} is awaiting review.`, entityType: "qaqc_report", entityId: row.id,
  });
  res.json(await withProject(row));
}));

router.post("/reports/:id/review", reportPermissionById("own"), asyncHandler(async (req, res) => {
  const decision = req.body?.decision;
  const comments = typeof req.body?.comments === "string" ? req.body.comments.trim() : "";
  if (!["approve", "send_back"].includes(decision)) throw new HttpError(422, "decision must be approve or send_back");
  if (decision === "send_back" && !comments) throw new HttpError(422, "Comments are required when sending back");
  const before = await reportRow(req, String(req.params.id));
  if (before.state !== "submitted") throw new HttpError(409, "Only submitted reports can be reviewed");
  if (before.submittedById === actor(req)) throw new HttpError(403, "You cannot review a report you submitted");
  if (before.approverId !== actor(req)) throw new HttpError(403, "Only the assigned approver may review this report");
  await projectAllowed(req, before.projectId);
  if (decision === "send_back" && await hasDownstreamSubmission(before.projectId, before.reportType as ReportType, before.period))
    throw new HttpError(409, `Cannot send back ${before.period}; a later report has already been submitted`);
  const state = decision === "approve" ? "approved" : "sent_back";
  const reviewedAt = new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(qaqcReportSubmissions).set({
      state, reviewComments: comments || null, approvedAt: decision === "approve" ? reviewedAt : null, updatedAt: reviewedAt,
    }).where(and(eq(qaqcReportSubmissions.id, before.id), eq(qaqcReportSubmissions.state, "submitted"), eq(qaqcReportSubmissions.approverId, actor(req)))).returning();
    if (!updated) throw new HttpError(409, "Report state changed; reload before reviewing");
    await audit(req, decision, updated.id, before, updated, tx);
    return updated;
  });
  if (before.submittedById) await notifyWithEmail(db, "qaqc", {
    organizationId: org(req), userId: before.submittedById, type: "decision", title: `QA/QC report ${state}`,
    body: comments || `Your report was ${state}.`, entityType: "qaqc_report", entityId: row.id,
  }).catch((error) => logger.error({ error, reportId: row.id }, "Unable to queue QA/QC review notification"));
  res.json(await withProject(row));
}));

router.post("/reports/:id/ai-brief", reportPermissionById("own"), asyncHandler(async (req, res) => {
  const row = await reportRow(req, String(req.params.id));
  if (row.reportType !== "monthly") throw new HttpError(422, "AI brief is available for monthly reports only");
  const data = isObject(req.body?.data) ? req.body.data : row.data;
  const history = await db.select({
    period: qaqcReportSubmissions.period, computed: qaqcReportSubmissions.computed, data: qaqcReportSubmissions.data,
  }).from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.projectId, row.projectId), eq(qaqcReportSubmissions.reportType, "monthly"),
    lte(qaqcReportSubmissions.period, row.period), inArray(qaqcReportSubmissions.state, ["submitted", "approved"]),
    isNull(qaqcReportSubmissions.deletedAt),
  )).orderBy(desc(qaqcReportSubmissions.period)).limit(12);
  const [project] = await db.select({ customFields: projects.customFields }).from(projects).where(eq(projects.id, row.projectId)).limit(1);
  const settings = isObject(project?.customFields.qaqcReporting) ? project.customFields.qaqcReporting : {};
  const validation = validateReportData("monthly", data, row.baseline as any, false);
  if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
  const targets = await targetsFor(req, project?.customFields as any ?? {}, settings);
  try {
    const result = await draftQualityBrief({
      app: "qaqc", organizationId: org(req), actorId: actor(req), projectId: row.projectId,
      period: row.period, data, computed: calculateReport("monthly", data, row.baseline as any, targets),
      targets, history,
      instruction: "Include month-over-month variance, negative changes, NCR ageing over 45 days, target performance and actionable recommendations. Explicitly flag PQI below target for three consecutive months.",
    });
    await audit(req, "ai_brief", row.id, undefined, { draft: result.draft });
    res.json({ draft: result.draft });
  } catch (error) {
    if (error instanceof AiUnavailableError) throw new HttpError(503, error.message);
    throw error;
  }
}));

export async function buildQaqcReportingDashboard(req: Request): Promise<QaqcReportingDashboard> {
  let typeAccess = (req as any).qaqcReportAccess as Map<ReportType, Awaited<ReturnType<typeof reportAccess>>> | undefined;
  if (!typeAccess) {
    typeAccess = new Map();
    for (const type of allowedTypes) {
      const current = await reportAccess(req, type);
      if (current.allowed) typeAccess.set(type, current);
    }
    (req as any).qaqcReportAccess = typeAccess;
  }
  if (!typeAccess.size) throw new HttpError(403, "Reporting permission is required");
  const reportTypes = [...typeAccess.keys()];
  const category = typeof req.query.category === "string" ? req.query.category : "all";
  if (!["all", "external_ncr", "internal_ncr", "rfi", "rmi"].includes(category))
    throw new HttpError(422, "category must be all, external_ncr, internal_ncr, rfi, or rmi");
  const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  for (const key of ["from", "to", "period"] as const) {
    if (req.query[key] !== undefined && !validDate(req.query[key])) throw new HttpError(422, `${key} must be a valid YYYY-MM-DD date`);
  }
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to
    : typeof req.query.period === "string" ? String(req.query.period) : undefined;
  if (from && to && from > to) throw new HttpError(422, "from must not be after to");
  const clauses: any[] = [eq(qaqcReportSubmissions.organizationId, org(req)), isNull(qaqcReportSubmissions.deletedAt), inArray(qaqcReportSubmissions.state, ["submitted", "approved"])];
  clauses.push(inArray(qaqcReportSubmissions.reportType, reportTypes));
  if (req.query.projectId) {
    await projectAllowed(req, String(req.query.projectId));
    clauses.push(eq(qaqcReportSubmissions.projectId, String(req.query.projectId)));
  }
  if (req.query.reportType) clauses.push(eq(qaqcReportSubmissions.reportType, parseType(req.query.reportType)));
  if (from) clauses.push(gte(qaqcReportSubmissions.period, from));
  if (to) clauses.push(lte(qaqcReportSubmissions.period, to));
  const rows = await db.select().from(qaqcReportSubmissions).where(and(...clauses)).orderBy(asc(qaqcReportSubmissions.period));
  const anyUnrestricted = [...typeAccess.values()].some((access) => access.scope.unrestricted);
  const visibleProjectIds = [...new Set([...typeAccess.values()].flatMap((access) => access.scope.projectIds))];
  const projectClauses: any[] = [eq(projects.organizationId, org(req)), eq(projects.status, "active"), isNull(projects.deletedAt)];
  if (!anyUnrestricted) projectClauses.push(inArray(projects.id, visibleProjectIds));
  const projectsInScope = await db.select({
    id: projects.id, name: projects.name, code: projects.code, businessUnitId: projects.businessUnitId,
    businessUnitName: businessUnits.name,
  }).from(projects).leftJoin(businessUnits, and(
    eq(projects.businessUnitId, businessUnits.id), eq(businessUnits.organizationId, org(req)), isNull(businessUnits.deletedAt),
  )).where(and(...projectClauses));
  const projectById = new Map(projectsInScope.map((project) => [project.id, project]));
  const projectGroup = typeof req.query.projectGroup === "string" ? req.query.projectGroup : undefined;
  const allowedProjectIds = new Set(projectsInScope.filter((project) =>
    !projectGroup || project.businessUnitId === projectGroup || project.businessUnitName === projectGroup,
  ).map((project) => project.id));
  const scopedRows = rows.filter((row) => allowedProjectIds.has(row.projectId) && canReadByCapability(req, row));
  const monthly = scopedRows.filter((row) => row.reportType === "monthly").map((row) => ({
    id: row.id, projectId: row.projectId, projectName: projectById.get(row.projectId)?.name ?? null, period: row.period,
    state: row.state, computed: row.computed as MonthlyReportComputed, data: row.data,
  }));
  const csat = scopedRows.filter((row) => row.reportType === "csat").map((row) => ({
    id: row.id, projectId: row.projectId, projectName: projectById.get(row.projectId)?.name ?? null, period: row.period, computed: row.computed as CsatReportComputed, data: row.data,
  }));
  const dailyHistory = (await db.select().from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.organizationId, org(req)), isNull(qaqcReportSubmissions.deletedAt),
    inArray(qaqcReportSubmissions.state, ["submitted", "approved"]), eq(qaqcReportSubmissions.reportType, "daily"),
    req.query.projectId ? eq(qaqcReportSubmissions.projectId, String(req.query.projectId)) : undefined,
  )).orderBy(asc(qaqcReportSubmissions.period)))
    .filter((row) => allowedProjectIds.has(row.projectId) && canReadByCapability(req, row));
  const dailyByProject = new Map<string, typeof dailyHistory>();
  for (const report of dailyHistory) dailyByProject.set(report.projectId, [...(dailyByProject.get(report.projectId) ?? []), report]);
  const latestGlobalDailyPeriod = dailyHistory.at(-1)?.period;
  const requestedEnd = to ?? latestGlobalDailyPeriod;
  const dailyMovement = [...dailyByProject.entries()].flatMap(([projectId, history]) => {
    if (!requestedEnd) return [];
    const end = [...history].reverse().find((row) => row.period <= requestedEnd);
    if (!end) return [];
    const startPeriod = from ?? shiftPeriod(end.period, "daily", -1);
    const start = [...history].reverse().find((row) => row.period <= startPeriod);
    const endData = { ...end.computed, disciplines: (end.data as any).disciplines ?? {} };
    const startData = start ? { ...start.computed, disciplines: (start.data as any).disciplines ?? {} } : {};
    return [{
      id: end.id, projectId, projectName: projectById.get(projectId)?.name ?? null, period: end.period,
      snapshot: endData as DailyReportComputed, movement: from || to ? subtractReportSnapshot(endData, startData) : null,
      absoluteSnapshot: !from && !to, globalPeriod: requestedEnd, baselinePeriod: start?.period ?? null,
    }];
  });
  const aggregateByPeriod = new Map<string, { count: number; pqi: number; metrics: Record<string, number> }>();
  for (const row of monthly) {
    const aggregate = aggregateByPeriod.get(row.period) ?? { count: 0, pqi: 0, metrics: {} };
    const computed = row.computed as any;
    aggregate.count++;
    aggregate.pqi += Number(computed.pqi?.accumulated ?? 0);
    for (const [metric, value] of Object.entries(computed.metrics ?? {})) {
      aggregate.metrics[metric] = (aggregate.metrics[metric] ?? 0) + Number((value as any).accumulatedRate ?? 0);
    }
    aggregateByPeriod.set(row.period, aggregate);
  }
  return {
    filters: {
      projectId: typeof req.query.projectId === "string" ? req.query.projectId : null,
      projectGroup: typeof req.query.projectGroup === "string" ? req.query.projectGroup : null,
      from: from ?? null, to: to ?? null, category,
    },
    monthly, aggregates: [...aggregateByPeriod.entries()].map(([period, value]) => ({
      period, projects: value.count, averagePqi: value.count ? Number((value.pqi / value.count).toFixed(2)) : 0,
      metrics: Object.fromEntries(Object.entries(value.metrics)
        .filter(([key]) => category === "all" || category === key)
        .map(([key, total]) => [key, Number((total / value.count).toFixed(2))])),
    })),
    csat, csatAverage: csat.length ? Number((csat.reduce((sum, row) => sum + Number((row.computed as any).averageRating ?? 0), 0) / csat.length).toFixed(2)) : 0,
    daily: dailyMovement,
  };
}

router.get("/dashboard", multipleReportAccess(), asyncHandler(async (req, res) => {
  res.json(await buildQaqcReportingDashboard(req));
}));

router.patch("/projects/:projectId/settings", requireAppAdmin("qaqc"), asyncHandler(async (req, res) => {
  const projectId = String(req.params.projectId);
  await projectAllowed(req, projectId);
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, org(req)), isNull(projects.deletedAt),
  )).limit(1);
  if (!project || project.status !== "active") throw new HttpError(404, "Active project not found");
  const body = req.body ?? {};
  const settings = isObject(project.customFields.qaqcReporting) ? { ...project.customFields.qaqcReporting } : {};
  const next = { ...settings };
  if (!Array.isArray(next.dailyDistributionDays)) next.dailyDistributionDays = [1, 15];
  if (body.targets !== undefined) {
    if (!isObject(body.targets) || Object.values(body.targets).some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100))
      throw new HttpError(422, "targets must contain percentages from 0 through 100");
    next.targets = body.targets;
  }
  const userFields = ["pmId", "peId", "dcId", "qualityRepresentativeId", "projectHeadId", "buHeadId", "corporateQualityManagerId", "dataGovernanceManagerId", "directorId"];
  for (const key of userFields) if (body[key] !== undefined) {
    if (body[key] !== null && typeof body[key] !== "string") throw new HttpError(422, `${key} must be a user ID or null`);
    if (body[key]) {
      await assertUserInOrg(db, org(req), body[key]);
      const [user] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.id, body[key]), eq(users.organizationId, org(req)), eq(users.accessStatus, "active"), isNull(users.deletedAt),
      )).limit(1);
      if (!user) throw new HttpError(422, `${key} must reference an active organization user`);
    }
    next[key] = body[key];
  }
  for (const [key, valid] of [
    ["distributionMemberIds", Array.isArray],
    ["dailyDistributionDays", Array.isArray],
  ] as const) if (body[key] !== undefined) {
    if (!valid(body[key])) throw new HttpError(422, `${key} must be an array`);
    if (key === "distributionMemberIds") {
      if (new Set(body[key]).size !== body[key].length) throw new HttpError(422, "distributionMemberIds must be unique");
      for (const id of body[key]) {
        if (typeof id !== "string") throw new HttpError(422, "distributionMemberIds must contain user IDs");
        await assertUserInOrg(db, org(req), id);
        const [user] = await db.select({ id: users.id }).from(users).where(and(
          eq(users.id, id), eq(users.organizationId, org(req)), eq(users.accessStatus, "active"), isNull(users.deletedAt),
        )).limit(1);
        if (!user) throw new HttpError(422, "distributionMemberIds must reference active organization users");
      }
    }
    if (key === "dailyDistributionDays" && (body[key].some((day: unknown) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 31)
      || new Set(body[key]).size !== body[key].length))
      throw new HttpError(422, "dailyDistributionDays values must be unique calendar days from 1 through 31");
    next[key] = body[key];
  }
  if (body.monthlyDistributionDay !== undefined) {
    if (!Number.isInteger(body.monthlyDistributionDay) || body.monthlyDistributionDay < 1 || body.monthlyDistributionDay > 31) throw new HttpError(422, "monthlyDistributionDay must be from 1 through 31");
    next.monthlyDistributionDay = body.monthlyDistributionDay;
  }
  if (body.reportingStartDate !== undefined) {
    if (typeof body.reportingStartDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.reportingStartDate)
      || Number.isNaN(Date.parse(`${body.reportingStartDate}T00:00:00Z`))
      || new Date(`${body.reportingStartDate}T00:00:00Z`).toISOString().slice(0, 10) !== body.reportingStartDate)
      throw new HttpError(422, "reportingStartDate must be a calendar date");
    next.reportingStartDate = body.reportingStartDate;
  }
  const nextCustomFields: Record<string, any> = { ...project.customFields, qaqcReporting: next };
  if (body.targets !== undefined) nextCustomFields.targets = body.targets;
  const [updated] = await db.update(projects).set({
    customFields: nextCustomFields, updatedAt: new Date(),
  }).where(and(eq(projects.id, projectId), eq(projects.organizationId, org(req)))).returning();
  await writeAuditLog(db, "qaqc", {
    organizationId: org(req), actorId: actor(req), action: "update_settings",
    entityType: "qaqc_project_settings", entityId: projectId, before: settings, after: next, ipAddress: req.ip,
  });
  res.json({ projectId, settings: (updated.customFields as any).qaqcReporting });
}));

router.get("/distribution-status", multipleReportAccess(), asyncHandler(async (req, res) => {
  const accesses = [...((req as any).qaqcReportAccess as Map<ReportType, Awaited<ReturnType<typeof reportAccess>>>).values()];
  const unrestricted = accesses.some((access) => access.scope.unrestricted);
  const projectIds = [...new Set(accesses.flatMap((access) => access.scope.projectIds))];
  const filters: any[] = [eq(qaqcReportDeliveryRuns.organizationId, org(req)), isNull(qaqcReportDeliveryRuns.deletedAt)];
  if (!unrestricted) filters.push(inArray(qaqcReportDeliveryRuns.projectId, projectIds));
  const where = and(...filters);
  const [runs, totals] = await Promise.all([
    db.select({
      id: qaqcReportDeliveryRuns.id, projectId: qaqcReportDeliveryRuns.projectId,
      runKey: qaqcReportDeliveryRuns.runKey, kind: qaqcReportDeliveryRuns.kind,
      status: qaqcReportDeliveryRuns.status, payload: qaqcReportDeliveryRuns.payload,
      createdAt: qaqcReportDeliveryRuns.createdAt, updatedAt: qaqcReportDeliveryRuns.updatedAt,
    }).from(qaqcReportDeliveryRuns).where(where).orderBy(desc(qaqcReportDeliveryRuns.createdAt)).limit(100),
    db.select({ total: count() }).from(qaqcReportDeliveryRuns).where(where),
  ]);
  res.json({ jobs: runs, totalRuns: Number(totals[0]?.total ?? 0), pendingRuns: runs.filter((run) => run.status === "pending").length });
}));

export default router;