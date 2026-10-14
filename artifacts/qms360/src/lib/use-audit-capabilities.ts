import { useGetAuditCapabilities, getGetAuditCapabilitiesQueryKey } from "@workspace/api-client-react";
import { auditModuleReadMatches, auditModulePermissionMatches, type AuditOperation } from "@workspace/field-controls";

export function auditModuleForPath(path: string) {
  if (path === "/audit" || path === "/audit/") return "dashboard";
  return path.split("/")[2] ?? "dashboard";
}

export function useAuditCapabilities(enabled = true) {
  const query = useGetAuditCapabilities({ query: {
    queryKey: getGetAuditCapabilitiesQueryKey(), enabled, refetchInterval: 30_000,
    refetchOnWindowFocus: true, refetchOnMount: "always",
  } });
  const keys = query.isError ? [] : query.data?.keys ?? [];
  const administrator = !query.isError && query.data?.administrator === true;
  const legacyRead = (key: string, module: string) => ["view_all", "view_own", module,
    `${module}.view_all`, `${module}.view_own`, `${module}_view_all`, `${module}_view_own`].includes(key);
  const canRead = (module: string) => administrator || keys.some(stored => {
    const key = stored.toLowerCase();
    return auditModuleReadMatches(key, module) || legacyRead(key, module);
  });
  const canExport = (module: string) => administrator || keys.some(stored =>
    auditModulePermissionMatches(stored, module, "export") || legacyRead(stored.toLowerCase(), module));
  const can = (module: string, operation: AuditOperation): boolean => {
    if (operation === "view_all" || operation === "view_own_scope") return canRead(module);
    if (operation === "export") return canExport(module);
    return administrator || keys.some(stored => {
      const key = stored.toLowerCase();
      if (auditModulePermissionMatches(key, module, operation)) return true;
      if (key.startsWith("audit.")) return false;
      const legacy = operation === "create_edit" ? ["create_edit", ...(module === "schedules" ? ["data_entry"] : [])]
        : operation === "delete" ? ["create_edit"] : [operation];
      return key === module || legacy.some(action => key === action || key === `${module}.${action}` || key === `${module}_${action}`);
    });
  };
  const canCreateProgramme = can("schedules", "create_edit") && (
    administrator || keys.includes("create_audit_programme") || keys.includes("create_edit") || keys.includes("schedules")
    || keys.includes("schedules.create_edit") || keys.includes("schedules_create_edit") || keys.includes("audit.schedules.create_edit"));
  const canOpen = (path: string) => {
    const module = auditModuleForPath(path);
    return module === "my-actions" ? ["schedules", "plans", "audits", "cars"].some(canRead) : canRead(module);
  };
  return { canRead, canOpen, canExport, can, canCreateProgramme: canCreateProgramme || keys.includes("create_audit_programme"), administrator, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}