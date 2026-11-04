import { describe, expect, it, vi } from "vitest";
import type { AuditPlan, AuditSchedule } from "@workspace/api-client-react";
import { availablePlanSchedules, buildPlanRow, EMPTY_PLAN_FILTERS, filterPlanRows, planFilterOptions, type ScheduleLookup } from "./plan-register";
import { paginate, type ScopeLookups } from "./schedule-register";
import { loadPlanOptionPages } from "./plan-schedule-options";

const plan = (o: Partial<AuditPlan>): AuditPlan => ({ id: "pl", scheduleId: "s1", auditTitle: "Plan", auditTypes: ["int"], qaqcReference: "", status: "Draft", openingMeetingDateTime: "", closingMeetingDateTime: "", ...o } as AuditPlan);
const sched = (o: Partial<AuditSchedule>): AuditSchedule => ({ id: "s1", projectIds: [], workflowState: "Approved", ...o } as AuditSchedule);
const scope: ScopeLookups = { projects: new Map([["p1", "Harbour Tower"]]), projectsFailed: false, departments: new Map() };
const lk = (s: AuditSchedule[], failed = false): ScheduleLookup => ({ byId: new Map(s.map(x => [x.id, x])), failed, loading: false });

describe("plan register mapping", () => {
  it("keeps Plan Status independent from schedule Approval Status", () => {
    const r = buildPlanRow(plan({ status: "Draft" }), lk([sched({ workflowState: "Approved" })]), scope);
    expect(r.planStatus).toBe("Draft");
    expect(r.approvalStatus).toEqual({ value: "Approved", source: "schedule" });
  });
  it("separates Audit ID (schedule QA/QC ref) from plan reference number, never auditNumber", () => {
    const r = buildPlanRow(plan({ planNumber: "AP-0007", qaqcReference: "OLD" }), lk([sched({ qaqcReference: "QA-12", auditNumber: "AUD-99" })]), scope);
    expect(r.auditId).toEqual({ value: "QA-12", source: "schedule" });
    expect(r.planReference).toBe("AP-0007");
  });
  it("falls back to saved plan reference only for legacy/missing link", () => {
    const r = buildPlanRow(plan({ qaqcReference: "LEG-1" }), lk([]), scope);
    expect(r.auditId).toEqual({ value: "LEG-1", source: "plan" });
    expect(r.approvalStatus.value).toBeNull();
    expect(r.processOwner.value).toBeNull();
  });
  it("never defaults to Approved and marks failed lookups unavailable", () => {
    const r = buildPlanRow(plan({ qaqcReference: "LEG-1" }), lk([], true), scope);
    expect(r.approvalStatus).toEqual({ value: null, source: "unavailable" });
    expect(r.auditId.source).toBe("unavailable");
    expect(r.scopes).toBeNull();
  });
  it("uses process owner name and resolved project scope from schedule", () => {
    const r = buildPlanRow(plan({}), lk([sched({ processProductOwner: "Amina Rahal", projectIds: ["p1"] })]), scope);
    expect(r.processOwner.value).toBe("Amina Rahal");
    expect(r.scopes?.[0].label).toBe("Harbour Tower");
  });
  it("applies combined filters and search, with options from rows only", () => {
    const l = lk([sched({ id: "a", qaqcReference: "Q1", processProductOwner: "X", workflowState: "Approved" }), sched({ id: "b", qaqcReference: "Q2", processProductOwner: "Y", workflowState: "Draft" })]);
    const rows = [plan({ id: "1", scheduleId: "a", auditTitle: "Alpha", status: "Draft" }), plan({ id: "2", scheduleId: "b", auditTitle: "Beta", status: "Shared", auditTypes: ["ext"] }), plan({ id: "3", scheduleId: "a", auditTitle: "Gamma", status: "Shared" })].map(p => buildPlanRow(p, l, scope));
    expect(filterPlanRows(rows, { ...EMPTY_PLAN_FILTERS, processOwner: "X", planStatus: "Shared" }, "").map(r => r.plan.id)).toEqual(["3"]);
    expect(filterPlanRows(rows, { ...EMPTY_PLAN_FILTERS, approvalStatus: "Draft", auditType: "ext" }, "bet").map(r => r.plan.id)).toEqual(["2"]);
    expect(filterPlanRows(rows, { ...EMPTY_PLAN_FILTERS, auditId: "Q1", planStatus: "Draft", auditType: "ext" }, "")).toEqual([]);
    expect(planFilterOptions(rows, new Map()).auditIds.map(o => o.value)).toEqual(["Q1", "Q2"]);
  });
  it("loads all pages, paginates locally and uses all plans for availability", async () => {
    const all = Array.from({ length: 230 }, (_, i) => plan({ id: `p${i}`, scheduleId: `s${i}` }));
    const fetch = vi.fn(async (page: number) => ({ items: all.slice((page - 1) * 100, page * 100), total: all.length }));
    const loaded = await loadPlanOptionPages(fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(loaded).toHaveLength(230);
    expect(paginate(loaded, 23, 10).rows.map(p => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${220 + i}`));
    const avail = availablePlanSchedules([sched({ id: "s225" }), sched({ id: "free" }), sched({ id: "h", hasPlan: true })], loaded);
    expect(avail.map(s => s.id)).toEqual(["free"]);
  });
});
