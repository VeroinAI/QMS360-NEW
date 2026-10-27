import { describe, expect, it, vi } from "vitest";
import type { AuditSchedule } from "@workspace/api-client-react";
import { EMPTY_FILTERS, NO_LOCATION, dateRangeError, filterOptions, filterSchedules, overlapsRange, paginate, scheduleScopes, type ScopeLookups } from "./schedule-register";
import { loadPlanOptionPages } from "./plan-schedule-options";

const s = (over: Partial<AuditSchedule>): AuditSchedule => ({ id: "x", title: "Audit", projectIds: [], plannedStartDate: "2025-03-10", plannedEndDate: "2025-03-12", workflowState: "Draft", ...over } as AuditSchedule);
const lookups: ScopeLookups = { projects: new Map([["p-1", "Harbour Tower"], ["p-2", "Metro Line"]]), projectsFailed: false, departments: new Map([["hse", "Health & Safety"]]) };

describe("schedule register helpers", () => {
  it("resolves project and department sources without leaking ids", () => {
    expect(scheduleScopes(s({ projectIds: ["p-1", "p-2"] }), lookups).map(x => x.label)).toEqual(["Harbour Tower", "Metro Line"]);
    const dept = scheduleScopes(s({ departmentProject: "hse" }), lookups);
    expect(dept).toEqual([{ key: "department:hse", source: "Department", label: "Health & Safety", resolved: true }]);
    const unknown = scheduleScopes(s({ projectIds: ["9f1c-uuid"] }), { ...lookups, projectsFailed: true });
    expect(unknown[0].label).not.toContain("9f1c");
    expect(unknown[0].resolved).toBe(false);
  });

  it("keeps a department and a project with the same text distinct", () => {
    const rows = [s({ id: "a", projectIds: ["p-1"] }), s({ id: "b", departmentProject: "p-1" })];
    expect(filterSchedules(rows, { ...EMPTY_FILTERS, scope: "project:p-1" }, lookups).map(r => r.id)).toEqual(["a"]);
    expect(filterSchedules(rows, { ...EMPTY_FILTERS, scope: "department:p-1" }, lookups).map(r => r.id)).toEqual(["b"]);
  });

  it("intersects every filter", () => {
    const rows = [
      s({ id: "a", auditTypes: ["Internal"], auditCategory: "QA", projectIds: ["p-1"], location: "Dubai", workflowState: "Approved" }),
      s({ id: "b", auditTypes: ["Internal"], auditCategory: "QA", projectIds: ["p-1"], location: "Dubai", workflowState: "Draft" }),
      s({ id: "c", auditTypes: ["External"], auditCategory: "QA", projectIds: ["p-1"], location: "Dubai", workflowState: "Approved" }),
      s({ id: "d", auditTypes: ["Internal"], auditCategory: "QA", projectIds: ["p-1"], workflowState: "Approved" }),
    ];
    const f = { ...EMPTY_FILTERS, auditType: "Internal", auditCategory: "QA", scope: "project:p-1", location: "Dubai", status: "Approved", from: "2025-03-12" };
    expect(filterSchedules(rows, f, lookups).map(r => r.id)).toEqual(["a"]);
    expect(filterSchedules(rows, { ...EMPTY_FILTERS, location: NO_LOCATION }, lookups).map(r => r.id)).toEqual(["d"]);
  });

  it("matches overlapping intervals inclusively with single bounds", () => {
    const row = s({});
    expect(overlapsRange(row, "2025-03-12", "")).toBe(true);
    expect(overlapsRange(row, "2025-03-13", "")).toBe(false);
    expect(overlapsRange(row, "", "2025-03-10")).toBe(true);
    expect(overlapsRange(row, "", "2025-03-09")).toBe(false);
    expect(overlapsRange(row, "2025-03-01", "2025-03-31")).toBe(true);
    expect(overlapsRange(s({ plannedStartDate: "", plannedEndDate: "" }), "2025-01-01", "")).toBe(false);
    expect(dateRangeError("2025-04-01", "2025-03-01")).toMatch(/on or before/);
    expect(dateRangeError("23/", "")).toMatch(/valid From date/);
    expect(dateRangeError("", "2025-02-30")).toMatch(/valid To date/);
    expect(filterSchedules([row], { ...EMPTY_FILTERS, from: "2025-04-01", to: "2025-03-01" }, lookups)).toEqual([]);
  });

  it("paginates filtered results and clamps out-of-range pages", () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(rows, 3, 10)).toEqual({ rows: [20, 21, 22], page: 3 });
    expect(paginate(rows, 9, 10).page).toBe(3);
    expect(paginate([], 2, 10)).toEqual({ rows: [], page: 1 });
  });

  it("derives labelled options from authorised rows", () => {
    const o = filterOptions([s({ projectIds: ["p-1"], auditTypes: ["int"] }), s({ departmentProject: "hse" })], lookups, new Map([["int", "Internal"]]), new Map());
    expect(o.scopes.map(x => x.label)).toEqual(["Harbour Tower (Project)", "Health & Safety (Department)"]);
    expect(o.types).toEqual([{ value: "int", label: "Internal" }]);
    expect(o.locations).toEqual([{ value: NO_LOCATION, label: "No location recorded" }]);
  });

  it("loads every page before filtering and fails loudly on short pages", async () => {
    const fetchPage = vi.fn(async (page: number) => ({ items: page < 3 ? Array(100).fill(page) : [3], total: 201 }));
    expect(await loadPlanOptionPages(fetchPage)).toHaveLength(201);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    await expect(loadPlanOptionPages(async () => ({ items: [], total: 5 }))).rejects.toThrow();
  });
});
