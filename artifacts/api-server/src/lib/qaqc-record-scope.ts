import type { Request } from "express";
import { eq, getTableName, inArray, or, sql } from "drizzle-orm";
import { auditLogEntries } from "@workspace/db";
import type { QaqcOperation } from "@workspace/field-controls";
import { getAuthorizedFullProjectScope, getAuthorizedProjectScope, type EffectiveProjectScope } from "../middlewares/rbac";
const entities: Record<string, string> = { qaqc_metric_entries: "metric", material_inspection_entries: "material_inspection",
  qtbt_entries: "qtbt", customer_satisfaction_entries: "customer_satisfaction",
  document_governance_log_entries: "document_governance", quality_assessment_briefs: "quality_brief" };
export function qaqcOwnedRecordClause(req: Request, table: any) {
  const entity = entities[getTableName(table)];
  const creator = table.createdById ? eq(table.createdById, req.currentUser!.id) : entity
    ? sql`exists (select 1 from ${auditLogEntries} where ${auditLogEntries.organizationId} = ${req.currentUser!.organizationId}
        and ${auditLogEntries.entityType} = ${entity} and ${auditLogEntries.entityId}::text = ${table.id}::text
        and ${auditLogEntries.action} in ('create', 'import_create') and ${auditLogEntries.actorId} = ${req.currentUser!.id})` : undefined;
  return or(creator, table.submittedById ? eq(table.submittedById, req.currentUser!.id) : undefined,
    table.approverId ? eq(table.approverId, req.currentUser!.id) : undefined);
}
export async function qaqcRecordReadClauses(req: Request, table: any, module: string, operation?: QaqcOperation) {
  let [scope, full] = await Promise.all([
    getAuthorizedProjectScope(req, "qaqc", { module, action: "select" }),
    getAuthorizedFullProjectScope(req, "qaqc", { module, action: "select" }),
  ]);
  if (operation) {
    const [opScope, opFull] = await Promise.all([
      getAuthorizedProjectScope(req, "qaqc", { module, action: "select", operation }),
      getAuthorizedFullProjectScope(req, "qaqc", { module, action: "select", operation }),
    ]);
    const intersect = (a: EffectiveProjectScope, b: EffectiveProjectScope) => a.unrestricted ? b : b.unrestricted ? a
      : { unrestricted: false, projectIds: a.projectIds.filter(id => b.projectIds.includes(id)) };
    scope = intersect(scope, opScope); full = intersect(full, opFull);
  }
  return [
    scope.unrestricted ? undefined : inArray(table.projectId, scope.projectIds),
    full.unrestricted ? undefined : or(
      full.projectIds.length ? inArray(table.projectId, full.projectIds) : undefined,
      qaqcOwnedRecordClause(req, table),
    ),
  ];
}