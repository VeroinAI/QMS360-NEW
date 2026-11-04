import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Router } from "wouter";
import { formatDate } from "@workspace/spreadsheet-dates";
import type { AuditReportTable } from "@workspace/api-client-react";

const state = vi.hoisted(() => ({ canExport: true, query: {} as Record<string, unknown>, calls: [] as unknown[][] }));
vi.mock("@/lib/use-audit-capabilities", () => ({ useAuditCapabilities: () => ({ canExport: () => state.canExport }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetAuditReportTable: (...args: unknown[]) => { state.calls.push(args); return state.query; },
  getGetAuditReportTableQueryKey: (r: string, p: unknown) => ["/api/audit/reports/table", r, p],
  getGetAuditReportTableUrl: (r: string, p: Record<string, unknown>) => `/api/audit/reports/table/${r}?${new URLSearchParams(p as Record<string, string>)}`,
}));
import { AuditReports, AuditReportTableView, AUDIT_REPORT_TABS } from "./audit-reports";

const table: AuditReportTable = {
  availableYears: [2026, 2010],
  title: "Findings Log", total: 2, page: 1, limit: 25, generatedAt: "2026-03-04T10:00:00Z",
  columns: [{ label: "Finding ID", kind: "text" }, { label: "Raised On", kind: "date" }, { label: "Days Open", kind: "number" }],
  rows: [{ id: "a", values: ["F-001", "2026-02-15", "17"] }, { id: "b", values: ["F-002", null, ""] }],
};
const page = (search = "") => renderToStaticMarkup(<Router ssrPath="/audit/reports" ssrSearch={search}><AuditReports/></Router>);
beforeEach(() => { state.canExport = true; state.calls = []; state.query = { data: table, isLoading: false, isError: false, refetch: () => {} }; });

describe("AuditReports", () => {
  it("shows only server-provided years with data, including older years", () => {
    const html = page();
    expect([...html.matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(match => match[1]))
      .toEqual(["", "2026", "2010"]);
  });
  it("does not offer any numbered years when the selected report has no data", () => {
    state.query = { ...state.query, data: { ...table, availableYears: [], total: 0, rows: [] } };
    expect([...page().matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(match => match[1]))
      .toEqual([""]);
  });
  it("shows the four workbook tabs and no landing cards", () => {
    const html = page();
    expect(AUDIT_REPORT_TABS.map(t => t.label)).toEqual(["Open vs Closed Audits", "Findings Log", "CAR Status & Closure", "Annual Audit Schedule"]);
    for (const t of AUDIT_REPORT_TABS) expect(html).toContain(`tab-report-${t.key}`);
    expect(html).not.toContain("Audit ageing");
  });
  it.each(AUDIT_REPORT_TABS.map(t => t.key))("selects %s from the query string", key => {
    page(`report=${key}`);
    expect(state.calls[0][0]).toBe(key);
  });
  it("renders server headers in order, organization dates and dashes", () => {
    const html = renderToStaticMarkup(<AuditReportTableView data={table} page={1}/>);
    expect([...html.matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map(m => m[1])).toEqual(["Finding ID", "Raised On", "Days Open"]);
    expect(html).toContain(formatDate("2026-02-15"));
    expect(html).not.toContain("2026-02-15<");
    expect(html.match(/>—</g)?.length).toBe(2);
    expect(html).toContain("2 records");
  });
  it("links CSV export with format=csv for exporters", () => {
    expect(page("report=car-status")).toMatch(/href="\/api\/audit\/reports\/table\/car-status\?format=csv"/);
  });
  it("hides export for roles without export", () => {
    state.canExport = false;
    const html = page();
    expect(html).not.toContain("format=csv");
    expect(html).toContain("text-report-no-export");
  });
  it("renders loading, error and empty states", () => {
    expect(renderToStaticMarkup(<AuditReportTableView isLoading page={1}/>)).toContain("status-report-loading");
    expect(renderToStaticMarkup(<AuditReportTableView isError page={1}/>)).toContain("button-report-retry");
    expect(renderToStaticMarkup(<AuditReportTableView data={{ ...table, rows: [], total: 0 }} page={1}/>)).toContain("status-report-empty");
  });
});
