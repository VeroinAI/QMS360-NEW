import { describe, expect, it } from "vitest";
import { dailyDashboard, type DashboardReport } from "./qaqc-consolidated-daily";
import { monthlyDashboard } from "./qaqc-consolidated-monthly";

const project = { id: "p", name: "Project A", bu: "Construction", costCentre: "101",
  targets: { external_ncr: 80, internal_ncr: 80, rfi: 80, rmi: 80, pqi: 85 } };
const unavailable = { lessons: false, audit: false };
function report(patch: Partial<DashboardReport> = {}): DashboardReport {
  return { id: "r", projectId: "p", reportType: "daily", period: "2026-10-20", state: "approved",
    data: {}, baseline: {}, computed: {}, ...patch };
}
function snapshot(approved: number, resubmit = 0) {
  return { disciplines: { drawings: { Civil: { approved, resubmit, rejected: 0, underReview: 0 } } },
    pending: { Client: { underReview: { over30: 7, days8To30: 2, upTo7: 1 } } },
    documentTypes: { Drawings: approved, IFR: 3 }, correspondence: { incoming: approved, outgoing: approved },
    revisions: { drawings: [{ name: "00", value: approved }, { name: "removed", value: 3 }] } };
}
function metric(issued: number, closed: number, monthlyRate = 90) {
  return { accumulatedIssued: issued, accumulatedClosed: closed, open: issued - closed, monthlyRate, target: 80 };
}
function monthly(patch: Partial<DashboardReport> = {}): DashboardReport {
  return report({ reportType: "monthly", period: "2026-10-01",
    computed: { pqi: { accumulated: 75, variance: -2 }, metrics: {
      external_ncr: metric(100, 50), internal_ncr: metric(0, 0), rfi: metric(0, 0), rmi: metric(0, 0),
    }, material: metric(5, 5) },
    data: { metrics: { external_ncr: { ageing: [{ bucket: "over45", count: 12 }] } } }, ...patch });
}
describe("consolidated daily dashboard", () => {
  it("uses latest approved snapshots, not sums over days or unapproved reports", () => {
    const result = dailyDashboard([report({ data: snapshot(10), period: "2026-10-19" }),
      report({ data: snapshot(20) }), report({ state: "submitted", data: snapshot(999) })], [project], "2026-10-20", null, "cumulative");
    expect(result.data.drawings.total).toBe(20);
    expect(result.data.pending[0].over30).toBe(7);
    expect(result.chosen).toHaveLength(1);
  });
  it("calculates end minus start, retains negative movement and does not change end-date bottlenecks", () => {
    const end = snapshot(8); end.revisions.drawings = [{ name: "00", value: 8 }];
    const result = dailyDashboard([report({ data: snapshot(10), period: "2026-10-19" }), report({ data: end })],
      [project], "2026-10-20", "2026-10-19", "movement");
    expect(result.data.drawings.total).toBe(-2);
    expect(result.data.revisions.find(row => row.name === "removed")?.drawingCount).toBe(-3);
    expect(result.data.bottlenecks[0].total).toBe(7);
    expect(result.data.pending[0].over30).toBe(7);
  });
  it("excludes an unanchored project from movement rather than assuming zero history", () => {
    const result = dailyDashboard([report({ data: snapshot(10) })], [project], "2026-10-20", "2026-10-01", "movement");
    expect(result.data.drawings.total).toBe(0);
    expect(result.warnings[0]).toContain("excluded");
    expect(result.data.bottlenecks[0].total).toBe(7);
  });
  it("uses the saved Yesterday baseline for single-day movement", () => {
    const result = dailyDashboard([report({ data: snapshot(15), baseline: snapshot(10) })], [project], "2026-10-20", null, "movement");
    expect(result.data.drawings.total).toBe(5);
  });
  it("keeps missing trend dates as null and actual daily movement as current minus yesterday", () => {
    const result = dailyDashboard([report({ data: snapshot(15), baseline: snapshot(10) })], [project], "2026-10-20", null, "cumulative");
    expect(result.data.trend.at(-1)?.drawings).toBe(5);
    expect(result.data.trend.at(-2)?.drawings).toBeNull();
  });
  it("retains legacy document types without relabelling IFR as RFI", () => {
    const result = dailyDashboard([report({ data: snapshot(10) })], [project], "2026-10-20", null, "cumulative");
    expect(result.data.documentTypes.find(row => row.name === "IFR")?.value).toBe(3);
    expect(result.data.documentTypes.find(row => row.name === "RFIs")?.value).toBe(0);
    expect(result.data.revisions[0].drawings).toBe(100);
  });
});
describe("consolidated monthly dashboard", () => {
  it("uses only approved monthly reports and the explicit PQI project target", () => {
    const result = monthlyDashboard([monthly(), monthly({ state: "submitted", computed: { pqi: { accumulated: 999 } } })],
      [project], "2026-10", [], [], unavailable);
    expect(result.quality.pqi).toBe(75);
    expect(result.quality.target).toBe(85);
    expect(result.quality.over45).toBe(12);
  });
  it("weights closure counts rather than averaging project percentages", () => {
    const second = monthly({ projectId: "q", computed: { metrics: { external_ncr: metric(10, 10) } } });
    const result = monthlyDashboard([monthly(), second], [project, { ...project, id: "q" }], "2026-10", [], [], unavailable);
    expect(result.quality.closure).toBe(54.55);
    expect(result.quality.categories[0].value).toBe(54.55);
    expect(result.quality.categories[1].value).toBe(100);
  });
  it("distinguishes no approved data from zero and unavailable cross-application data", () => {
    const result = monthlyDashboard([], [project], "2026-10", [], [], unavailable);
    expect(result.quality.pqi).toBeNull();
    expect(result.quality.closure).toBeNull();
    expect(result.lessons.logged).toBeNull();
    expect(result.audit.openNc).toBeNull();
  });
  it("includes finalized CSAT on survey date and excludes drafts", () => {
    const data = { ratings: { quality: 4, timeline: 4, communication: 4, professionalism: 4, valueForMoney: 4, issueHandling: 4 },
      recommend: "Yes", expectations: "Partially" };
    const result = monthlyDashboard([report({ reportType: "csat", state: "submitted", data }),
      report({ reportType: "csat", state: "draft", data }), report({ reportType: "csat", period: "2026-09-20", data })],
    [project], "2026-10", [], [], unavailable);
    expect(result.csat.responses).toBe(1);
    expect(result.csat.average).toBe(4);
    expect(result.csat.outcomes.find(row => row.name === "Partially")?.value).toBe(1);
  });
  it("escalates consecutive approved under-target months and stops at a gap", () => {
    const below = { metrics: { external_ncr: metric(10, 1, 10) } };
    const rows = ["10", "09", "08"].map(month => monthly({ period: `2026-${month}-01`, computed: below }));
    expect(monthlyDashboard(rows, [project], "2026-10", [], [], unavailable).scorecard[0].escalation).toBe("L2");
    expect(monthlyDashboard([rows[0], rows[2]], [project], "2026-10", [], [], unavailable).scorecard[0].monthsBelow).toBe(1);
  });
  it("counts approved lessons but includes submitted major negative escalations separately", () => {
    const rows = [{ projectId: "p", state: "approved", period: "2026-10", impact: "negative", severity: "Minor", repeated: true },
      { projectId: "p", state: "submitted", period: "2026-10", impact: "negative", severity: "Major", level: "P1" }];
    const result = monthlyDashboard([], [project], "2026-10", rows, [], { lessons: true, audit: false });
    expect(result.lessons.logged).toBe(1);
    expect(result.lessons.escalated).toBe(1);
    expect(result.lessons.repeated).toBe(100);
  });
  it("does not turn inaccessible project lanes into zero", () => {
    const result = monthlyDashboard([], [project], "2026-10", [], [], {
      lessons: true, audit: true, lessonsProjectIds: ["different-project"], auditProjectIds: ["different-project"],
    });
    expect(result.scorecard[0].negativeLessons).toBeNull();
    expect(result.scorecard[0].openNc).toBeNull();
  });
  it("carries older open audit findings/CARs forward without adding them to this month's audit plan", () => {
    const rows = [{ projectId: "p", period: "2026-09", conducted: true, major: 1, minor: 2, overdue: 1, openCars: 2, closedCars: 1, escalated: 1 }];
    const result = monthlyDashboard([], [project], "2026-10", [], rows, { lessons: false, audit: true });
    expect(result.audit.planned).toBe(0);
    expect(result.audit.openNc).toBe(3);
    expect(result.audit.overdue).toBe(1);
    expect(result.audit.cars.find(row => row.name === "Open · within date")?.value).toBe(1);
  });
});
