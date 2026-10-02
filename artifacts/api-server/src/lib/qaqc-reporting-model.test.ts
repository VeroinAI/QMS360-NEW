import { describe, expect, it } from "vitest";
import { calculateReport, subtractReportSnapshot, validateReportData } from "./qaqc-reporting-model";

describe("QA/QC SOW report model", () => {
  it("subtracts every snapshot field and named revisions, including removed revisions", () => {
    const movement = subtractReportSnapshot(
      { disciplines: { drawings: { Civil: { approved: 12, rejected: 1 } } }, revisions: { drawings: [{ name: "Rev 01", value: 8 }, { name: "Rev 02", value: 4 }] } },
      { disciplines: { drawings: { Civil: { approved: 10, rejected: 3 } } }, revisions: { drawings: [{ name: "Rev 00", value: 5 }, { name: "rev 01", value: 6 }] } },
    );
    expect(movement.disciplines.drawings.Civil).toEqual({ approved: 2, rejected: -2 });
    expect(movement.revisions.drawings).toEqual([{ name: "Rev 01", value: 2 }, { name: "Rev 02", value: 4 }, { name: "Rev 00", value: -5 }]);
  });
  it("calculates cumulative closure rate and variance against the previous cumulative rate", () => {
    const baseline = { metrics: { external_ncr: { accumulatedIssued: 10, accumulatedClosed: 5 } } };
    const data = { metrics: { external_ncr: { issued: 5, closed: 4 } } };
    const result = calculateReport("monthly", data, baseline, {}) as any;
    expect(result.metrics.external_ncr.accumulatedIssued).toBe(15);
    expect(result.metrics.external_ncr.accumulatedClosed).toBe(9);
    expect(result.metrics.external_ncr.accumulatedRate).toBe(60);
    expect(result.metrics.external_ncr.variance).toBe(10);
  });

  it("uses the active-project zero-issued closure rule and calculates PQI", () => {
    const data = { metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [key, { issued: 0, closed: 0 }])) };
    const result = calculateReport("monthly", data, {}, {}) as any;
    expect(result.metrics.rfi.monthlyRate).toBe(100);
    expect(result.pqi.monthly).toBe(100);
  });

  it("rejects monthly closes beyond available items and mismatched NCR ageing", () => {
    const result = validateReportData("monthly", {
      metrics: {
        external_ncr: { issued: 1, closed: 2, ageing: [{ department: "Civil", bucket: "0-15", count: 3 }] },
        internal_ncr: { issued: 0, closed: 0, ageing: [] },
        rfi: { issued: 0, closed: 0 }, rmi: { issued: 0, closed: 0 },
      },
    }, {}, true);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("closed exceeds available open items");
    expect(result.errors.join(" ")).toContain("ageing counts must equal open count");
  });

  it("requires the complete daily grid at submission", () => {
    const result = validateReportData("daily", { noUpdates: true }, {}, true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("disciplines.drawings.Civil.approved is required and must be a nonnegative integer");
    expect(result.errors).toContain("pending.Supplier.E.over30 is required and must be a nonnegative integer");
  });

  it("validates all six exact CSAT dimensions and calculates the mean", () => {
    const ratings = { quality: 5, timeline: 4, communication: 3, professionalism: 4, valueForMoney: 5, issueHandling: 3 };
    expect(validateReportData("csat", { ratings, expectations: "Yes", recommend: "Partially" }, {}, true).valid).toBe(true);
    expect((calculateReport("csat", { ratings }, {}, {}) as any).averageRating).toBe(4);
  });

  it("returns validation errors instead of crashing on missing narrative or malformed row arrays", () => {
    expect(() => validateReportData("monthly", {
      meetings: [null], manpower: [null], qmsReports: [null],
      metrics: { external_ncr: { ageing: [null] } },
    }, {}, true)).not.toThrow();
    const result = validateReportData("monthly", {}, {}, true);
    expect(result.errors).toContain("narrative is required");
  });

  it("allows partial draft manpower and enforces approval outcomes within headcount", () => {
    expect(validateReportData("monthly", { manpower: [{}] }, {}, false).valid).toBe(true);
    const result = validateReportData("monthly", {
      manpower: [{ department: "Civil", count: 2, approvalRequired: true, approved: 2, rejected: 1 }],
    }, {}, false);
    expect(result.errors).toContain("manpower.0 approved and rejected cannot exceed headcount");
  });

  it("does not require a PQP submitted date when a status supports the optional date field", () => {
    expect(validateReportData("monthly", { pqpStatus: "Under Review with Client" }, {}, false).valid).toBe(true);
  });
});