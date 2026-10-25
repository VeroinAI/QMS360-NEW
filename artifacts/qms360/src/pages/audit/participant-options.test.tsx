// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getGetAuditPlanOptionsQueryKey, getGetAuditPlanOptionsUrl,
  getGetAuditScheduleActivityOptionsQueryKey, getGetAuditScheduleActivityOptionsUrl } from "@workspace/api-client-react";
import { eligibleParticipantOptions } from "./participant-options";
import { useParticipantConnectivity } from "./use-participant-connectivity";
import { ActivityMultiSelect } from "./activity-role-fields";
import { useParticipantNames } from "./use-participant-names";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Audit participant selection lifecycle", () => {
  it("includes authoritative context in URLs and keys for plans and draft schedules", () => {
    expect(getGetAuditPlanOptionsUrl({ scheduleId: "audit-a" })).toContain("scheduleId=audit-a");
    expect(getGetAuditPlanOptionsQueryKey({ scheduleId: "audit-a" })).not.toEqual(getGetAuditPlanOptionsQueryKey({ scheduleId: "audit-b" }));
    expect(getGetAuditScheduleActivityOptionsQueryKey({ projectId: "a" })).not.toEqual(getGetAuditScheduleActivityOptionsQueryKey({ projectId: "b" }));
    expect(getGetAuditScheduleActivityOptionsQueryKey({ department: "OPS" })).not.toEqual(getGetAuditScheduleActivityOptionsQueryKey({ projectId: "OPS" }));
    expect(getGetAuditScheduleActivityOptionsUrl({ department: "Department A" })).toContain("department=Department+A");
  });
  it("does not accept broad cached users or a late response from the previous source", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["/api/audit/plan-options"], { users: ["broad-user"] });
    let resolveA!: (data: { users: string[] }) => void;
    const a = new Promise<{ users: string[] }>(resolve => { resolveA = resolve; });
    const observer = new QueryObserver(client, { queryKey: getGetAuditPlanOptionsQueryKey({ scheduleId: "a" }), queryFn: () => a });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(observer.getCurrentResult().data).toBeUndefined();
      observer.setOptions({ queryKey: getGetAuditPlanOptionsQueryKey({ scheduleId: "b" }), queryFn: async () => ({ users: ["b"] }) });
      await observer.refetch();
      resolveA({ users: ["a"] }); await a; await Promise.resolve();
      expect(observer.getCurrentResult().data?.users).toEqual(["b"]);
      expect(eligibleParticipantOptions(observer.getCurrentResult().data, false, false)).toEqual([]);
      expect(eligibleParticipantOptions(observer.getCurrentResult().data, true, true)).toEqual([]);
      expect(eligibleParticipantOptions(undefined, true, false)).toEqual([]);
    } finally { unsubscribe(); client.clear(); }
  });
  it("responds to disconnection immediately, even if matching query data remains cached", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result } = renderHook(() => useParticipantConnectivity());
    expect(result.current).toBe(true);
    act(() => { online.mockReturnValue(false); window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe(false);
    expect(eligibleParticipantOptions({ users: ["a"] }, result.current, false)).toEqual([]);
    act(() => { online.mockReturnValue(true); window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe(true);
  });
  it("shows historical names without making them available options or dropping retained IDs", () => {
    const change = vi.fn();
    render(<ActivityMultiSelect label="Activity people" options={[{ id: "a", name: "Eligible A" }]}
      historicalOptions={[{ id: "b", name: "Historical B" }]} value={["b"]} onChange={change}/>);
    expect(screen.getByRole("button").textContent).toContain("Historical B");
    expect(change).not.toHaveBeenCalled();
  });
  it("retains display names across source changes and disconnects without retaining eligibility", () => {
    const { result, rerender } = renderHook(({ people }) => useParticipantNames(people), {
      initialProps: { people: [{ id: "a", fullName: "Project A user" }] },
    });
    rerender({ people: [{ id: "b", fullName: "Project B user" }] });
    expect(result.current("a")).toBe("Project A user");
    expect(result.current("b")).toBe("Project B user");
    expect(eligibleParticipantOptions({ users: [{ id: "b" }] }, true, false)).toEqual([{ id: "b" }]);
    rerender({ people: [] });
    expect(result.current("a")).toBe("Project A user");
    expect(result.current("missing")).toBeUndefined();
  });
});
