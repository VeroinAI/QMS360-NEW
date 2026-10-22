import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { calculateReport } from "./qaqc-reporting-model";
import { exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";
import { monthlyDashboardData } from "./qaqc-monthly-dashboard-data";

const data = {
  pqpStatus: "Approved B", pqpSubmittedDate: "2026-09-03", pqpApprovedDate: "2026-09-08",
  reportReference: "CLIENT-SEP-01", reportFrom: "2026-09-01", reportTo: "2026-09-30",
  internalAudit: { conducted: true, lastDate: "2026-09-15", nextDate: "2026-12-15" },
  narrative: "Actual quality assessment: continue monitoring open issues and complete the scheduled reviews.",
  meetings: [{ type: "Internal Meeting", lastDate: "2026-10-10" }],
  manpower: [{ department: "Civil", count: 3, approvalRequired: true }, { department: "Mechanical", count: 2, approvalRequired: false }],
  metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map(k => [k, { issued: 5, closed: 3, ageing: [{ bucket: "0-15", count: 1 }, { bucket: "15-45", count: 1 }, { bucket: "over45", count: 0 }] }])),
  material: { issued: 5, closed: 3, osdAvailable: true, osdMirns: 1, overage: 2, shortage: 1, damage: 0, defective: 0, totalItems: 10, approved: 5, onHold: 1, rejectedDoNotUse: 1, rejectedReturn: 1, hazardous: 1, handleWithCare: 1 },
  qtbt: { talkCount: 2, attendance: 20, durationMinutes: 15 },
  documents: { drawings: { approved: 10, resubmitted: 2, rejected: 1, underReview: 3, clientReviewDays: 6.4, internalReviewDays: 2.8 }, submittals: { approved: 8, resubmitted: 1, rejected: 1, underReview: 2, clientReviewDays: 5, internalReviewDays: 2 } },
  qmsReports: [{ department: "Quality", type: "Manual", documentName: "Actual QMS document", status: "Under Review and Signature", remarks: "Actual register remarks" }],
};
const baseline = { qtbt: { accumulatedTalkCount: 8, accumulatedManhours: 15 } };
const report: QaqcReportExport = {
  id: "synthetic-dashboard-report", organizationId: "synthetic-org", projectId: "synthetic-project",
  projectName: "Example Construction Project", period: "2026-10-01", state: "submitted", reportType: "monthly",
  data, baseline, computed: calculateReport("monthly", data, baseline, {}),
  monthlyDownloadPqi: { average: 37.5, projectCount: 2 },
  monthlyDashboardPortfolio: { average: 37.5, activeProjectCount: 2, reportedProjectCount: 2, pendingProjectCount: 0, status: "complete", period: "2026-10-01" },
};

describe("Monthly dashboard PDF supplied presentation and workbook", () => {
  it("maps saved calculations instead of recomputing the presentation's assumed formulas", () => {
    const r = structuredClone(report);
    (r.computed as any).metrics.rfi.monthlyRate = 12.3;
    const mapped = monthlyDashboardData(r);
    expect(mapped.values["KPI RFI value"]).toBe("12.3%");
    expect(mapped.values["KPI RFI sub"]).toBe("3 of 5 closed");
    expect(mapped.values["KPI QTBT value"]).toBe("5.00");
    expect(mapped.values["KPI manhours sub"]).toBe("15.00 before");
    expect(mapped.values["PQI notes"]).toContain("Portfolio avg: 37.5");
  });
  it("uses the workbook's Pending coverage rule without changing the separate monthly PDF average", () => {
    const r = { ...report, monthlyDashboardPortfolio: { average: null, activeProjectCount: 9, reportedProjectCount: 6, pendingProjectCount: 3, status: "pending" as const, period: report.period } };
    expect(monthlyDashboardData(r).values["PQI notes"]).toContain("Pending (6 of 9)");
    expect(r.monthlyDownloadPqi).toEqual({ average: 37.5, projectCount: 2 });
  });
  it("maps actual ageing bands without splitting or relabeling them as assumed bands", () => {
    const mapped = monthlyDashboardData(report);
    expect(mapped.charts[5]!.series.map(s => s.name)).toEqual(["0–15 days", "15–45 days", "Over 45 days"]);
    expect(mapped.charts[5]!.series[0]!.values).toEqual([1, 1]);
    expect(mapped.values["Ageing check"]).toContain("match");
    const r = structuredClone(report);
    (r.data as any).metrics.external_ncr.ageing[0].count = 10;
    expect(monthlyDashboardData(r).values["Ageing check"]).toContain("differ");
  });
  it("handles OSD No, not applicable audit/PQP values and missing fields honestly", () => {
    const r = structuredClone(report);
    (r.data as any).material.osdAvailable = false;
    (r.data as any).internalAudit.conducted = false;
    (r.data as any).pqpStatus = "Under Preparation";
    const m = monthlyDashboardData(r);
    expect(m.charts[7]!.hide).toBe("OSD not applicable");
    expect(m.values["Gov value 2"]).toBe("N/A");
    expect(m.values["PQP value 2"]).toBe("Not applicable");
    expect(m.values["QMS date 1"]).toBe("To be mapped");
    expect(m.values["QMS detail 1"]).toContain("Actual register remarks");
    expect(m.values["Meeting outcome 1"]).toBe("To be mapped");
    expect(m.values["Manpower note"]).toContain("all except Mechanical");
    expect(monthlyDashboardData({ ...report, data: {}, computed: {}, monthlyDownloadPqi: undefined }).values["KPI PQI value"]).toBe("To be mapped");
  });
  it("reports mismatched material totals and repeating-row overflow, never sample rows", () => {
    const r = structuredClone(report);
    (r.data as any).material.totalItems = 99;
    (r.data as any).meetings = Array.from({ length: 7 }, () => data.meetings[0]);
    (r.data as any).qmsReports = Array.from({ length: 5 }, () => data.qmsReports[0]);
    const m = monthlyDashboardData(r);
    expect(m.statusMismatch).toBe(true);
    expect(m.values["Meeting outcome 4"]).toContain("+ 3 more");
    expect(m.values["QMS detail 3"]).toContain("+ 2 more");
  });
  it("renders five landscape pages through the existing export dispatcher without illustrative values", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const bytes = await exportQaqcReportPdf(report, { templateId: "monthly-dashboard" });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(5);
      for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 960, height: 540 });
      const text = draw.mock.calls.map(c => c[0]).join(" ");
      for (const s of ["Example Construction Project", "October 2026", "Actual QMS document", "Monthly Dashboard", "37.5"]) expect(text).toContain(s);
      for (const s of ["Al Nakheel", "SAMPLE DATA", "Document Control Audit Report", "Stable quality performance", "ALG-NKC", "192 attendees", "90.4"]) expect(text).not.toContain(s);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      await mkdir("../../generated-artifacts", { recursive: true });
      await writeFile("../../generated-artifacts/monthly-dashboard-preview.pdf", bytes);
    } finally { draw.mockRestore(); }
  });
  it("renders incomplete and long-value legacy drafts without invalid chart geometry", async () => {
    const bytes = await exportQaqcReportPdf({ ...report, state: "draft", projectName: "Long project name ".repeat(25), data: { narrative: "Long assessment ".repeat(200) }, computed: {}, baseline: {} }, { templateId: "monthly-dashboard" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
    await writeFile("../../generated-artifacts/monthly-dashboard-empty-preview.pdf", bytes);
  });
});
