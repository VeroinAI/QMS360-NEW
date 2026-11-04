import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditFindings, auditPlans, auditSchedules, audits, correctiveActionReports, db, masterDataGroups, masterDataValues, projects, users } from "@workspace/db";
import { auditExecutionFindingCounts } from "./audit-execution-finding-counts";

const json = (value: string | null | undefined): Record<string, unknown> => {
  try { const result = JSON.parse(value || "{}"); return result && typeof result === "object" && !Array.isArray(result) ? result : {}; }
  catch { return {}; }
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())) : [];
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
type AuditRow = Pick<typeof audits.$inferSelect, "id" | "auditPlanId" | "projectId" | "checklistState">;

/** Enrich only the already-authorized page; bounded, tenant-scoped batches, never per-row API calls. */
export async function auditExecutionSummaries(organizationId: string, rows: AuditRow[], includeFindingCounts = true) {
  if (!rows.length) return new Map();
  const planIds = [...new Set(rows.flatMap(row => row.auditPlanId ? [row.auditPlanId] : []))];
  const [plans, findings, masterRows] = await Promise.all([
    planIds.length ? db.select().from(auditPlans).where(and(
      eq(auditPlans.organizationId, organizationId), isNull(auditPlans.deletedAt), inArray(auditPlans.id, planIds),
    )) : [],
    includeFindingCounts ? db.select().from(auditFindings).where(and(eq(auditFindings.organizationId, organizationId),
      isNull(auditFindings.deletedAt), inArray(auditFindings.auditId, rows.map(row => row.id)))) : [] as (typeof auditFindings.$inferSelect)[],
    db.select({ group: masterDataGroups.code, id: masterDataValues.id, value: masterDataValues.value, label: masterDataValues.label })
      .from(masterDataValues).innerJoin(masterDataGroups, eq(masterDataGroups.id, masterDataValues.groupId)).where(and(
        eq(masterDataValues.organizationId, organizationId), eq(masterDataGroups.organizationId, organizationId),
        isNull(masterDataGroups.deletedAt), isNull(masterDataValues.deletedAt),
        inArray(masterDataGroups.code, ["audit_types", "departments"]),
      )),
  ]);
  const scheduleIds = [...new Set(plans.flatMap(plan => plan.auditScheduleId ? [plan.auditScheduleId] : []))];
  const leadIds = [...new Set(plans.flatMap(plan => text(json(plan.status).leadAuditorId) ? [String(json(plan.status).leadAuditorId)] : []))].filter(uuid);
  const [schedules, leads, cars] = await Promise.all([
    scheduleIds.length ? db.select().from(auditSchedules).where(and(eq(auditSchedules.organizationId, organizationId),
      isNull(auditSchedules.deletedAt), inArray(auditSchedules.id, scheduleIds))) : [],
    leadIds.length ? db.select({ id: users.id, name: users.fullName }).from(users).where(and(
      eq(users.organizationId, organizationId), inArray(users.id, leadIds))) : [],
    findings.length ? db.select({ auditFindingId: correctiveActionReports.auditFindingId, workflowState: correctiveActionReports.workflowState })
      .from(correctiveActionReports).where(and(eq(correctiveActionReports.organizationId, organizationId),
        isNull(correctiveActionReports.deletedAt), inArray(correctiveActionReports.auditFindingId, findings.map(f => f.id)))) : [],
  ]);
  const projectIds = [...new Set(rows.flatMap(row => row.projectId ? [row.projectId] : []))];
  const projectRows = projectIds.length ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(
    eq(projects.organizationId, organizationId), isNull(projects.deletedAt), inArray(projects.id, projectIds.filter(uuid)),
  )) : [];
  const byPlan = new Map(plans.map(plan => [plan.id, plan]));
  const bySchedule = new Map(schedules.map(schedule => [schedule.id, schedule]));
  const byLead = new Map(leads.map(lead => [lead.id, lead.name]));
  const byProject = new Map(projectRows.map(project => [project.id, project.name]));
  const masterLabel = (group: string, value: string) => masterRows.find(row =>
    row.group === group && [row.id, row.value, row.label].includes(value))?.label;
  return new Map(rows.map(row => {
    const plan = row.auditPlanId ? byPlan.get(row.auditPlanId) : undefined;
    const schedule = plan?.auditScheduleId ? bySchedule.get(plan.auditScheduleId) : undefined;
    const pm = json(plan?.status), sm = json(schedule?.status);
    const leadId = text(pm.leadAuditorId);
    // Execution authorization is tied to this project, not every project in a legacy Schedule.
    // In particular, do not expose other project names from a multi-project Schedule.
    const sourceIds = row.projectId ? [row.projectId] : [];
    const projectDepartment = sourceIds.length
      ? [...new Set(sourceIds.map(id => byProject.get(id) ?? "Project unavailable"))].join(", ")
      : text(sm.departmentProject)
        ? masterLabel("departments", String(sm.departmentProject))
          ?? (uuid(String(sm.departmentProject)) ? "Department unavailable" : String(sm.departmentProject))
        : null;
    const ownFindings = findings.filter(finding => finding.auditId === row.id);
    return [row.id, {
      auditId: text(sm.qaqcReference) ?? text(pm.qaqcReference),
      auditTypes: (strings(pm.auditTypes).length ? strings(pm.auditTypes) : strings(sm.auditTypes))
        .map(type => masterLabel("audit_types", type) ?? type),
      projectDepartment,
      auditLeadId: leadId, auditLeadName: leadId ? byLead.get(leadId) ?? null : null,
      ...auditExecutionFindingCounts(row.checklistState, ownFindings, cars),
    }] as const;
  }));
}
