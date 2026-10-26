import type { Request } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditFindings, auditPlans, auditSchedules, audits, correctiveActionReports, db, lessonLearnedForms,
  organizationSettings, auditEscalationInstances } from "@workspace/db";
import { getAuthorizedFullProjectScope, getAuthorizedProjectScope } from "../middlewares/rbac";
import { businessDaysElapsed } from "./escalation";
import { actionableFinding, carJson } from "./car-register";
import { carDueDate } from "./car-dates";
type Bag = Record<string, any>;
const normalized = (value: unknown) => String(value ?? "").toLowerCase().replace(/[_-]/g, " ");

/** A QA/QC administrator is not automatically an administrator in other apps. */
export function dashboardCrossRequest(req: Request) {
  return Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
    permissionAdminBypass: false, permissionProjectScope: undefined, permissionFullProjectScope: undefined,
  }) as Request;
}
export async function loadDashboardCrossModules(req: Request, projectIds: string[], today: string) {
  const organizationId = req.currentUser!.organizationId, userId = req.currentUser!.id;
  const crossReq = dashboardCrossRequest(req), warnings: string[] = [], records: Bag[] = [];
  const base = (table: any) => and(eq(table.organizationId, organizationId), isNull(table.deletedAt));
  const scope = async (app: "lessons" | "audit", module: string) => {
    const target = { module, action: "select" as const };
    const [scope, full] = await Promise.all([
      getAuthorizedProjectScope(crossReq, app, target), getAuthorizedFullProjectScope(crossReq, app, target),
    ]);
    return { ids: projectIds.filter(id => scope.unrestricted || scope.projectIds.includes(id)),
      full: (id: string) => full.unrestricted || full.projectIds.includes(id) };
  };
  const [lessonScope, scheduleScope, auditScope, findingScope, carScope] = await Promise.all([
    scope("lessons", "lessons"), scope("audit", "schedules"), scope("audit", "audits"),
    scope("audit", "findings"), scope("audit", "cars"),
  ]);
  const [setting] = await db.select({ workingCalendar: organizationSettings.workingCalendar, timezone: organizationSettings.timezone })
    .from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)).limit(1);
  const rawLessons = lessonScope.ids.length ? await db.select().from(lessonLearnedForms).where(and(
    base(lessonLearnedForms), inArray(lessonLearnedForms.projectId, lessonScope.ids),
    inArray(lessonLearnedForms.workflowState, ["approved", "submitted"]),
  )) : [];
  const lessons = rawLessons.filter(row => lessonScope.full(row.projectId!) || row.creatorId === userId || row.approverId === userId)
    .map(row => {
      const waiting = row.submittedAt ? businessDaysElapsed(row.submittedAt, new Date(`${today}T23:59:59Z`),
        setting?.workingCalendar ?? { workingDays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"], holidays: [] },
        setting?.timezone ?? "Asia/Riyadh") : 0;
      const level = waiting >= 8 ? "L2" : waiting >= 5 ? "L1" : waiting >= 2 ? "P1" : null;
      records.push({ id: row.id, projectId: row.projectId, type: "lesson", period: row.capturedAt.toISOString().slice(0, 7),
        title: row.title, href: `/lessons/${row.id}`, state: row.workflowState,
        category: row.issueCategory, impact: row.impact });
      return { projectId: row.projectId, period: row.capturedAt.toISOString().slice(0, 7),
        state: row.workflowState, severity: row.issueCategory, impact: row.impact, repeated: row.isRepeated, level };
    });
  const auditProjectIds = projectIds.filter(id => scheduleScope.ids.includes(id) && auditScope.ids.includes(id)
    && findingScope.ids.includes(id) && carScope.ids.includes(id));
  if (lessonScope.ids.length !== projectIds.length) warnings.push("Lessons Learned includes only projects for which you have Lessons access.");
  if (auditProjectIds.length !== projectIds.length) warnings.push("Audit figures require Schedule, Audit Execution, Findings and CAR viewing access; other projects are excluded.");
  const schedules = auditProjectIds.length ? (await db.select().from(auditSchedules).where(and(base(auditSchedules),
    inArray(auditSchedules.projectId, auditProjectIds)))).filter(row => {
      const meta = carJson(row.status);
      return !meta.programme && row.workflowState === "approved"
        && (scheduleScope.full(row.projectId!) || row.ownerId === userId || meta.teamLeadIds?.includes(userId));
    }) : [];
  const scheduleIds = schedules.map(row => row.id);
  const plans = scheduleIds.length ? await db.select().from(auditPlans).where(and(base(auditPlans), inArray(auditPlans.auditScheduleId, scheduleIds))) : [];
  const executions = plans.length ? (await db.select().from(audits).where(and(base(audits), inArray(audits.auditPlanId, plans.map(row => row.id)))))
    .filter(row => auditScope.full(row.projectId!) || plans.find(plan => plan.id === row.auditPlanId)?.teamMemberIds.includes(userId)
      || schedules.find(schedule => schedule.id === plans.find(plan => plan.id === row.auditPlanId)?.auditScheduleId)?.ownerId === userId) : [];
  const findings = executions.length ? await db.select().from(auditFindings).where(and(base(auditFindings), inArray(auditFindings.auditId, executions.map(row => row.id)))) : [];
  const cars = findings.length ? (await db.select().from(correctiveActionReports).where(and(base(correctiveActionReports),
    inArray(correctiveActionReports.auditFindingId, findings.map(row => row.id))))).filter(car => {
      const execution = executions.find(row => row.id === findings.find(finding => finding.id === car.auditFindingId)?.auditId);
      return execution && (carScope.full(execution.projectId!) || car.ownerId === userId);
    }) : [];
  const escalationRows = cars.length ? await db.select({ recordId: auditEscalationInstances.recordId, level: auditEscalationInstances.currentLevel })
    .from(auditEscalationInstances).where(and(base(auditEscalationInstances), eq(auditEscalationInstances.status, "open"),
      inArray(auditEscalationInstances.recordId, cars.map(row => row.id)))) : [];
  const auditRows = schedules.map(schedule => {
    const meta = carJson(schedule.status), plan = plans.find(row => row.auditScheduleId === schedule.id);
    const execution = executions.find(row => row.auditPlanId === plan?.id);
    const linked = findings.filter(row => row.auditId === execution?.id);
    const localCars = cars.filter(car => linked.some(row => row.id === car.auditFindingId));
    // Checklist-backed findings and older standalone findings coexist. Count each once.
    const checklist: Bag[] = Array.isArray(execution?.checklistState) ? execution.checklistState as Bag[] : [];
    const entries = [...checklist.filter(actionableFinding).map(item => ({
      id: linked.find(row => (row.evidence as Bag)?.sourceChecklistItemId === item.id)?.id,
      classification: item.auditFinding, item,
    })), ...linked.filter(row => !(row.evidence as Bag)?.sourceChecklistItemId).map(row => ({
      id: row.id, classification: row.classification, item: {} as Bag,
    }))];
    const isClosed = (car: Bag | undefined) => !!car && ["closed", "completed"].includes(normalized(car.workflowState));
    const open = entries.filter(entry => !isClosed(localCars.find(car => car.auditFindingId === entry.id)));
    const major = open.filter(entry => normalized(entry.classification) === "major nc").length;
    const minor = open.filter(entry => normalized(entry.classification) === "minor nc").length;
    const overdue = localCars.filter(car => {
      if (isClosed(car)) return false;
      const finding = linked.find(row => row.id === car.auditFindingId);
      const item = entries.find(row => row.id === finding?.id)?.item;
      const due = car.extensionStatus === "approved" && car.extensionDueDate ? car.extensionDueDate
        : carDueDate(item?.auditFinding ?? finding?.classification, item?.findingDate) ?? car.dueDate;
      return due && due < today;
    });
    if (execution) records.push({ id: execution.id, projectId: schedule.projectId, type: "audit",
      period: String(meta.fromDate ?? meta.plannedStartDate ?? "").slice(0, 7), title: carJson(execution.status).title || execution.referenceNumber,
      state: execution.workflowState, href: `/audit/audits/${execution.id}` });
    else records.push({ id: schedule.id, projectId: schedule.projectId, type: "audit_schedule",
      period: String(meta.fromDate ?? meta.plannedStartDate ?? "").slice(0, 7),
      title: schedule.title, state: schedule.workflowState, href: `/audit/schedules/${schedule.id}` });
    for (const car of localCars) records.push({ id: car.id, projectId: schedule.projectId, type: "car",
      period: String(meta.fromDate ?? meta.plannedStartDate ?? "").slice(0, 7), title: carJson(car.status).carNumber || "Corrective action",
      state: car.workflowState, href: `/audit/cars/${car.id}` });
    const closing = execution ? carJson(execution.status).closingMeeting : undefined;
    return { projectId: schedule.projectId, period: String(meta.fromDate ?? meta.plannedStartDate ?? plan?.auditDate ?? "").slice(0, 7),
      conducted: !!closing && !!(closing.date || closing.meetingDate || closing.minutes || closing.attendees?.length),
      major, minor, overdue: overdue.length, closedCars: localCars.filter(isClosed).length,
      openCars: localCars.filter(car => !isClosed(car)).length,
      escalated: overdue.filter(car => escalationRows.some(row => row.recordId === car.id && ["L1", "L2"].includes(row.level ?? ""))).length };
  });
  return { lessons, audits: auditRows, records, warnings, availability: {
    lessons: lessonScope.ids.length > 0, audit: auditProjectIds.length > 0,
    lessonsProjectIds: lessonScope.ids, auditProjectIds,
  } };
}
