export type QaqcOperation = "view_own_scope" | "view_all" | "create_edit" | "delete" | "submit" | "approve_reject" | "import" | "export" | "ai" | "configure_masters" | "manage_ai_settings" | "delegate" | "manage_roles" | "manage_access" | "view_audit_log";
const read = ["view_own_scope", "view_all"] as const;
const edit = [...read, "create_edit", "delete"] as const;
const reports = [...edit, "submit", "approve_reject", "import", "export"] as const;
export const qaqcActivityGroups = [
  { module: "metrics", label: "QA/QC metrics", actions: [...reports, "ai"] },
  { module: "material_inspections", label: "Material inspections", actions: [...edit] },
  { module: "qtbt", label: "Quality toolbox talks (QTBT)", actions: [...edit] },
  { module: "customer_satisfaction", label: "Customer satisfaction entries", actions: [...edit] },
  { module: "document_governance", label: "Document governance log", actions: [...edit, "export"] },
  { module: "quality_briefs", label: "Quality briefs", actions: [...read, "create_edit", "submit", "approve_reject", "ai"] },
  { module: "monthly_reports", label: "Monthly reports & metric details", actions: [...reports, "ai"] },
  { module: "daily_reports", label: "Daily submissions", actions: [...reports] },
  { module: "csat_reports", label: "CSAT surveys & reports", actions: [...reports] },
] as const;
export const qaqcOperationLabels: Record<QaqcOperation, string> = {
  view_own_scope: "View own", view_all: "View all", create_edit: "Create / edit", delete: "Delete",
  submit: "Submit", approve_reject: "Approve / reject", import: "Import Excel", export: "Export PDF / Excel",
  ai: "Use VerionAI", configure_masters: "Configure QA/QC settings, fields & rules",
  manage_ai_settings: "Configure VerionAI", delegate: "Manage delegations",
  manage_roles: "Manage roles & user assignments", manage_access: "Approve application access", view_audit_log: "View audit log",
};
export const qaqcAdministrativePermissions = ["configure_masters", "manage_ai_settings", "delegate", "manage_roles", "manage_access", "view_audit_log"] as const;
export const qaqcGlobalPermissions = ["data_entry", "submit", "approve_reject", "view_own_scope", "view_all", "export"] as const;
export const qaqcActivityPermissions = qaqcActivityGroups.flatMap(group => group.actions.map(action => ({
  key: `qaqc.${group.module}.${action}`, name: `${group.label}: ${qaqcOperationLabels[action]}`,
})));
export const qaqcPermissionCatalog = [
  ...qaqcActivityPermissions,
  ...qaqcAdministrativePermissions.map(action => ({ key: `qaqc.${action}`, name: qaqcOperationLabels[action] })),
  ...qaqcGlobalPermissions.map(key => ({ key, name: key === "data_entry" ? "Create / edit (all activities)" : `${qaqcOperationLabels[key]} (all activities)` })),
];
const legacyModule: Record<string, string> = { monthly_reports: "metrics", daily_reports: "document_governance", csat_reports: "customer_satisfaction" };
export function qaqcPermissionMatches(key: string, module: string, operation: QaqcOperation): boolean {
  const normalized = key.toLowerCase();
  if (normalized === `qaqc.${module}.${operation}` || normalized === `qaqc.${operation}`) return true;
  const primitives = operation === "create_edit" ? ["create_edit", "data_entry"]
    : operation === "view_own_scope" ? ["view_own", "view_own_scope"]
    : operation === "ai" ? ["ai", "manage_ai_settings"] : [operation];
  // Namespaced activity grants are precise. Older unprefixed module grants
  // retain the reporting access they had before the activity editor existed.
  const oldModule = legacyModule[module] ?? module;
  return primitives.some(p => normalized === p || normalized === `${module}.${p}` || normalized === `${module}_${p}`
    || normalized === `${oldModule}.${p}` || normalized === `${oldModule}_${p}`)
    || (["view_own_scope", "view_all", "create_edit", "submit", "approve_reject"].includes(operation)
      && (normalized === module || normalized === oldModule));
}