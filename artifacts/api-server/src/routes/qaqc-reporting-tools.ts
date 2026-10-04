import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import {
  auditLogEntries, businessUnits, db, organizations, projects, qaqcReportDeliveryRuns, qaqcReportSubmissions, reportTemplates, users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  getAuthorizedFullProjectScope, getAuthorizedProjectScope, requireAppAccess, requirePermission,
  type EffectiveProjectScope,
} from "../middlewares/rbac";
import { assertProjectInOrg } from "../lib/tenancy";
import { asyncHandler, HttpError } from "../lib/workspace";
import { validateReportData } from "../lib/qaqc-reporting-model";
import {
  exportQaqcDashboardExcel, exportQaqcDashboardPdf, exportQaqcReportExcel, exportQaqcReportPdf,
  type QaqcDashboardExport, type QaqcReportExport,
} from "../lib/qaqc-reporting-export";
import {
  makeQaqcReportingTemplate, parseQaqcReportingWorkbook, qaqcReportingWorkbookMimeType,
  type ReportingProjectOption, type ReportingType,
} from "../lib/qaqc-reporting-excel";
import { buildQaqcReportingDashboard } from "./qaqc-reporting";
import { safeTemplateMetadata } from "../lib/qaqc-pdf-templates";
import type { QaqcOperation } from "@workspace/field-controls";

const router: IRouter = Router();
router.use(requireAuth);
router.use(requireAppAccess("qaqc"));
const organizationId = (req: any) => req.currentUser!.organizationId as string;
const safeType = (value: unknown): value is ReportingType => value === "monthly" || value === "daily" || value === "csat";
const reportModule = (type: ReportingType) => type === "daily" ? "daily_reports" : type === "csat" ? "csat_reports" : "monthly_reports";
const REPORT_TYPES: ReportingType[] = ["monthly", "daily", "csat"];

async function organizationLocalDate(req: any) {
  const [organization] = await db.select({ timezone: organizations.timezone }).from(organizations)
    .where(eq(organizations.id, organizationId(req))).limit(1);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: organization?.timezone ?? "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function reportPermission(source: "query" | "body") {
  return (req: any, res: any, next: any) => {
    const type = source === "query" ? req.query.reportType : req.body?.reportType;
    if (!safeType(type)) return next();
    return requirePermission("qaqc", reportModule(type), source === "body" ? "own" : "select", { qaqcOperation: "import" })(req, res, next);
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function download(res: Parameters<Parameters<typeof asyncHandler>[0]>[1], filename: string, type: string, content: Buffer) {
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", content.length);
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
  res.send(content);
}

type ReportAccess = { scope: EffectiveProjectScope; fullScope: EffectiveProjectScope };
async function reportAccess(req: any, type: ReportingType, operation?: QaqcOperation): Promise<ReportAccess> {
  const target = { module: reportModule(type), action: "select" as const };
  let [scope, fullScope] = await Promise.all([
    getAuthorizedProjectScope(req, "qaqc", target),
    getAuthorizedFullProjectScope(req, "qaqc", target),
  ]);
  if (operation) {
    const targetOperation = { ...target, operation };
    const [operationScope, operationFull] = await Promise.all([
      getAuthorizedProjectScope(req, "qaqc", targetOperation),
      getAuthorizedFullProjectScope(req, "qaqc", targetOperation),
    ]);
    const intersection = (a: EffectiveProjectScope, b: EffectiveProjectScope): EffectiveProjectScope =>
      a.unrestricted ? b : b.unrestricted ? a : { unrestricted: false, projectIds: a.projectIds.filter(id => b.projectIds.includes(id)) };
    scope = intersection(scope, operationScope);
    fullScope = intersection(fullScope, operationFull);
  }
  if (!scope.unrestricted && !scope.projectIds.length) throw new HttpError(403, `Reporting ${type} permission is required`);
  return { scope, fullScope };
}

function canSeeProject(access: ReportAccess, projectId: string) {
  return access.scope.unrestricted || access.scope.projectIds.includes(projectId);
}

function canReadReport(req: any, access: ReportAccess, report: any) {
  if (!canSeeProject(access, report.projectId)) return false;
  if (access.fullScope.unrestricted || access.fullScope.projectIds.includes(report.projectId)) return true;
  return report.createdById === req.currentUser?.id
    || report.approverId === req.currentUser?.id;
}

async function projectScopeIds(req: any, types: ReportingType[]) {
  const accesses = await Promise.all(types.map(async (type) => {
    try { return await reportAccess(req, type); } catch (error) {
      if (error instanceof HttpError && error.status === 403) return null;
      throw error;
    }
  }));
  if (!accesses.some(Boolean)) throw new HttpError(403, "A QA/QC reporting view permission is required");
  if (accesses.some((access) => access?.scope.unrestricted)) return null;
  return [...new Set(accesses.flatMap((access) => access?.scope.projectIds ?? []))];
}

async function getReport(req: any, id: string) {
  const clauses = [
    eq(qaqcReportSubmissions.organizationId, organizationId(req)),
    eq(qaqcReportSubmissions.id, id),
    isNull(qaqcReportSubmissions.deletedAt),
  ];
  const [report] = await db.select().from(qaqcReportSubmissions).where(and(...clauses)).limit(1);
  if (!report) throw new HttpError(404, "QA/QC report was not found in your authorized project scope");
  if (!safeType(report.reportType)) throw new HttpError(404, "QA/QC report type is invalid");
  const access = await reportAccess(req, report.reportType);
  if (!canReadReport(req, access, report)) throw new HttpError(404, "QA/QC report was not found in your authorized project scope");
  const [project] = await db.select({ name: projects.name, code: projects.code }).from(projects)
    .where(and(eq(projects.id, report.projectId), eq(projects.organizationId, organizationId(req)), isNull(projects.deletedAt))).limit(1);
  const audit = await db.select({
    id: auditLogEntries.id, action: auditLogEntries.action, actorId: auditLogEntries.actorId,
    before: auditLogEntries.before, after: auditLogEntries.after, createdAt: auditLogEntries.createdAt,
  }).from(auditLogEntries).where(and(
    eq(auditLogEntries.organizationId, organizationId(req)), eq(auditLogEntries.entityType, "qaqc_report"),
    eq(auditLogEntries.entityId, report.id),
  )).orderBy(auditLogEntries.createdAt);
  const actorIds = [...new Set(audit.map((entry) => entry.actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users)
    .where(and(eq(users.organizationId, organizationId(req)), inArray(users.id, actorIds))) : [];
  const actorNames = new Map(actors.map((user) => [user.id, user.fullName]));
  const templates = await db.select({ name: reportTemplates.name, template: reportTemplates.template })
    .from(reportTemplates).where(and(
      eq(reportTemplates.organizationId, organizationId(req)), isNull(reportTemplates.deletedAt),
    )).orderBy(asc(reportTemplates.name));
  return {
    ...report, projectName: project?.name ?? null, projectCode: project?.code ?? null,
    reportTemplates: templates.map((template) => ({ name: template.name, template: safeTemplateMetadata(jsonObject(template.template)) })),
    history: audit.map(({ after, ...entry }) => ({
      ...entry, actorName: entry.actorId ? actorNames.get(entry.actorId) ?? "Former or unavailable user" : "System",
      before: entry.before, after: (() => {
        if (!after) return null;
        const { _requestIp: _ignored, ...publicValues } = after as Record<string, unknown>;
        return publicValues;
      })(),
    })),
  } as QaqcReportExport;
}

router.get("/template", reportPermission("query"), asyncHandler(async (req, res) => {
  const type = req.query.reportType;
  if (!safeType(type)) throw new HttpError(422, "reportType must be monthly, daily, or csat");
  const access = await reportAccess(req, type);
  const ids = access.scope.unrestricted ? null : access.scope.projectIds;
  const clauses = [eq(projects.organizationId, organizationId(req)), eq(projects.status, "active"), isNull(projects.deletedAt)];
  if (ids) clauses.push(inArray(projects.id, ids));
  const rows = await db.select({ id: projects.id, name: projects.name, code: projects.code, customFields: projects.customFields })
    .from(projects).where(and(...clauses)).orderBy(projects.name);
  const options: ReportingProjectOption[] = rows.map((project) => ({
    id: project.id, name: project.name, code: project.code,
    costCentre: typeof project.customFields.costCentre === "string" ? project.customFields.costCentre : null,
  }));
  const buffer = makeQaqcReportingTemplate(type, options);
  download(res, `qaqc-${type}-report-template.xlsx`, qaqcReportingWorkbookMimeType, buffer);
}));

router.post("/import", reportPermission("body"), asyncHandler(async (req, res) => {
  const { reportType, projectId, period, workbook } = req.body ?? {};
  if (!safeType(reportType)) throw new HttpError(422, "reportType must be monthly, daily, or csat");
  if (typeof projectId !== "string" || !projectId) throw new HttpError(422, "Select a project in the application before importing the workbook");
  if (typeof period !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    throw new HttpError(422, "period must be a valid YYYY-MM-DD reporting period");
  }
  const parsedPeriod = new Date(`${period}T00:00:00.000Z`);
  if (Number.isNaN(parsedPeriod.getTime()) || parsedPeriod.toISOString().slice(0, 10) !== period) {
    throw new HttpError(422, "period must be a valid calendar date");
  }
  if (reportType === "monthly" && !period.endsWith("-01")) {
    throw new HttpError(422, "Monthly periods must be the first day of the month");
  }
  const today = await organizationLocalDate(req);
  if (reportType === "monthly" && period > `${today.slice(0, 7)}-01`) {
    throw new HttpError(422, "Monthly periods cannot be in the future");
  }
  if (reportType === "daily" && period > today) {
    throw new HttpError(422, "Daily report period cannot be in the future");
  }
  if (reportType === "csat" && period > today) {
    throw new HttpError(422, "CSAT survey date cannot be in the future");
  }
  await assertProjectInOrg(db, organizationId(req), projectId);
  const access = await reportAccess(req, reportType, "import");
  if (!canSeeProject(access, projectId)) throw new HttpError(403, "You do not have reporting permission for this project");
  const [activeProject] = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, organizationId(req)),
    eq(projects.status, "active"), isNull(projects.deletedAt),
  )).limit(1);
  if (!activeProject) throw new HttpError(422, "Select an active project before importing");
  if (typeof workbook !== "string") throw new HttpError(422, "workbook must contain base64-encoded .xlsx data");
  let baseline: Record<string, unknown> = {};
  const [prior] = await db.select({
    computed: qaqcReportSubmissions.computed, data: qaqcReportSubmissions.data,
  })
    .from(qaqcReportSubmissions).where(and(
      eq(qaqcReportSubmissions.organizationId, organizationId(req)),
      eq(qaqcReportSubmissions.projectId, projectId),
      eq(qaqcReportSubmissions.reportType, reportType),
      lt(qaqcReportSubmissions.period, period),
      inArray(qaqcReportSubmissions.state, ["submitted", "approved"]),
      isNull(qaqcReportSubmissions.deletedAt),
    )).orderBy(desc(qaqcReportSubmissions.period)).limit(1);
  if (prior && reportType === "daily") baseline = jsonObject(prior.data);
  else if (prior && reportType === "monthly") {
    const computed = jsonObject(prior.computed);
    const metrics = jsonObject(computed.metrics);
    baseline = {
      metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => {
        const metric = jsonObject(metrics[key]);
        return [key, {
          accumulatedIssued: Number(metric.accumulatedIssued ?? 0),
          accumulatedClosed: Number(metric.accumulatedClosed ?? 0),
        }];
      })),
      material: {
        accumulatedIssued: Number(jsonObject(computed.material).accumulatedIssued ?? 0),
        accumulatedClosed: Number(jsonObject(computed.material).accumulatedClosed ?? 0),
      },
      qtbt: {
        accumulatedTalkCount: Number(jsonObject(computed.qtbt).accumulatedTalkCount ?? 0),
        accumulatedManhours: Number(jsonObject(computed.qtbt).accumulatedManhours ?? 0),
      },
    };
  }
  let parsed;
  try {
    parsed = parseQaqcReportingWorkbook({
      reportType,
      base64: workbook,
      baseline,
      validate: (type, data, frozenBaseline, submit) => validateReportData(type, data, frozenBaseline, submit).errors,
    });
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : "Workbook could not be validated");
  }
  res.json({ data: parsed.data, errors: parsed.errors.map((error) => `${error.sheet} row ${error.row} (${error.field}): ${error.message}`) });
}));

router.get("/reports/:id/export", asyncHandler(async (req, res) => {
  const format = requestedFormat(req);
  const report = await getReport(req, String(req.params.id));
  const exportAccess = await reportAccess(req, report.reportType as ReportingType, "export");
  if (!canReadReport(req, exportAccess, report)) throw new HttpError(403, "Export is not permitted for this report");
  const name = `qaqc-${report.reportType}-${report.period}-${report.referenceNumber ?? report.id}`;
  const bytes = format === "pdf" ? await exportQaqcReportPdf(report, { templateId: selectedTemplateId(req) }) : exportQaqcReportExcel(report);
  download(res, `${name}.${format}`, format === "pdf" ? "application/pdf" : qaqcReportingWorkbookMimeType, bytes);
}));

function requestedFormat(req: any) {
  if (req.query.format !== undefined) {
    const explicit = String(req.query.format).toLowerCase();
    if (explicit === "pdf" || explicit === "xlsx") return explicit;
    throw new HttpError(422, "format must be pdf or xlsx");
  }
  const accept = String(req.get?.("accept") ?? req.headers?.accept ?? "").toLowerCase();
  if (accept.split(",").some((entry: string) => entry.trim().split(";")[0] === qaqcReportingWorkbookMimeType)) return "xlsx";
  return "pdf";
}

function selectedTemplateId(req: Request) {
  if (req.query.templateId === undefined) return undefined;
  if (typeof req.query.templateId !== "string" || !req.query.templateId) throw new HttpError(422, "Invalid templateId");
  return req.query.templateId;
}
function subtractTree(end: any, start: any): any {
  if (typeof end === "number") return end - (typeof start === "number" ? start : 0);
  if (end && typeof end === "object" && !Array.isArray(end)) {
    return Object.fromEntries(Object.entries(end).map(([key, value]) => [key, subtractTree(value, start?.[key])]));
  }
  return end;
}

function shiftDate(period: string, days: number) {
  const date = new Date(`${period}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

router.get("/dashboard/export", asyncHandler(async (req, res) => {
  const format = String(req.query.format ?? "").toLowerCase();
  if (format !== "pdf" && format !== "xlsx") throw new HttpError(422, "format must be pdf or xlsx");
  const source = await buildQaqcReportingDashboard(req as Request);
  const requestedType = req.query.reportType;
  if (requestedType !== undefined && !safeType(requestedType)) throw new HttpError(422, "reportType must be monthly, daily, or csat");
  const types = requestedType ? [requestedType as ReportingType] : REPORT_TYPES;
  const accessByType = new Map<ReportingType, ReportAccess>();
  for (const type of types) {
    try { accessByType.set(type, await reportAccess(req, type, "export")); } catch (error) {
      if (!(error instanceof HttpError && error.status === 403)) throw error;
    }
  }
  if (!accessByType.size) throw new HttpError(403, "A QA/QC reporting view permission is required");
  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (requestedProjectId) {
    await assertProjectInOrg(db, organizationId(req), requestedProjectId);
    if (![...accessByType.values()].some((access) => canSeeProject(access, requestedProjectId))) {
      throw new HttpError(403, "You do not have reporting permission for this project");
    }
  }
  const authorizedProjectIds = new Set([...accessByType.values()].flatMap((access) =>
    access.scope.unrestricted ? [] : access.scope.projectIds));
  const unrestrictedProjectView = [...accessByType.values()].some((access) => access.scope.unrestricted);
  const visibleProjectClauses = [
    eq(projects.organizationId, organizationId(req)), eq(projects.status, "active"), isNull(projects.deletedAt),
  ];
  if (!unrestrictedProjectView) visibleProjectClauses.push(inArray(projects.id, [...authorizedProjectIds]));
  if (requestedProjectId) visibleProjectClauses.push(eq(projects.id, requestedProjectId));
  const visibleProjects = await db.select({
    id: projects.id, name: projects.name, code: projects.code, businessUnitId: projects.businessUnitId,
    businessUnitName: businessUnits.name,
  }).from(projects).leftJoin(businessUnits, and(
    eq(projects.businessUnitId, businessUnits.id), eq(businessUnits.organizationId, organizationId(req)),
    isNull(businessUnits.deletedAt),
  )).where(and(...visibleProjectClauses));
  const group = typeof req.query.projectGroup === "string" ? req.query.projectGroup : undefined;
  const authorizedGroupIds = visibleProjects.filter((project) =>
    !group || project.businessUnitId === group || project.businessUnitName === group,
  ).map((project) => project.id);
  const permittedProjectIds = new Set(authorizedGroupIds);
  const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  for (const key of ["period", "from", "to"] as const) {
    if (req.query[key] !== undefined && !validDate(req.query[key])) throw new HttpError(422, `${key} must be a valid YYYY-MM-DD date`);
  }
  if (validDate(req.query.from) && validDate(req.query.to) && String(req.query.from) > String(req.query.to)) {
    throw new HttpError(422, "from must not be after to");
  }
  const category = typeof req.query.category === "string" ? req.query.category : "all";
  const metricCategories = ["external_ncr", "internal_ncr", "rfi", "rmi"];
  if (category !== "all" && !metricCategories.includes(category)) {
    throw new HttpError(422, "category must be all, external_ncr, internal_ncr, rfi, or rmi");
  }
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to
    : typeof req.query.period === "string" ? req.query.period : undefined;
  const rows = await db.select().from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.organizationId, organizationId(req)),
    inArray(qaqcReportSubmissions.state, ["submitted", "approved"]),
    isNull(qaqcReportSubmissions.deletedAt),
  )).orderBy(asc(qaqcReportSubmissions.period));
  const names = new Map(visibleProjects.map((project) => [project.id, project]));
  const scopedRows = rows.filter((row) => {
    const access = accessByType.get(row.reportType as ReportingType);
    return access && permittedProjectIds.has(row.projectId) && canReadReport(req, access, row);
  });
  const monthlyRows = scopedRows.filter((row) => row.reportType === "monthly"
    && (!from || row.period >= from) && (!to || row.period <= to));
  const csatRows = scopedRows.filter((row) => row.reportType === "csat"
    && (!from || row.period >= from) && (!to || row.period <= to));
  const dailyByProject = new Map<string, typeof scopedRows>();
  for (const row of scopedRows.filter((item) => item.reportType === "daily")) {
    dailyByProject.set(row.projectId, [...(dailyByProject.get(row.projectId) ?? []), row]);
  }
  const dailySnapshots = [...dailyByProject.entries()].flatMap(([projectId, history]) => {
    const requestedEnd = to ?? history.at(-1)?.period;
    if (!requestedEnd) return [];
    const end = [...history].reverse().find((row) => row.period <= requestedEnd);
    if (!end) return [];
    const startPeriod = from ?? shiftDate(end.period, -1);
    const start = [...history].reverse().find((row) => row.period <= startPeriod);
    return [{
      projectId, projectName: names.get(projectId)?.name ?? projectId, period: end.period,
      snapshot: jsonObject(end.computed),
      movement: from || to ? subtractTree(jsonObject(end.computed), jsonObject(start?.computed)) : null,
      absoluteSnapshot: !from && !to,
      endReport: end,
      startReport: start,
    }];
  });
  const exportRows = [...monthlyRows, ...csatRows, ...dailySnapshots.map((item) => item.endReport)]
    .filter((row, index, array) => array.findIndex((candidate) => candidate.id === row.id) === index);
  const history = exportRows.length ? await db.select({
    id: auditLogEntries.id, entityId: auditLogEntries.entityId, actorId: auditLogEntries.actorId,
    action: auditLogEntries.action, before: auditLogEntries.before, after: auditLogEntries.after,
    createdAt: auditLogEntries.createdAt,
  }).from(auditLogEntries).where(and(
    eq(auditLogEntries.organizationId, organizationId(req)), eq(auditLogEntries.entityType, "qaqc_report"),
    inArray(auditLogEntries.entityId, exportRows.map((row) => row.id)),
  )).orderBy(auditLogEntries.createdAt) : [];
  const historyById = new Map<string, Array<Record<string, unknown>>>();
  for (const event of history) {
    if (!event.entityId) continue;
    const events = historyById.get(event.entityId) ?? [];
    events.push({
      id: event.id, actorId: event.actorId, action: event.action, createdAt: event.createdAt,
      before: event.before, after: event.after,
    });
    historyById.set(event.entityId, events);
  }
  const templates = await db.select({ name: reportTemplates.name, template: reportTemplates.template })
    .from(reportTemplates).where(and(
      eq(reportTemplates.organizationId, organizationId(req)), isNull(reportTemplates.deletedAt),
    )).orderBy(asc(reportTemplates.name));
  const fullReports = exportRows.map((row) => {
    const project = names.get(row.projectId);
    return {
      ...row,
      projectName: project?.name ?? row.projectId, projectCode: project?.code ?? "",
      reportTemplates: templates.map((template) => ({ name: template.name, template: safeTemplateMetadata(jsonObject(template.template)) })),
      data: jsonObject(row.data), computed: jsonObject(row.computed), baseline: jsonObject(row.baseline),
      history: historyById.get(row.id) ?? [],
    };
  }) as QaqcReportExport[];
  const sourceKey = (type: ReportingType, projectId: string, period: string) => `${type}:${projectId}:${period}`;
  const sourceKeys = new Set([
    ...source.monthly.map((row: any) => sourceKey("monthly", row.projectId, row.period)),
    ...source.csat.map((row: any) => sourceKey("csat", row.projectId, row.period)),
    ...source.daily.map((row: any) => sourceKey("daily", row.projectId, row.period)),
  ]);
  const authorizedReports = fullReports.filter((report) =>
    sourceKeys.has(sourceKey(report.reportType as ReportingType, report.projectId, report.period)));
  const dashboardRows = [
    ...source.monthly.map((row: any) => ({ ...row, reportType: "monthly", ...jsonObject(row.computed) })),
    ...source.csat.map((row: any) => ({ ...row, reportType: "csat", ...jsonObject(row.computed) })),
    ...source.daily.map((row: any) => ({ ...row, reportType: "daily" })),
  ];
  const dashboardData = {
    filters: source.filters,
    monthly: source.monthly,
    aggregates: source.aggregates,
    csat: source.csat,
    csatAverage: source.csatAverage,
    daily: source.daily,
  };
  const dashboard: QaqcDashboardExport = {
    organizationId: organizationId(req),
    title: "QA/QC Reporting Dashboard",
    filters: { ...source.filters, reportType: req.query.reportType ?? "all", category },
    summary: dashboardData,
    rows: dashboardRows,
    dashboardData,
    trends: [...source.aggregates, ...source.daily],
    reports: authorizedReports,
  };
  const bytes = format === "pdf" ? await exportQaqcDashboardPdf(dashboard, { templateId: selectedTemplateId(req) }) : exportQaqcDashboardExcel(dashboard);
  download(res, `qaqc-dashboard.${format}`, format === "pdf" ? "application/pdf" : qaqcReportingWorkbookMimeType, bytes);
}));

router.get("/distribution-status", asyncHandler(async (req, res) => {
  const ids = await projectScopeIds(req, ["monthly", "daily"]);
  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (requestedProjectId) {
    await assertProjectInOrg(db, organizationId(req), requestedProjectId);
    if (ids && !ids.includes(requestedProjectId)) throw new HttpError(403, "You do not have reporting permission for this project");
  }
  const projectClauses = [eq(projects.organizationId, organizationId(req)), eq(projects.status, "active"), isNull(projects.deletedAt)];
  if (ids) projectClauses.push(inArray(projects.id, ids));
  if (requestedProjectId) projectClauses.push(eq(projects.id, requestedProjectId));
  const projectRows = await db.select({ id: projects.id, name: projects.name, customFields: projects.customFields })
    .from(projects).where(and(...projectClauses));
  const distribution = await Promise.all(projectRows.map(async (project) => {
    const settings = jsonObject(jsonObject(project.customFields).qaqcReporting);
    const configuredIds = Array.isArray(settings.distributionMemberIds)
      ? [...new Set(settings.distributionMemberIds.filter((id): id is string => typeof id === "string"))] : [];
    const activeRecipients = configuredIds.length ? await db.select({ id: users.id }).from(users).where(and(
      eq(users.organizationId, organizationId(req)), inArray(users.id, configuredIds),
      eq(users.accessStatus, "active"), isNull(users.deletedAt),
    )) : [];
    const roleKeys = ["dataGovernanceManagerId", "qualityRepresentativeId", "projectHeadId", "buHeadId", "corporateQualityManagerId", "directorId"];
    const missingRecipientRoles = roleKeys.filter((key) => typeof settings[key] !== "string" || !settings[key]);
    const hasMonthlySchedule = Number.isInteger(settings.monthlyDistributionDay)
      && Number(settings.monthlyDistributionDay) >= 1 && Number(settings.monthlyDistributionDay) <= 31;
    const hasDailySchedule = Array.isArray(settings.dailyDistributionDays)
      && settings.dailyDistributionDays.length > 0
      && settings.dailyDistributionDays.every((day) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 31);
    const missingConfiguration = [
      ...(activeRecipients.length ? [] : ["active distribution members"]),
      ...(hasMonthlySchedule ? [] : ["monthly distribution day"]),
      ...(hasDailySchedule ? [] : ["fortnightly daily distribution days"]),
      ...missingRecipientRoles.map((key) => `active recipient: ${key}`),
    ];
    return {
      projectId: project.id,
      projectName: project.name,
      configured: missingConfiguration.length === 0,
      distributionMemberCount: activeRecipients.length,
      monthlyDistributionDay: settings.monthlyDistributionDay ?? null,
      dailyDistributionDays: settings.dailyDistributionDays ?? null,
      missingConfiguration,
      configurationMessage: missingConfiguration.length
        ? `Configure ${missingConfiguration.join(", ")} in project QA/QC Reporting settings. No recipient is inferred or fabricated.`
        : null,
    };
  }));
  const runClauses = [eq(qaqcReportDeliveryRuns.organizationId, organizationId(req))];
  if (ids) runClauses.push(inArray(qaqcReportDeliveryRuns.projectId, ids));
  if (requestedProjectId) runClauses.push(eq(qaqcReportDeliveryRuns.projectId, requestedProjectId));
  const runs = await db.select({
    projectId: qaqcReportDeliveryRuns.projectId, kind: qaqcReportDeliveryRuns.kind,
    status: qaqcReportDeliveryRuns.status, payload: qaqcReportDeliveryRuns.payload,
    updatedAt: qaqcReportDeliveryRuns.updatedAt,
  }).from(qaqcReportDeliveryRuns).where(and(...runClauses)).orderBy(desc(qaqcReportDeliveryRuns.updatedAt)).limit(100);
  res.json({
    scheduledJobs: [
      { kind: "monthly_approved_report_distribution", cadence: "monthly", enabled: distribution.some((item) => item.configured) },
      { kind: "daily_approved_snapshot_distribution", cadence: "fortnightly", enabled: distribution.some((item) => item.configured) },
      { kind: "submission_and_metric_escalations", cadence: "daily", enabled: true },
    ],
    projects: distribution,
    recentRuns: runs,
  });
}));

export default router;
