import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditFindings, auditPlans, audits, correctiveActionReports, db, masterDataGroups, masterDataValues, users } from "@workspace/db";
import { auditExecutionSummaries } from "./audit-execution-summary";
import { mapAuditFindingRegister, registerJson, registerText } from "./audit-finding-register-mapping";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Inputs must be the server's already-authorized audit rows and full-visibility audit IDs. */
export async function auditFindingRegisterRows(organizationId: string, viewerId: string,
  auditRows: (typeof audits.$inferSelect)[], fullAuditIds: Set<string>) {
  if (!auditRows.length) return [];
  const ids = auditRows.map(audit => audit.id);
  const planIds = [...new Set(auditRows.flatMap(audit => audit.auditPlanId ? [audit.auditPlanId] : []))];
  const [summaries, findings, plans, labels] = await Promise.all([
    auditExecutionSummaries(organizationId, auditRows, false),
    db.select().from(auditFindings).where(and(eq(auditFindings.organizationId, organizationId),
      isNull(auditFindings.deletedAt), inArray(auditFindings.auditId, ids))),
    planIds.length ? db.select({ id: auditPlans.id, teamMemberIds: auditPlans.teamMemberIds }).from(auditPlans)
      .where(and(eq(auditPlans.organizationId, organizationId), isNull(auditPlans.deletedAt), inArray(auditPlans.id, planIds))) : [],
    db.select({ group: masterDataGroups.code, id: masterDataValues.id, value: masterDataValues.value, label: masterDataValues.label })
      .from(masterDataValues).innerJoin(masterDataGroups, eq(masterDataGroups.id, masterDataValues.groupId)).where(and(
        eq(masterDataValues.organizationId, organizationId), eq(masterDataGroups.organizationId, organizationId),
        isNull(masterDataGroups.deletedAt), isNull(masterDataValues.deletedAt),
        inArray(masterDataGroups.code, ["Audit Area", "risk_levels", "nc_classifications"]),
      )),
  ]);
  const cars = findings.length ? await db.select({ findingId: correctiveActionReports.auditFindingId, ownerId: correctiveActionReports.ownerId })
    .from(correctiveActionReports).where(and(eq(correctiveActionReports.organizationId, organizationId),
      isNull(correctiveActionReports.deletedAt), inArray(correctiveActionReports.auditFindingId, findings.map(f => f.id)))) : [];
  const personIds = [...new Set([
    ...cars.flatMap(car => car.ownerId ? [car.ownerId] : []),
    ...auditRows.flatMap(audit => Array.isArray(audit.checklistState)
      ? audit.checklistState.flatMap(item => item && typeof item === "object"
        && registerText((item as Record<string, unknown>).actionTakerId)
        ? [String((item as Record<string, unknown>).actionTakerId)] : []) : []),
  ])].filter(uuid);
  const people = personIds.length ? await db.select({ id: users.id, name: users.fullName }).from(users)
    .where(and(eq(users.organizationId, organizationId), inArray(users.id, personIds))) : [];
  const names = new Map(people.map(person => [person.id, person.name]));
  const owners = new Map<string, string[]>();
  for (const car of cars) if (car.ownerId) owners.set(car.findingId, [...(owners.get(car.findingId) ?? []), car.ownerId]);
  const byPlan = new Map(plans.map(plan => [plan.id, plan]));
  return auditRows.flatMap(audit => {
    const summary = summaries.get(audit.id);
    const metadata = registerJson(audit.status);
    return mapAuditFindingRegister(audit.checklistState, findings.filter(f => f.auditId === audit.id), {
      auditExecutionId: audit.id, auditId: summary?.auditId ?? null,
      auditTitle: registerText(metadata.title) ?? audit.referenceNumber,
      projectDepartment: summary?.projectDepartment ?? null,
      auditTeamLeadId: summary?.auditLeadId ?? null, auditTeamLeadName: summary?.auditLeadName ?? null,
      fullVisibility: fullAuditIds.has(audit.id), viewerId,
      teamIds: audit.auditPlanId ? byPlan.get(audit.auditPlanId)?.teamMemberIds ?? [] : [],
      names, owners,
      label: (group, value) => value ? labels.find(label =>
        label.group === group && [label.id, label.value, label.label].includes(value))?.label ?? value : null,
    });
  });
}
