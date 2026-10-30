import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), render: vi.fn(), store: vi.fn(),
}));
vi.mock("../routes/qaqc-reporting-tools", () => ({ qaqcReportForEmail: mocks.load }));
vi.mock("./qaqc-reporting-export", () => ({ exportQaqcReportPdf: mocks.render }));
vi.mock("./email-attachments", () => ({ storeEmailReportAttachment: mocks.store }));
vi.mock("./date-format", () => ({ withOrganizationDateFormat: (_org: string, render: () => unknown) => render() }));
import { generateEmailReport } from "./email-report-generator";

const entityId = "01234567-89ab-4cde-8fab-0123456789ab";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockResolvedValue(Buffer.from("pdf"));
  mocks.store.mockResolvedValue({ filename: "report.pdf", objectPath: "/private/report.pdf" });
});

describe("QA/QC email report renderers", () => {
  it.each([
    ["monthly", "qaqc_report_pdf", "monthly-metrics"],
    ["monthly", "qaqc_dashboard_pdf", "monthly-dashboard"],
    ["daily", "qaqc_report_pdf", "daily-submission"],
    ["daily", "qaqc_dashboard_pdf", "daily-dashboard"],
    ["csat", "qaqc_report_pdf", "csat-form"],
  ])("uses the existing %s %s download renderer", async (type, selection, templateId) => {
    const report = { reportType: type, id: entityId };
    mocks.load.mockResolvedValue(report);
    await generateEmailReport("tenant", { selection, eventType: `qaqc.${type}_report.submit`, entityId });
    expect(mocks.load).toHaveBeenCalledWith("tenant", entityId);
    expect(mocks.render).toHaveBeenCalledWith(report, { templateId });
    expect(mocks.store).toHaveBeenCalledWith("tenant", `${selection}-${entityId}`, Buffer.from("pdf"), "pdf");
  });

  it("rejects an event pointing to a different report type", async () => {
    mocks.load.mockResolvedValue({ reportType: "daily" });
    await expect(generateEmailReport("tenant", {
      selection: "qaqc_dashboard_pdf", eventType: "qaqc.monthly_report.approved_final", entityId,
    })).rejects.toThrow("does not match");
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("rejects dashboard selection for ambiguous shared events", async () => {
    mocks.load.mockResolvedValue({ reportType: "csat" });
    await expect(generateEmailReport("tenant", {
      selection: "qaqc_dashboard_pdf", eventType: "qaqc.qaqc_report.update", entityId,
    })).rejects.toThrow("Invalid event-specific");
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
