import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateReport } from "./qaqc-reporting-model";
import { exportQaqcEmailReportPdf, exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";

let outputDir: string;
beforeAll(async () => { outputDir = await mkdtemp(join(tmpdir(), "qms360-email-layout-")); });

function sample(reportType: "monthly" | "daily"): QaqcReportExport {
  const data = reportType === "monthly" ? {
    metrics: {
      external_ncr: { issued: 10, closed: 7 }, internal_ncr: { issued: 4, closed: 3 },
      rfi: { issued: 12, closed: 10 }, rmi: { issued: 5, closed: 4 },
    },
    manpower: [{ department: "Civil", count: 4 }],
  } : {
    disciplines: { drawings: { Civil: { approved: 10, resubmit: 2, rejected: 1, underReview: 3 } } },
    documentTypes: { Drawings: 16 },
    correspondence: { incoming: 2, outgoing: 3 },
  };
  return {
    id: "synthetic-format-check", organizationId: "synthetic-org", projectId: "synthetic-project",
    projectName: "Email Format Verification", projectCode: "FORMAT-CHECK",
    reportType, period: "2026-10-01", state: "submitted",
    data, baseline: {}, computed: calculateReport(reportType, data, {}),
    history: [{ action: "submit", actorId: "TECHNICAL_HISTORY_MUST_NOT_BE_PRINTED", after: { technical: true } }],
  };
}

describe("real email PDFs match named download layouts", () => {
  it.each([
    ["monthly", "report", "monthly-metrics"],
    ["monthly", "dashboard", "monthly-dashboard"],
    ["daily", "report", "daily-submission"],
    ["daily", "dashboard", "daily-dashboard"],
  ] as const)("%s %s uses the same actual PDF format as its download", async (type, layout, templateId) => {
    const report = sample(type);
    const email = await exportQaqcEmailReportPdf(report, layout);
    const download = await exportQaqcReportPdf(report, { templateId });
    const emailPdf = await PDFDocument.load(email);
    const downloadPdf = await PDFDocument.load(download);
    expect(emailPdf.getTitle()).toBe(downloadPdf.getTitle());
    expect(emailPdf.getPageCount()).toBe(downloadPdf.getPageCount());
    expect(emailPdf.getPages().map(page => page.getSize())).toEqual(downloadPdf.getPages().map(page => page.getSize()));
    if (layout === "dashboard") {
      expect(emailPdf.getPageCount()).toBe(type === "monthly" ? 5 : 4);
      expect(emailPdf.getPage(0).getWidth()).toBeGreaterThan(emailPdf.getPage(0).getHeight());
    } else {
      expect(emailPdf.getPage(0).getHeight()).toBeGreaterThan(emailPdf.getPage(0).getWidth());
    }
    await writeFile(join(outputDir, `${type}-${layout}.pdf`), email);
  }, 60000);

  it("fails explicitly rather than generating a generic dashboard for CSAT", async () => {
    await expect(exportQaqcEmailReportPdf({ ...sample("monthly"), reportType: "csat" }, "dashboard"))
      .rejects.toThrow("no standalone dashboard");
  });
});
