import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditPlan } from "@workspace/api-client-react";
import { listQueuedAuditPlans, queueAuditPlan, syncQueuedAuditPlans } from "./pwa";

// Small asynchronous IndexedDB fixture; the production serialization/replay code is exercised unchanged.
const outbox = new Map<string, unknown>();
const request = (run: () => unknown) => {
  const result: any = {};
  queueMicrotask(() => { result.result = run(); result.onsuccess?.(); });
  return result;
};
const plan = {
  id: "queued-plan", auditTitle: "Dated offline plan", scheduleId: "audit",
  activities: [
    { id: "one", section: "General", remarks: "First", auditeeId: "auditee", plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" },
    { id: "two", section: "Design", remarks: "Second", auditeeId: "auditee", plannedStartDateTime: "2026-01-02T22:00", plannedEndDateTime: "2026-01-02T23:59" },
  ],
} as AuditPlan;

beforeEach(() => {
  outbox.clear();
  const token = `header.${btoa(JSON.stringify({ sub: "user", organizationId: "org" }))}.signature`;
  vi.stubGlobal("localStorage", { getItem: () => token });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("indexedDB", {
    open: () => request(() => ({
      transaction: () => ({ objectStore: () => ({
        put: (value: any) => request(() => { outbox.set(value.id, structuredClone(value)); }),
        getAll: () => request(() => [...outbox.values()].map(value => structuredClone(value))),
        get: (id: string) => request(() => outbox.get(id)),
        delete: (id: string) => request(() => { outbox.delete(id); }),
      }) }),
    })),
  });
});

describe("dated Audit Plan offline synchronization", () => {
  it("retains independent dates across serialization/reopen and replay without a shared timestamp", async () => {
    await queueAuditPlan(plan);
    expect((await listQueuedAuditPlans())[0]?.plan.activities).toEqual(plan.activities);
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await syncQueuedAuditPlans()).toMatchObject({ synced: 1, failed: 0 });
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body)).activities).toEqual(plan.activities);
    expect(await listQueuedAuditPlans()).toEqual([]);
  });
  it("retains stale rejected rows and the recoverable server error, then syncs a corrected plan", async () => {
    await queueAuditPlan(plan);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "Activity 2 Planned End must be within the linked Audit dates.",
    }), { status: 422 })));
    expect(await syncQueuedAuditPlans()).toMatchObject({ synced: 0, failed: 1 });
    const [retained] = await listQueuedAuditPlans();
    expect(retained?.plan.activities).toEqual(plan.activities);
    expect(retained?.lastError).toContain("Activity 2 Planned End");
    const corrected = { ...plan, activities: plan.activities!.map(row => ({ ...row, plannedEndDateTime: row.plannedStartDateTime })) };
    await queueAuditPlan(corrected);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));
    expect(await syncQueuedAuditPlans()).toMatchObject({ synced: 1 });
    expect(await listQueuedAuditPlans()).toEqual([]);
  });
  it("does not replay another user's queued plans and prevents concurrent duplicate replay", async () => {
    outbox.set("other", { id: "other", ownerScope: "org:other-user", plan });
    await queueAuditPlan(plan);
    const fetch = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const first = syncQueuedAuditPlans();
    const second = syncQueuedAuditPlans();
    expect(first).toBe(second);
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outbox.has("other")).toBe(true);
  });
  it("does not overwrite a correction made while a stale request is in flight", async () => {
    await queueAuditPlan(plan);
    const corrected = { ...plan, auditTitle: "Corrected while synchronizing" };
    vi.stubGlobal("fetch", vi.fn(async () => {
      await queueAuditPlan(corrected);
      return new Response(JSON.stringify({ error: "Stale range" }), { status: 422 });
    }));
    await syncQueuedAuditPlans();
    const [retained] = await listQueuedAuditPlans();
    expect(retained?.plan.auditTitle).toBe(corrected.auditTitle);
    expect(retained?.lastError).toBeUndefined();
  });
  it("retains corrected dates after an older POST succeeds, rejects a stale 200 acknowledgement, then explicitly updates the saved draft", async () => {
    await queueAuditPlan(plan);
    const corrected = { ...plan, activities: [plan.activities![0],
      { ...plan.activities![1]!, plannedEndDateTime: "2026-01-02T23:55" }] };
    vi.stubGlobal("fetch", vi.fn(async () => {
      await queueAuditPlan(corrected);
      return new Response(JSON.stringify(plan), { status: 201 });
    }));
    await syncQueuedAuditPlans();
    expect((await listQueuedAuditPlans())[0]?.plan.activities).toEqual(corrected.activities);
    // An older server's idempotent create returns the saved original without applying this revision.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 })));
    expect(await syncQueuedAuditPlans()).toMatchObject({ synced: 0, failed: 1 });
    const [conflict] = await listQueuedAuditPlans();
    expect(conflict?.plan.activities).toEqual(corrected.activities);
    expect(conflict?.savedPlanConflict).toBe(true);
    expect(conflict?.lastError).toContain("correction remains on this device");
    // The UI explicitly offers review-and-apply; only that user action chooses update.
    await queueAuditPlan(corrected, "update");
    const updateFetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify(corrected), { status: 200 }));
    vi.stubGlobal("fetch", updateFetch);
    expect(await syncQueuedAuditPlans()).toMatchObject({ synced: 1, failed: 0 });
    expect(updateFetch.mock.calls[0]?.[0]).toBe(`/api/audit/plans/${plan.id}`);
    expect(updateFetch.mock.calls[0]?.[1].method).toBe("PUT");
    expect(JSON.parse(String(updateFetch.mock.calls[0]?.[1].body)).activities).toEqual(corrected.activities);
    expect(await listQueuedAuditPlans()).toEqual([]);
  });
  it("retains an explicit correction when the saved plan is no longer editable", async () => {
    await queueAuditPlan(plan, "update");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Only draft plans may be edited" }), { status: 409 })));
    expect(await syncQueuedAuditPlans()).toMatchObject({ synced: 0, failed: 1 });
    const [retained] = await listQueuedAuditPlans();
    expect(retained?.operation).toBe("update");
    expect(retained?.savedPlanConflict).toBe(true);
    expect(retained?.plan.activities).toEqual(plan.activities);
  });
});