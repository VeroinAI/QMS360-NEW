import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import {
  exportQaqcDashboardExcel, exportQaqcDashboardPdf, exportQaqcReportExcel, exportQaqcReportPdf,
} from "./qaqc-reporting-export";

const report = {
  id: "report-1", organizationId: "org-1", projectId: "project-1", projectName: "Central Hospital",
  reportType: "monthly", period: "2026-08-01", state: "approved", referenceNumber: "QA-2026-08",
  data: { narrative: "All quality measures are progressing.", qmsReports: [{ department: "Quality", type: "SOP" }] },
  computed: { pqi: { accumulated: 96.5 } }, baseline: { pqi: { accumulated: 94 } },
  submittedById: "user-submitted", approverId: "user-approver", submittedAt: "2026-09-01T10:00:00.000Z",
  approvedAt: "2026-09-02T10:00:00.000Z", reviewComments: "Approved with comments",
  reportTemplates: [{ name: "QA/QC Master", template: { title: "QA/QC Report", version: "4" } }],
};

describe("QA/QC report exports", () => {
  it("formats dates throughout Excel exports without changing the source report", () => {
    const datedReport = {
      ...report,
      data: { ...report.data, reportFrom: "2026-08-01", meetings: [{ lastDate: "2026-08-04", nextDate: "2026-09-05" }] },
      history: [{ at: "2026-09-02T10:00:00.000Z", action: "approved" }],
    };
    const book = XLSX.read(exportQaqcReportExcel(datedReport), { type: "buffer" });
    const metadata = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Report, { header: 1 });
    expect(metadata).toContainEqual(["Period", "01/08/2026"]);
    expect(metadata).toContainEqual(["Submitted at", "01/09/2026"]);
    expect(metadata).toContainEqual(["Approved at", "02/09/2026"]);
    const values = XLSX.utils.sheet_to_json(book.Sheets["Submitted Data"]);
    expect(values).toContainEqual({ Field: "reportFrom", Value: "01/08/2026" });
    expect(values).toContainEqual({ Field: "meetings[1].lastDate", Value: "04/08/2026" });
    expect(XLSX.utils.sheet_to_json(book.Sheets["Workflow History"])).toContainEqual({ at: "02/09/2026", action: "approved" });
    expect(datedReport.period).toBe("2026-08-01");
    expect(datedReport.history[0].at).toBe("2026-09-02T10:00:00.000Z");
  });

  it("formats dashboard dates across rows, trends and history", () => {
    const book = XLSX.read(exportQaqcDashboardExcel({
      rows: [{ period: "2026-08-01", value: 7 }], trends: [{ period: "2026-08-01", count: 3 }],
      reports: [{ ...report, history: [{ at: "2026-09-02T10:00:00.000Z" }] }],
    }), { type: "buffer" });
    expect(XLSX.utils.sheet_to_json(book.Sheets["Report Data"])).toEqual([{ period: "01/08/2026", value: 7 }]);
    expect(XLSX.utils.sheet_to_json(book.Sheets.Trends)).toEqual([{ period: "01/08/2026", count: 3 }]);
    expect(XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Workflow History"])[0].at).toBe("02/09/2026");
  });
  it("exports all report data, calculations, frozen baseline, and workflow identity to Excel", () => {
    const workbook = XLSX.read(exportQaqcReportExcel(report), { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Report", "Submitted Data", "Calculated Values", "Baseline", "Template Metadata"]);
    const values = XLSX.utils.sheet_to_json(workbook.Sheets["Submitted Data"]!);
    expect(values).toContainEqual({ Field: "narrative", Value: "All quality measures are progressing." });
    expect(values.some((row) => JSON.stringify(row).includes("Quality"))).toBe(true);
    const overview = XLSX.utils.sheet_to_json(workbook.Sheets.Report!, { header: 1 }) as unknown[][];
    expect(overview.some((row) => row[0] === "Approved at")).toBe(true);
  });

  it("produces readable multi-page PDF reports and dashboards", async () => {
    const pdfBytes = await exportQaqcReportPdf(report);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    const dashboard = {
      title: "QA/QC Dashboard",
      filters: { projectId: "project-1", period: "2026-08-01" },
      summary: { submitted: 1 },
      rows: [{ project: "Central Hospital", pqi: 96.5 }],
      dashboardData: { aggregates: [{ period: "2026-08-01", averagePqi: 96.5 }], daily: [] },
      trends: [{ period: "2026-08-01", pqi: 96.5 }],
    };
    expect(XLSX.read(exportQaqcDashboardExcel(dashboard), { type: "buffer" }).SheetNames)
      .toEqual(["Filters", "Summary", "Report Data", "Dashboard Data", "Trends"]);
    expect((await PDFDocument.load(await exportQaqcDashboardPdf(dashboard))).getPageCount()).toBeGreaterThan(0);
  });
});