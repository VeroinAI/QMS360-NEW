import { describe, expect, it, vi } from "vitest";
import type { Audit } from "@workspace/api-client-react";
import { buildExecutionRow, EMPTY_EXECUTION_FILTERS, executionFilterOptions, filterExecutionRows, hasMissingSummaries, type ExecutionSummary } from "./execution-register";
import { paginate } from "./schedule-register";
import { loadPlanOptionPages } from "./plan-schedule-options";

const sum = (o: Partial<ExecutionSummary> = {}): ExecutionSummary => ({ auditId: "QA-1", auditTypes: ["internal"], projectDepartment: "Plant A", auditLeadId: "u1", auditLeadName: "Rana Haddad", findingCount: 3, openFindingCount: 1, ...o });
const audit = (id: string, o: Record<string, unknown> = {}) => ({ id, title: `Audit ${id}`, status: "In progress", planNumber: `PLN-${id}`, reportApproval: { status: "Not submitted" }, ...o }) as unknown as Audit;

const rows = [
  buildExecutionRow(audit("a", { executionSummary: sum() })),
  buildExecutionRow(audit("b", { status: "Completed", reportApproval: { status: "Pending approval" }, executionSummary: sum({ auditId: "QA-2", auditLeadId: "u2", projectDepartment: "Finance" }) })),
  buildExecutionRow(audit("c", { status: "Completed", reportApproval: { status: "Approved" }, executionSummary: sum({ auditId: "QA-3", auditLeadId: "u3", auditLeadName: "Rana Haddad" }) })),
  buildExecutionRow(audit("d", { status: "In progress", reportApproval: { status: "Approved" }, executionSummary: sum({ auditId: "QA-4", auditLeadId: "u2", projectDepartment: "Finance" }) })),
];
const ids = (r: typeof rows) => r.map(x => x.audit.id);

describe("execution register", () => {
  it("applies each filter and their intersections with title search", () => {
    const F = EMPTY_EXECUTION_FILTERS;
    expect(ids(filterExecutionRows(rows, { ...F, auditId: "QA-2" }, ""))).toEqual(["b"]);
    expect(ids(filterExecutionRows(rows, { ...F, auditLead: "u2" }, ""))).toEqual(["b", "d"]);
    expect(ids(filterExecutionRows(rows, { ...F, projectDepartment: "Plant A" }, ""))).toEqual(["a", "c"]);
    expect(ids(filterExecutionRows(rows, { ...F, auditStatus: "Completed" }, ""))).toEqual(["b", "c"]);
    expect(ids(filterExecutionRows(rows, { ...F, reportStatus: "Approved" }, ""))).toEqual(["c", "d"]);
    expect(ids(filterExecutionRows(rows, { ...F, auditLead: "u2", reportStatus: "Approved" }, ""))).toEqual(["d"]);
    expect(ids(filterExecutionRows(rows, { auditId: "QA-4", auditLead: "u2", projectDepartment: "Finance", auditStatus: "In progress", reportStatus: "Approved" }, "audit d"))).toEqual(["d"]);
    expect(ids(filterExecutionRows(rows, { ...F, auditStatus: "Completed", projectDepartment: "Finance", reportStatus: "Approved" }, ""))).toEqual([]);
    expect(ids(filterExecutionRows(rows, F, "AUDIT C"))).toEqual(["c"]);
  });
  it("keeps audit and report statuses independent", () => {
    expect(rows[3].auditStatus).toBe("In progress");
    expect(rows[3].reportStatus).toBe("Approved");
    expect(rows[1].auditStatus).toBe("Completed");
    expect(rows[1].reportStatus).toBe("Pending approval");
  });
  it("never invents counts or approval when summary/report status missing", () => {
    const r = buildExecutionRow(audit("x", { status: "Completed", reportApproval: undefined }));
    expect(r.summary).toBeNull();
    expect(r.reportStatus).toBeNull();
    expect(hasMissingSummaries([r])).toBe(true);
    expect(filterExecutionRows([r], { ...EMPTY_EXECUTION_FILTERS, reportStatus: "Approved" }, "")).toEqual([]);
    expect(executionFilterOptions([r]).reportStatuses).toEqual([]);
  });
  it("keys leads by user ID and disambiguates same names", () => {
    const leads = executionFilterOptions(rows).leads;
    expect(leads.map(l => l.value).sort()).toEqual(["u1", "u2", "u3"]);
    const same = leads.filter(l => l.label.startsWith("Rana Haddad"));
    expect(new Set(same.map(l => l.label)).size).toBe(same.length);
  });
  it("loads all pages before local pagination and clamps page after filter reset", async () => {
    const all = Array.from({ length: 230 }, (_, i) => i);
    const fetch = vi.fn(async (p: number) => ({ items: all.slice((p - 1) * 100, p * 100), total: 230 }));
    expect(await loadPlanOptionPages(fetch)).toHaveLength(230);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(paginate(all, 23, 10).rows).toEqual([220, 221, 222, 223, 224, 225, 226, 227, 228, 229]);
    expect(paginate(all.slice(0, 4), 23, 10).page).toBe(1);
  });
});
