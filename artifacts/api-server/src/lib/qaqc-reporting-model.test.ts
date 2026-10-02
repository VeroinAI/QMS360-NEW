import { describe, expect, it } from "vitest";
import { buildMonthlyAssessment, calculateReport, subtractReportSnapshot, validateReportData } from "./qaqc-reporting-model";

describe("QA/QC SOW report model", () => {
  const fullMonthlyData = (closed = 2) => ({
    metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [
      key, { issued: 10, closed, ageing: key === "external_ncr" ? [{ bucket: "over45", count: 2 }] : [] },
    ])),
    material: { issued: 10, closed },
  });
  const reviewedMonth = (period: string, pqi: number, id = period) => ({
    id, period, createdAt: `${period}T12:00:00Z`,
    data: {
      metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [key, { issued: 10, closed: 5 }])),
      material: { issued: 10, closed: 5 },
    },
    computed: {
      metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [key, { monthlyRate: 50 }])),
      material: { monthlyRate: 50 },
      pqi: { accumulated: pqi },
    },
  });
  const escalationHistoryCases: Array<{ history: Array<{ id?: string; period: string; createdAt?: string | Date | null; computed: unknown; data?: unknown }> }> = [
    { history: [reviewedMonth("2025-03-01", 20)] },
    { history: [reviewedMonth("2025-02-01", 20), { period: "2025-03-01", computed: { pqi: { accumulated: 20 } }, data: {} }] },
    { history: [reviewedMonth("2025-05-01", 20)] },
  ];
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

  it("grounds signed category/PQI/material variances, NCR critical counts, and rankings in exact prior months", () => {
    const assessment = buildMonthlyAssessment({
      period: "2025-04-01", data: fullMonthlyData(), baseline: {}, targets: { pqi: 70 },
      history: [reviewedMonth("2025-02-01", 60), reviewedMonth("2025-03-01", 60)],
    });
    expect(assessment.monthOnMonthVariances).toEqual({
      external_ncr: -80, internal_ncr: -80, rfi: -80, rmi: -80, pqi: -80, material: -80,
    });
    expect(assessment.negativeCategories).toEqual(["external_ncr", "internal_ncr", "rfi", "rmi", "pqi", "material"]);
    expect(assessment.criticalNcrOver45).toEqual({ external: 2, internal: 0, total: 2 });
    expect(assessment.categoryRanking).toEqual({ best: "external_ncr", worst: "rmi" });
    expect(assessment.pqiEscalationRequired).toBe(true);
  });

  it("deduplicates reviewed periods deterministically and will not infer escalation from gaps or malformed/future history", () => {
    const assessment = buildMonthlyAssessment({
      period: "2025-04-01", data: fullMonthlyData(), baseline: {}, targets: { pqi: 70 },
      history: [
        reviewedMonth("2025-02-01", 80, "z"),
        reviewedMonth("2025-02-01", 20, "a"),
        reviewedMonth("2025-03-01", 30),
        reviewedMonth("2025-05-01", 10),
        { period: "2025-01-01", computed: { pqi: { accumulated: 10 } } },
        { id: "zz-malformed", period: "2025-03-01", computed: { pqi: { accumulated: 10 } }, data: {} },
      ],
    });
    expect(assessment.pqiThreeMonthEvidence.map((month) => month.accumulated)).toEqual([80, 30, 20]);
    expect(assessment.pqiEscalationRequired).toBe(false);
    expect(assessment.monthOnMonthVariances.external_ncr).toBe(-80);
  });

  it("uses accumulated-rate variances rather than monthly-rate changes and ranks material with the indicators", () => {
    const baseline = {
      metrics: Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [
        key, { accumulatedIssued: 100, accumulatedClosed: 20 },
      ])),
      material: { accumulatedIssued: 100, accumulatedClosed: 20 },
    };
    const priorMonth = reviewedMonth("2025-03-01", 20, "prior");
    priorMonth.computed.metrics = Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [key, { monthlyRate: 90 }]));
    priorMonth.computed.material.monthlyRate = 90;
    const assessment = buildMonthlyAssessment({
      period: "2025-04-01", data: fullMonthlyData(5), baseline, targets: { pqi: 70 },
      history: [priorMonth],
    });
    expect(assessment.computed.metrics.external_ncr.monthlyRate).toBe(50);
    expect(assessment.computed.metrics.external_ncr.accumulatedRate).toBeCloseTo(22.73, 2);
    expect(assessment.monthOnMonthVariances.external_ncr).toBe(2.73);
    expect(assessment.monthOnMonthVariances.pqi).toBe(2.73);
    expect(assessment.monthOnMonthVariances.material).toBe(2.73);
    expect(assessment.negativeCategories).toEqual([]);
    expect(assessment.categoryRanking).toEqual({ best: "external_ncr", worst: "rmi" });
  });

  it("includes accumulated material rate in category ranking", () => {
    const assessment = buildMonthlyAssessment({
      period: "2025-04-01",
      data: { ...fullMonthlyData(), material: { issued: 0, closed: 0 } },
      baseline: { material: { accumulatedIssued: 100, accumulatedClosed: 95 } },
      targets: {}, history: [],
    });
    expect(assessment.categoryRanking.best).toBe("material");
    expect(assessment.categoryRanking.best).not.toBe("pqi");
  });

  it.each(escalationHistoryCases)("requires exact valid consecutive reviewed periods for PQI escalation", ({ history }) => {
    const assessment = buildMonthlyAssessment({
      period: "2025-04-01", data: fullMonthlyData(2), baseline: {}, targets: { pqi: 70 }, history,
    });
    expect(assessment.pqiEscalationRequired).toBe(false);
    expect(assessment.pqiThreeMonthEvidence.some((month) => month.accumulated === null)).toBe(true);
  });

  it("does not rank or invent scores for incomplete category counts", () => {
    const assessment = buildMonthlyAssessment({
      period: "2025-04-01", data: { metrics: { external_ncr: { issued: 0, closed: 0 } } },
      baseline: {}, targets: { pqi: 70 }, history: [],
    });
    expect(assessment.categoryRanking).toEqual({ best: "external_ncr", worst: "external_ncr" });
    expect(assessment.dataCoverage.missingCurrentMetrics).toEqual(["internal_ncr", "rfi", "rmi"]);
    expect(assessment.pqiEscalationRequired).toBe(false);
    expect(assessment.monthOnMonthVariances.external_ncr).toBe(0);
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

  it("requires assessment confirmation only at submission for marked Metrics reports", () => {
    const unconfirmed = { assessmentConfirmationRequired: true, assessmentConfirmed: false };
    expect(validateReportData("monthly", unconfirmed, {}, false).valid).toBe(true);
    expect(validateReportData("monthly", unconfirmed, {}, true).errors).toContain("assessmentConfirmed must be true before submitting this Metrics report");
    expect(validateReportData("monthly", { assessmentConfirmationRequired: true, assessmentConfirmed: true }, {}, true).errors)
      .not.toContain("assessmentConfirmed must be true before submitting this Metrics report");
    expect(validateReportData("monthly", {}, {}, true).errors).not.toContain("assessmentConfirmed must be true before submitting this Metrics report");
  });

  it("rejects nonstandard QMS department values in SOW new-entry mode", () => {
    const result = validateReportData("monthly", {
      qmsDepartmentInput: "sow",
      qmsReports: [{ department: "Unlisted Department", type: "Policy", status: "Approved & Published" }],
    }, {}, false);
    expect(result.errors).toContain("qmsReports.0.department is invalid");
  });
});