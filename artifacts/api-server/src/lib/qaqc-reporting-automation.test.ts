import { describe, expect, it } from "vitest";
import {
  approvalDelayPriority, calendarDaysBetween, lowMetricEscalationLevel, queueApprovedReportBundle,
  reportingAlertDue, reportingDistributionDue, reportingPeriodsSince, type ApprovedDistributionDependencies,
} from "./qaqc-reporting-automation";

describe("QA/QC reporting automation schedule rules", () => {
  it("alerts daily reports by each missing period, not by the current day of month", () => {
    expect(reportingAlertDue("missing_daily", "2026-10-01", "2026-10-02", 11, 0)).toBeNull();
    expect(reportingAlertDue("missing_daily", "2026-10-01", "2026-10-02", 11, 1))
      .toEqual({ period: "2026-10-01", director: false });
    expect(reportingAlertDue("missing_daily", "2026-10-02", "2026-10-03", 11, 1))
      .toEqual({ period: "2026-10-02", director: false });
    expect(reportingAlertDue("missing_daily", "2026-10-01", "2026-10-03", 0, 0))
      .toEqual({ period: "2026-10-01", director: true });
  });

  it("keeps unresolved monthly periods eligible after month rollover with the 8th and +2-day deadlines", () => {
    expect(reportingAlertDue("missing_monthly", "2026-09-01", "2026-10-08", 10, 59)).toBeNull();
    expect(reportingAlertDue("missing_monthly", "2026-09-01", "2026-10-08", 11, 0))
      .toEqual({ period: "2026-09-01", director: false });
    expect(reportingAlertDue("missing_monthly", "2026-09-01", "2026-10-10", 11, 0))
      .toEqual({ period: "2026-09-01", director: false });
    expect(reportingAlertDue("missing_monthly", "2026-09-01", "2026-10-10", 11, 1))
      .toEqual({ period: "2026-09-01", director: true });
    expect(reportingAlertDue("missing_monthly", "2026-09-01", "2026-11-10", 11, 1))
      .toEqual({ period: "2026-09-01", director: true });
  });

  it("starts missing-period alerts at the configured reporting date", () => {
    expect(reportingPeriodsSince("2026-10-02", "2026-10-04", "missing_daily"))
      .toEqual(["2026-10-02", "2026-10-03"]);
    expect(reportingPeriodsSince("2026-09-15", "2026-11-10", "missing_monthly"))
      .toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("maps consecutive below-target months to the three escalation levels", () => {
    expect([0, 1, 2, 3, 4, 5].map(lowMetricEscalationLevel)).toEqual([0, 0, 1, 2, 3, 3]);
  });

  it("routes approval delays to P2 on days 2-4 and P1 from day 5", () => {
    expect([0, 1, 2, 3, 4, 5].map(approvalDelayPriority)).toEqual([null, null, "P2", "P2", "P2", "P1"]);
  });

  it("uses calendar day-of-month schedules for monthly and daily distributions", () => {
    expect(reportingDistributionDue("daily", "2026-08-01", [1, 15])).toBe(true);
    expect(reportingDistributionDue("daily", "2026-08-08", [1, 15])).toBe(false);
    expect(reportingDistributionDue("monthly", "2026-08-15", 15)).toBe(true);
  });

  it("queues both report and dashboard PDFs through a mocked email queue only", async () => {
    let enqueued: Array<{ filename: string; contentType: "application/pdf"; objectPath: string }> = [];
    let finished: string | undefined;
    const dependencies: ApprovedDistributionDependencies = {
      claim: async () => true,
      hasQueuedEmail: async () => false,
      renderReport: async () => Buffer.from("%PDF-report"),
      renderDashboard: async () => Buffer.from("%PDF-dashboard"),
      storeAttachment: async (layout) => ({
        filename: `${layout}.pdf`, contentType: "application/pdf", objectPath: `/private/${layout}`,
      }),
      enqueue: async (attachments) => { enqueued = attachments; return { queued: 1 }; },
      audit: async () => undefined,
      finish: async (status) => { finished = status; },
      removeAttachment: async () => undefined,
    };
    expect(await queueApprovedReportBundle(dependencies)).toBe("queued");
    expect(enqueued.map((attachment) => attachment.filename)).toEqual(["report.pdf", "dashboard.pdf"]);
    expect(finished).toBe("queued");
  });

  it("treats an existing email-queue claim as queued without duplicating delivery", async () => {
    let enqueueCalls = 0;
    let finished: string | undefined;
    const dependencies: ApprovedDistributionDependencies = {
      claim: async () => true,
      hasQueuedEmail: async () => true,
      renderReport: async () => Buffer.from("%PDF-report"),
      renderDashboard: async () => Buffer.from("%PDF-dashboard"),
      storeAttachment: async (layout) => ({
        filename: `${layout}.pdf`, contentType: "application/pdf", objectPath: `/private/${layout}`,
      }),
      enqueue: async () => { enqueueCalls++; return { queued: 1 }; },
      audit: async () => undefined,
      finish: async (status) => { finished = status; },
      removeAttachment: async () => undefined,
    };
    expect(await queueApprovedReportBundle(dependencies)).toBe("queued");
    expect(enqueueCalls).toBe(0);
    expect(finished).toBe("queued");
  });

  it("allows a failed distribution claim to recover without real email delivery", async () => {
    let attempts = 0;
    const statuses: string[] = [];
    const dependencies: ApprovedDistributionDependencies = {
      claim: async () => true,
      hasQueuedEmail: async () => false,
      renderReport: async () => Buffer.from("%PDF-report"),
      renderDashboard: async () => Buffer.from("%PDF-dashboard"),
      storeAttachment: async (layout) => ({
        filename: `${layout}.pdf`, contentType: "application/pdf", objectPath: `/private/${layout}`,
      }),
      enqueue: async () => {
        attempts++;
        if (attempts === 1) throw new Error("mock queue unavailable");
        return { queued: 1 };
      },
      audit: async () => undefined,
      finish: async (status) => { statuses.push(status); },
      removeAttachment: async () => undefined,
    };
    expect(await queueApprovedReportBundle(dependencies)).toBe("failed");
    expect(await queueApprovedReportBundle(dependencies)).toBe("queued");
    expect(statuses).toEqual(["failed", "queued"]);
    expect(attempts).toBe(2);
  });

  it("counts approval delays by organization-local calendar day rather than elapsed 24-hour blocks", () => {
    expect(calendarDaysBetween(
      new Date("2026-08-01T20:00:00.000Z"),
      new Date("2026-08-03T08:00:00.000Z"),
      "Asia/Riyadh",
    )).toBe(2);
  });
});