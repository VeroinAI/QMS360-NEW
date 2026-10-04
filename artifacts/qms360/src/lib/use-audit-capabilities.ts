import { useGetAuditCapabilities, getGetAuditCapabilitiesQueryKey } from "@workspace/api-client-react";
import { auditModuleReadMatches, auditModulePermissionMatches } from "@workspace/field-controls";

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
  const canOpen = (path: string) => {
    const module = auditModuleForPath(path);
    return module === "my-actions" ? ["schedules", "plans", "audits", "cars"].some(canRead) : canRead(module);
  };
  return { canRead, canOpen, canExport, administrator, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}