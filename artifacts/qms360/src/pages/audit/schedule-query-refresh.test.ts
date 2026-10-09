import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getGetAuditProgrammeQueryKey } from "@workspace/api-client-react";
import { refreshAuditScheduleQueries } from "./schedule-query-refresh";

describe("schedule mutation query refresh", () => {
  it("refreshes active parent eligibility after the first child is added and the last is deleted", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = getGetAuditProgrammeQueryKey("draft-parent");
    let childCount = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => ({ workflowState: "Draft", canSubmit: true, childCount }),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await observer.refetch();
      expect(observer.getCurrentResult().data?.childCount).toBe(0);
      childCount = 1;
      await refreshAuditScheduleQueries(client, "draft-parent");
      expect(observer.getCurrentResult().data).toEqual({ workflowState: "Draft", canSubmit: true, childCount: 1 });
      childCount = 0;
      await refreshAuditScheduleQueries(client, "draft-parent");
      expect(observer.getCurrentResult().data?.childCount).toBe(0);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it("invalidates child and programme lists plus only the affected programme detail", async () => {
    const client = new QueryClient();
    const keys = [
      ["/api/audit/schedules", { parentId: "parent", page: 1 }],
      ["/api/audit/programmes", { page: 1 }],
      getGetAuditProgrammeQueryKey("parent"),
      getGetAuditProgrammeQueryKey("unrelated"),
    ];
    keys.forEach(key => client.setQueryData(key, {}));
    await refreshAuditScheduleQueries(client, "parent");
    expect(keys.map(key => client.getQueryState(key)?.isInvalidated)).toEqual([true, true, true, false]);
    client.clear();
  });

  it.each(["Submitted", "Approved", "Sent Back"])("retains server-owned %s status and permissions", async workflowState => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const observer = new QueryObserver(client, {
      queryKey: getGetAuditProgrammeQueryKey("parent"),
      queryFn: async () => ({ workflowState, childCount: 1, canSubmit: workflowState === "Sent Back", canReview: workflowState === "Submitted" }),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await observer.refetch();
      const before = observer.getCurrentResult().data;
      await refreshAuditScheduleQueries(client, "parent");
      expect(observer.getCurrentResult().data).toEqual(before);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it.each([undefined, null, "", "legacy"])("does not request a parent detail for %s", async parentId => {
    const client = new QueryClient();
    const key = getGetAuditProgrammeQueryKey(String(parentId));
    client.setQueryData(key, {});
    await refreshAuditScheduleQueries(client, parentId);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });
});
