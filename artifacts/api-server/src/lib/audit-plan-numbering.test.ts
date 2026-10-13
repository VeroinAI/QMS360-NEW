import { describe, expect, it } from "vitest";
import { defaultPlanNumberPattern, formatPlanNumber, planNumberState, planNumberYear, validatePlanNumberPattern } from "./audit-plan-numbering";

describe("Audit Plan number formatting and calendar year", () => {
  it("inserts the automatic source between two literal text segments, two-digit year and padded numeric sequence", () => {
    expect(formatPlanNumber({ prefix: "AGH", middle: "AP", separator: "-", padding: 4 }, "CC100", 2027, 1)).toBe("AGH-CC100-AP-27-0001");
    expect(formatPlanNumber({ prefix: "AGH", middle: "AP", separator: "-", padding: 4 }, "engineering", 2026, 42)).toBe("AGH-engineering-AP-26-0042");
  });
  it("supports concatenation and empty optional text without changing the numeric sequence", () => {
    expect(formatPlanNumber({ prefix: "", middle: "", separator: "", padding: 1 }, "CC100", 2027, 12)).toBe("CC1002712");
  });
  it("reads the wall-clock From Date year rather than the creation year or timezone-converted date", () => {
    expect(planNumberYear("2027-01-01")).toBe(2027);
    expect(planNumberYear("2026-12-31T23:59:00-03:00")).toBe(2026);
  });
  it("supports leap days", () => expect(planNumberYear("2028-02-29")).toBe(2028));
  it.each([undefined, "", "tomorrow", "2027-02-29", "2026-13-01", "1899-01-01"])("rejects invalid Schedule From Date %s", value => {
    expect(() => planNumberYear(value)).toThrow(/From Date/);
  });
  it.each([0, 1.5, 13, NaN])("rejects invalid padding %s", padding => {
    expect(() => validatePlanNumberPattern({ ...defaultPlanNumberPattern, padding })).toThrow(/padding/);
  });
  it("does not allow executable or arbitrary placeholder syntax in literal format text", () => {
    expect(() => validatePlanNumberPattern({ ...defaultPlanNumberPattern, prefix: "{sql}" })).toThrow(/literal/);
  });
  it("defaults to empty per-scope per-year ranges, leaving other numbering configurations untouched", () => {
    const map = { lessons: { nextNumber: 100 }, audit_schedule_fields: { prefix: "KEEP" } };
    expect(planNumberState(map)).toEqual({ pattern: defaultPlanNumberPattern, ranges: {} });
    expect(map.lessons.nextNumber).toBe(100);
  });
});
