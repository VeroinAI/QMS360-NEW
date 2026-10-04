import { and, eq, isNull } from "drizzle-orm";
import { db, auditPlans, auditSchedules, audits, users } from "@workspace/db";

export async function emailTemplateContext(database: typeof db, input: {
  organizationId: string; actorId?: string | null; entityId?: string | null;
  record?: Record<string, any>; values?: Record<string, unknown>;
}) {
  const record = input.record ?? {};
  let schedule = record;
  let planId = record.auditPlanId;
  if (record.auditId) {
    const [audit] = await database.select().from(audits).where(and(
      eq(audits.id, record.auditId), eq(audits.organizationId, input.organizationId), isNull(audits.deletedAt),
    )).limit(1);
    planId = audit?.auditPlanId;
  }
  let scheduleId = record.auditScheduleId;
  if (planId) {
    const [plan] = await database.select().from(auditPlans).where(and(
      eq(auditPlans.id, planId), eq(auditPlans.organizationId, input.organizationId), isNull(auditPlans.deletedAt),
    )).limit(1);
    scheduleId = plan?.auditScheduleId;
  }
  if (scheduleId) {
    const [row] = await database.select().from(auditSchedules).where(and(
      eq(auditSchedules.id, scheduleId), eq(auditSchedules.organizationId, input.organizationId), isNull(auditSchedules.deletedAt),
    )).limit(1);
    if (row) schedule = row;
  }
  const metadata = typeof schedule.status === "string" && schedule.status.trim().startsWith("{")
    ? JSON.parse(schedule.status) : schedule.customFields ?? {};
  const nameOf = async (id?: string | null) => {
    if (!id) return undefined;
    const [user] = await database.select({ name: users.fullName }).from(users).where(and(
      eq(users.id, id), eq(users.organizationId, input.organizationId), isNull(users.deletedAt),
    )).limit(1);
    return user?.name;
  };
  const [actorName, creatorName] = await Promise.all([
    nameOf(input.actorId), nameOf(schedule.ownerId ?? metadata.submissionUserId ?? record.createdById),
  ]);
  return {
    system_name: "QMS360", actor_name: actorName, creator_name: creatorName,
    record_reference: record.referenceNumber ?? metadata.submissionReference ?? input.entityId,
    record_name: record.title ?? schedule.title,
    audit_name: schedule.title ?? record.title, audit_schedule_name: schedule.title,
    audit_start_date: metadata.fromDate ?? metadata.plannedStartDate ?? record.auditDate,
    audit_end_date: metadata.toDate ?? metadata.plannedEndDate ?? record.auditDate,
    review_comments: metadata.reviewComments ?? record.reviewComments,
    audit_area: record.auditArea ?? record.area,
    audit_description: record.description, audit_finding: record.finding ?? record.description ?? record.title,
    ...input.values,
  };
}