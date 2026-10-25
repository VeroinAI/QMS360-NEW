export type AuditOperation = "view_own_scope" | "view_all" | "create_edit" | "delete" | "submit" | "approve_reject" | "export";
const read = ["view_all"] as const;
export const auditModuleGroups = [
  { module: "dashboard", label: "Dashboard", actions: read },
  { module: "schedules", label: "Schedules / Programme", actions: [...read, "create_edit", "delete", "submit", "approve_reject", "export"] },
  { module: "plans", label: "Audit Plans", actions: [...read, "create_edit", "delete", "submit", "export"] },
  { module: "audits", label: "Audits / Execution", actions: [...read, "create_edit", "delete", "approve_reject", "export"] },
  { module: "findings", label: "Audit Findings", actions: [...read, "create_edit", "delete", "export"] },
  { module: "cars", label: "QAR / CAR register", actions: [...read, "create_edit", "submit", "approve_reject", "export"] },
  { module: "reports", label: "Reports", actions: [...read, "export"] },
] as const;
export const auditOperationLabels: Record<AuditOperation, string> = {
  view_own_scope: "View own", view_all: "View (assigned scope)", create_edit: "Create / edit",
  delete: "Delete", submit: "Submit / send", approve_reject: "Approve / reject", export: "Export PDF / Excel",
};
export const auditModulePermissionCatalog = auditModuleGroups.flatMap(group => group.actions.map(action => ({
  key: `audit.${group.module}.${action}`, name: `${group.label}: ${auditOperationLabels[action]}`,
})));
/** Precise module grants are additive to existing grants; never interpret markers as actions. */
export function auditModulePermissionMatches(key: string, module: string, operation: AuditOperation): boolean {
  return key.toLowerCase() === `audit.${module.toLowerCase()}.${operation}`;
}
export function auditModuleReadMatches(key: string, module: string): boolean {
  return auditModulePermissionMatches(key, module, "view_all") || auditModulePermissionMatches(key, module, "view_own_scope");
}

export const auditApprovalModuleOptions = [
  { key: "audit.schedules.approve_reject", label: "Schedules / Programme" },
  { key: "audit.audits.approve_reject", label: "Audit Reports" },
] as const;
/** Explicit module selection overrides the old schedule-only global approval grant. */
export function auditScheduleApprovalPermission(keys: string[]): boolean {
  if (keys.some(key => ["schedules", "schedules.approve_reject", "audit.schedules.approve_reject"].includes(key))) return true;
  return keys.includes("approve_reject") && !keys.includes("audit.audits.approve_reject");
}