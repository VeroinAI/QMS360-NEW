import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { auditFindings, auditPlans, auditSchedules, audits, correctiveActionReports, db, projects, users,
  auditUserWorkspaceRoles, auditWorkspaceRoles, auditWorkspaceRolePermissions, auditPermissions } from "@workspace/db";
import { getAuthorizedProjectScope, getAuthorizedFullProjectScope } from "../middlewares/rbac";
import { HttpError } from "./workspace";

export const carJson = (value: string | null | undefined): any => {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};
export const actionableFinding = (item: any) => {
  const classification = item.auditFinding || item.result;
  return typeof classification === "string" && !!classification.trim() && classification.trim().toLowerCase() !== "not applicable";
};
const active = (table: any, organizationId: string) => and(eq(table.organizationId, organizationId), isNull(table.deletedAt));
const writableProject = (scope: { unrestricted: boolean; projectIds: string[] }, projectId: string | null, process: boolean) =>
  scope.unrestricted || (projectId ? scope.projectIds.includes(projectId) : process && scope.projectIds.length > 0);

export async function carLeadMarker(organizationId: string, userId: string) {
  const rows = await db.select({ id: auditUserWorkspaceRoles.id }).from(auditUserWorkspaceRoles)
    .innerJoin(auditWorkspaceRoles, eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId))
    .innerJoin(auditWorkspaceRolePermissions, eq(auditWorkspaceRolePermissions.workspaceRoleId, auditWorkspaceRoles.id))
    .innerJoin(auditPermissions, eq(auditPermissions.id, auditWorkspaceRolePermissions.permissionId))
    .where(and(active(auditUserWorkspaceRoles, organizationId), eq(auditUserWorkspaceRoles.userId, userId),
      eq(auditUserWorkspaceRoles.status, "active"), active(auditWorkspaceRoles, organizationId),
      eq(auditWorkspaceRoles.status, "active"), active(auditWorkspaceRolePermissions, organizationId),
      active(auditPermissions, organizationId), eq(auditPermissions.key, "audit_team_lead"),
      eq(auditWorkspaceRolePermissions.grant, "full")));
  return rows.length > 0;
}

export async function carAuditContext(req: Request, audit: typeof audits.$inferSelect) {
  const org = req.currentUser!.organizationId;
  const [plan] = audit.auditPlanId ? await db.select().from(auditPlans).where(and(active(auditPlans, org), eq(auditPlans.id, audit.auditPlanId))) : [];
  const [schedule] = plan?.auditScheduleId ? await db.select().from(auditSchedules).where(and(active(auditSchedules, org), eq(auditSchedules.id, plan.auditScheduleId))) : [];
  const planMeta = carJson(plan?.status);
  const scheduleMeta = carJson(schedule?.status);
  const scope = await getAuthorizedProjectScope(req, "audit");
  const process = scheduleMeta.auditTypes?.includes("Quality Internal Process Audit");
  if (!scope.unrestricted && !(audit.projectId && scope.projectIds.includes(audit.projectId))
    && !(process && !audit.projectId && scope.projectIds.length)) throw new HttpError(403, "This audit is outside your CAR project scope");
  return { audit, plan, schedule, planMeta, scheduleMeta, leadId: planMeta.leadAuditorId as string | undefined };
}

export async function carContext(req: Request, carId: string, allowInactiveSource = false) {
  const org = req.currentUser!.organizationId;
  const [car] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, org), eq(correctiveActionReports.id, carId)));
  if (!car) throw new HttpError(404, "CAR not found");
  const [finding] = await db.select().from(auditFindings).where(and(active(auditFindings, org), eq(auditFindings.id, car.auditFindingId)));
  const [audit] = finding ? await db.select().from(audits).where(and(active(audits, org), eq(audits.id, finding.auditId))) : [];
  if (!audit || !finding) throw new HttpError(404, "Linked finding or audit is unavailable");
  const context = await carAuditContext(req, audit);
  const sourceId = carJson(car.effectivenessNotes).sourceChecklistItemId || (finding.evidence as any)?.sourceChecklistItemId;
  const item = sourceId && Array.isArray(audit.checklistState) ? audit.checklistState.find((row: any) => row.id === sourceId) as any : null;
  const inactiveSource = !!sourceId && (!item || !actionableFinding(item));
  if (inactiveSource && !allowInactiveSource) throw new HttpError(409, "The source finding is no longer active in this audit");
  const ownerId = item?.actionTakerId || car.ownerId;
  const fullScope = await getAuthorizedFullProjectScope(req, "audit");
  if (!fullScope.unrestricted && !(audit.projectId && fullScope.projectIds.includes(audit.projectId))
    && ownerId !== req.currentUser!.id && context.leadId !== req.currentUser!.id
    && !context.plan?.teamMemberIds.includes(req.currentUser!.id)) {
    throw new HttpError(403, "This CAR is outside your own-record scope");
  }
  const canRespond = !inactiveSource && ownerId === req.currentUser!.id;
  const writeScope = await getAuthorizedProjectScope(req, "audit", { module: "cars", action: "full" });
  const canEditResponse = canRespond && writableProject(writeScope, audit.projectId, Boolean(context.scheduleMeta.auditTypes?.includes("Quality Internal Process Audit")));
  const canReview = !inactiveSource && context.leadId === req.currentUser!.id && await carLeadMarker(org, req.currentUser!.id);
  return { ...context, car, finding, item, ownerId, canRespond, canEditResponse, canReview };
}

/** Read-only projection: merely opening the register must never create CARs. */
export async function carRegister(req: Request, dto: (row: any) => any) {
  const org = req.currentUser!.organizationId, userId = req.currentUser!.id;
  const [auditRows, planRows, scheduleRows, findings, cars, people, projectRows, fullScope, leadMarker] = await Promise.all([
    db.select().from(audits).where(active(audits, org)),
    db.select().from(auditPlans).where(active(auditPlans, org)),
    db.select().from(auditSchedules).where(active(auditSchedules, org)),
    db.select().from(auditFindings).where(active(auditFindings, org)),
    db.select().from(correctiveActionReports).where(active(correctiveActionReports, org)),
    db.select({ id: users.id, name: users.fullName }).from(users).where(eq(users.organizationId, org)),
    db.select().from(projects).where(active(projects, org)),
    getAuthorizedFullProjectScope(req, "audit"), carLeadMarker(org, userId),
  ]);
  const scope = await getAuthorizedProjectScope(req, "audit");
  const writeScope = await getAuthorizedProjectScope(req, "audit", { module: "cars", action: "full" });
  const entries: any[] = [];
  for (const audit of auditRows) {
    const plan = planRows.find(row => row.id === audit.auditPlanId);
    const schedule = scheduleRows.find(row => row.id === plan?.auditScheduleId);
    const pm = carJson(plan?.status), sm = carJson(schedule?.status);
    const process = sm.auditTypes?.includes("Quality Internal Process Audit");
    if (!scope.unrestricted && !(audit.projectId && scope.projectIds.includes(audit.projectId)) && !(process && !audit.projectId && scope.projectIds.length)) continue;
    const full = fullScope.unrestricted || !!(audit.projectId && fullScope.projectIds.includes(audit.projectId));
    const auditFindingsRows = findings.filter(f => f.auditId === audit.id);
    const checklist = Array.isArray(audit.checklistState) ? audit.checklistState.filter(actionableFinding) as any[] : [];
    const sourceRows = checklist.map(item => ({ item, legacy: false,
      finding: auditFindingsRows.find(f => (f.evidence as any)?.sourceChecklistItemId === item.id) }));
    if (String(req.query.includeLegacy) === "true") sourceRows.push(...auditFindingsRows
      .filter(f => f.classification?.trim().toLowerCase() !== "not applicable")
      .filter(f => !(f.evidence as any)?.sourceChecklistItemId || !checklist.some(item => item.id === (f.evidence as any)?.sourceChecklistItemId))
      .map(f => ({ item: { id: f.id, description: f.description, auditFinding: f.classification }, legacy: true, finding: f })));
    for (const source of sourceRows) {
      const associated = source.finding ? cars.filter(c => c.auditFindingId === source.finding!.id) : [];
      for (const car of associated.length ? associated : [undefined]) {
        const item = source.item;
        const ownerId = item.actionTakerId || car?.ownerId;
        if (!full && ownerId !== userId && pm.leadAuditorId !== userId && !plan?.teamMemberIds.includes(userId)) continue;
        const projectName = projectRows.find(p => p.id === audit.projectId)?.name || sm.departmentProject || "Department-based audit";
        const inactiveSource = source.legacy && !!(source.finding?.evidence as any)?.sourceChecklistItemId;
        const canRespond = !inactiveSource && ownerId === userId
          && writableProject(writeScope, audit.projectId, Boolean(process));
        const canReview = !inactiveSource && pm.leadAuditorId === userId && leadMarker;
        const response = car ? { ...dto(car), canRespond, canReview } : undefined;
        entries.push({ id: car?.id || `${audit.id}:${item.id}`, auditId: audit.id, itemId: item.id,
          auditTitle: carJson(audit.status).title || audit.referenceNumber, scheduleId: schedule?.id || null,
          auditTypes: Array.isArray(sm.auditTypes) ? sm.auditTypes.filter((type: unknown) => typeof type === "string" && type.trim()) : [],
          department: process && !audit.projectId ? sm.departmentProject || null : null,
          scheduleName: schedule?.title || "No linked schedule", projectId: audit.projectId,
          projectName, clause: item.clause || "", auditArea: item.auditArea || source.finding?.responsibleDepartment || "",
          description: item.description || item.question || "", classification: item.auditFinding || item.result || "",
          actionTakerName: people.find(p => p.id === ownerId)?.name || "Not assigned",
          evidenceIds: item.evidenceIds || [], status: response?.status || "Open", canRespond, canReview,
          legacy: source.legacy, ...(response ? { car: response } : {}) });
      }
    }
  }
  const filtered = entries.filter(entry => (!req.query.projectId || entry.projectId === req.query.projectId)
    && (!req.query.scheduleId || entry.scheduleId === req.query.scheduleId)
    && (!req.query.auditTitle || entry.auditTitle === req.query.auditTitle)
    && (!req.query.auditType || entry.auditTypes.includes(req.query.auditType))
    && (!req.query.department || entry.department === req.query.department)
    && (!req.query.status || entry.status === req.query.status));
  // Options are scoped to authorized findings, not the current page or other filters.
  const options = (rows: any[], id: (row: any) => string | null, name: (row: any) => string) =>
    [...new Map(rows.filter(row => id(row)).map(row => [id(row)!, name(row)])).entries()]
      .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const typeEntries = entries.filter(entry => !req.query.auditType || entry.auditTypes.includes(req.query.auditType));
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  return { items: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit,
    projects: options(typeEntries, row => row.projectId, row => row.projectName),
    schedules: options(entries, row => row.scheduleId, row => row.scheduleName),
    auditTitles: options(entries, row => row.auditTitle, row => row.auditTitle),
    auditTypes: options(entries.flatMap(entry => entry.auditTypes.map((type: string) => ({ type }))), row => row.type, row => row.type),
    departments: options(typeEntries, row => row.department, row => row.department) };
}
