import { and, eq, isNull } from "drizzle-orm";
import { auditPlans, projects } from "@workspace/db";

type Db = Pick<typeof import("@workspace/db").db, "select">;

export function auditOverviewProjectQuery(database: Db, organizationId: string, projectId: string) {
  return database.select({ name: projects.name }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, organizationId), isNull(projects.deletedAt),
  )).limit(1);
}

export function auditOverviewPlanQuery(database: Db, organizationId: string, planId: string) {
  return database.select({ status: auditPlans.status }).from(auditPlans).where(and(
    eq(auditPlans.id, planId), eq(auditPlans.organizationId, organizationId), isNull(auditPlans.deletedAt),
  )).limit(1);
}

// This context inherits the audit's authorization. Do not require independent
// Project-list or Plan-view grants just to label an already-authorized audit.
export async function auditOverviewContext(
  database: Db,
  organizationId: string,
  audit: { projectId: string | null; auditPlanId: string | null },
  readPlanNumber: (plan: { status: string | null }) => string | null | undefined,
) {
  const [[project], [plan]] = await Promise.all([
    audit.projectId ? auditOverviewProjectQuery(database, organizationId, audit.projectId) : Promise.resolve([]),
    audit.auditPlanId ? auditOverviewPlanQuery(database, organizationId, audit.auditPlanId) : Promise.resolve([]),
  ]);
  const number = plan ? readPlanNumber(plan) : null;
  return {
    projectName: project?.name ?? null,
    planAvailable: Boolean(plan),
    planNumber: typeof number === "string" && number.trim() ? number : null,
  };
}
