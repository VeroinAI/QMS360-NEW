import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage, PDFDict, PDFName, PDFString } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { calculateReport } from "./qaqc-reporting-model";
import { dailyDashboardData } from "./qaqc-daily-dashboard-data";
import { exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";

const disciplines = ["Civil", "Structural", "Mechanical", "Electrical", "Instrumentation"];
const entities = ["Client", "Algihaz", "Supplier"], statuses = ["underReview", "A", "B", "C", "D", "E"];
const make = (approved: number) => ({
  disciplines: Object.fromEntries(["drawings", "submittals"].map(key => [key, Object.fromEntries(disciplines.map(d => [d, { approved, resubmit: 2, rejected: 1, underReview: 3 }]))])),
  documentTypes: Object.fromEntries(["Drawings", "Material Submittals", "Method Statements", "ITPs", "RFIs", "Procedures", "Calculations", "Vendors"].map(k => [k, approved])),
  revisions: { drawings: [{ name: "REV-A", value: approved }], submittals: [{ name: "REV-A", value: approved + 1 }] },
  pending: Object.fromEntries(entities.map(e => [e, Object.fromEntries(statuses.map(s => [s, { upTo7: 4, days8To30: 2, over30: 1 }]))])),
  correspondence: { outgoing: approved, incoming: approved + 1 },
  rejectedSubmissions: { drawing: 1, materials: 2, calculation: 3, general: 4 },
});
const data = make(10), baseline = make(8);
const report: QaqcReportExport = {
  id: "synthetic-daily-report", organizationId: "org", projectId: "project", projectName: "Example Construction",
  projectCode: "PROJECT-900", costCentre: "CC-900", projectTeam: { pmName: "Actual PM", peName: "Actual PE", dcName: "Actual DC" },
  reportType: "daily", period: "2026-10-19", state: "submitted", data, baseline,
  computed: calculateReport("daily", data, baseline),
  dailyReportPdfUrl: "https://example.test/api/qaqc/reporting/reports/synthetic-daily-report/export?format=pdf&templateId=daily-submission",
};

describe("Daily dashboard supplied presentation and mapping workbook", () => {
  it("maps both daily change and cumulative bands from the saved data and baseline", () => {
    const m = dailyDashboardData(report);
    expect(m.values["Added SUBMITTALS chip 1 value"]).toBe("+10");
    expect(m.values["Added SUBMISSION TOTAL chip 2 value"]).toBe("+20");
    expect(m.values["Cum DRAWINGS chip 1 value"]).toBe("80");
    expect(m.values["Cum SUBMISSION TOTAL chip 1 value"]).toBe("160");
    expect(m.values["Added CORRESPONDENCE chip 1 value"]).toBe("+2");
    expect(m.values["Cum CORRESPONDENCE chip 2 value"]).toBe("11");
    expect(m.charts[1]!.series[0]!.values).toEqual([10, 10, 0, 0, 0]);
    expect(m.values["Project line"]).toBe("PROJECT-900 · Example Construction");
    expect(m.values["Team line"]).toContain("DC – Actual DC");
  });
  it("keeps all-status pending totals separate from UNDER REVIEW and document discipline counts", () => {
    const m = dailyDashboardData(report);
    expect(m.values["Under review total chip 1 value"]).toBe("21");
    expect(m.values["KPI Client value"]).toBe("42");
    expect(m.values["KPI Client sub"]).toBe("6 pending ≥ 31 days");
    expect(m.values["KPI all aged value"]).toBe("18");
    expect(m.tables!["Pending days table"]!.rows.at(-1)).toEqual(["All parties", "72", "36", "18", "126"]);
    expect(m.charts[17]!.series[0]!.values).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it("uses stored discipline totals and normalized category-specific revision baselines", () => {
    const r = structuredClone(report);
    (r.computed as any).disciplineTotals["drawings.Civil"] = 100;
    (r.baseline as any).revisions.drawings[0] = { name: "  rev-a  ", value: 3 };
    const m = dailyDashboardData(r);
    expect(m.tables!["Drawings table"]!.rows[1]![5]).toBe("100");
    expect(m.charts[9]!.categories[0]).toBe("Drawing rev REV-A  +7");
    expect(m.charts[9]!.categories[1]).toBe("Submittal rev REV-A  +2");
    expect(m.charts[15]!.series[0]!.values[0]).toBeCloseTo(10 / 244 * 100);
  });
  it("preserves negative and zero corrections without drawing a false positive donut segment", () => {
    const r = structuredClone(report);
    (r.data as any).correspondence.outgoing = 2;
    (r.data as any).disciplines.drawings.Civil.approved = 1;
    r.computed = calculateReport("daily", r.data, r.baseline);
    const m = dailyDashboardData(r);
    expect(m.values["Added CORRESPONDENCE chip 1 value"]).toBe("−6");
    expect(m.charts[4]!.series[0]!.values[0]).toBe(-6);
    expect(m.charts[2]!.series[0]!.values[1]).toBe(1);
    expect(m.values["Rejected total chip 1 label"]).toBe("0 since yesterday");
  });
  it("does not copy examples or replace absent current inputs with invented values", () => {
    const m = dailyDashboardData({ ...report, data: {}, computed: {}, baseline: {}, projectName: null, projectTeam: undefined });
    expect(m.values["Cum SUBMITTALS chip 1 value"]).toBe("To be mapped");
    expect(m.values["KPI Client value"]).toBe("To be mapped");
    expect(m.charts[9]!.hide).toBe("No revision rows added");
    const first = dailyDashboardData({ ...report, baseline: {} });
    expect(first.values["Added SUBMITTALS chip 1 value"]).toBe("+80");
    expect(first.charts[9]!.categories[0]).toBe("Drawing rev REV-A  +10");
  });
  it("renders all four landscape pages, real table cells, source styling and a working report-link annotation", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const bytes = await exportQaqcReportPdf(report, { templateId: "daily-dashboard" });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(4);
      for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 960, height: 540 });
      expect(pdf.getPages()[0]!.node.Annots()?.size()).toBe(1);
      const annotation = pdf.context.lookup(pdf.getPages()[0]!.node.Annots()!.get(0), PDFDict);
      expect(annotation.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(report.dailyReportPdfUrl);
      const texts = draw.mock.calls.map(c => c[0]).join(" ");
      for (const value of ["Example Construction", "PROJECT-900", "Actual PM", "19-10-2026", "ADDED SINCE YESTERDAY", "160", "REV-A"]) expect(texts).toContain(value);
      for (const example of ["AGH-ALPHA", "Alpha District", "S. Rahman", "CC-3107", "SAMPLE DATA", "1,034", "[PDF report link]"]) expect(texts).not.toContain(example);
      await mkdir("../../generated-artifacts", { recursive: true });
      await writeFile("../../generated-artifacts/daily-dashboard-preview.pdf", bytes);
    } finally { draw.mockRestore(); }
  });
  it("renders incomplete drafts and negative correction charts without failing", async () => {
    const r = structuredClone(report);
    r.data = make(1); r.computed = calculateReport("daily", r.data, r.baseline);
    const negative = await exportQaqcReportPdf(r, { templateId: "daily-dashboard" });
    expect((await PDFDocument.load(negative)).getPageCount()).toBe(4);
    await writeFile("../../generated-artifacts/daily-dashboard-negative-preview.pdf", negative);
    const empty = await exportQaqcReportPdf({ ...report, data: {}, computed: {}, baseline: {}, dailyReportPdfUrl: undefined, state: "draft" }, { templateId: "daily-dashboard" });
    expect((await PDFDocument.load(empty)).getPageCount()).toBe(4);
    await writeFile("../../generated-artifacts/daily-dashboard-empty-preview.pdf", empty);
  });
});
