import type { AuditActivityRoleAssignment, AuditPlanActivity } from "@workspace/api-client-react";

export function activityRoleDefaults(metadata: Record<string, unknown> | undefined): string[] {
  const roles = metadata?.assignedRoles;
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.flatMap(role => role && role.application === "audit" && typeof role.roleId === "string" ? [role.roleId] : []))];
}
export function activityAuditeeDefaults(roleIds: string[], assignments: AuditActivityRoleAssignment[] = []): string[] {
  return [...new Set(assignments.filter(item => roleIds.includes(item.roleId)).flatMap(item => item.userIds))];
}
export const activityAuditeeIds = (row: AuditPlanActivity): string[] => row.auditeeIds ?? (row.auditeeId ? [row.auditeeId] : []);
export function withActivityAuditees(row: AuditPlanActivity, auditeeIds: string[]): AuditPlanActivity {
  return { ...row, auditeeIds, auditeeId: auditeeIds[0] ?? "" };
}