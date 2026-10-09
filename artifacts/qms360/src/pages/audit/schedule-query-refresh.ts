import type { QueryClient } from "@tanstack/react-query";
import { getGetAuditProgrammeQueryKey } from "@workspace/api-client-react";

/** Child changes also affect the parent's server-owned submission eligibility. */
export async function refreshAuditScheduleQueries(client: QueryClient, parentId?: string | null): Promise<void> {
  const refreshes = [
    client.invalidateQueries({ queryKey: ["/api/audit/schedules"] }),
    client.invalidateQueries({ queryKey: ["/api/audit/programmes"] }),
  ];
  // A list URL is not a query-key prefix for a detail URL in the same string.
  if (parentId && parentId !== "legacy") {
    refreshes.push(client.invalidateQueries({ queryKey: getGetAuditProgrammeQueryKey(parentId), exact: true }));
  }
  await Promise.all(refreshes);
}
