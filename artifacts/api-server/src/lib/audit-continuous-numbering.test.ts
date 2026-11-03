import { describe, expect, it } from "vitest";
import { continuousLastUsed, continuousRanges, validateLastNumber } from "./audit-continuous-numbering";
import { defaultPlanNumberPattern, nextPlanNumber, planNumberState } from "./audit-plan-numbering";
import { reportNumberState } from "./audit-report-numbering";
import { carNumberState } from "./audit-car-numbering";
import { findingNumberState } from "./audit-finding-numbering";
import { UpdateAuditPlanNumberRangeBody, UpdateAuditReportNumberRangeBody,
  UpdateAuditFindingNumberRangeBody, UpdateAuditCarNumberRangeBody } from "@workspace/api-zod";

describe("Continuous Audit counters", () => {
  const source = { key: "project:p", sourceValue: "CTR100" };
  it("starts a fresh source at 1 and never includes the year in its number", () => {
    const state = { pattern: defaultPlanNumberPattern, ranges: {} };
    for (const year of [2026, 2027, 2035]) {
      expect(nextPlanNumber(state, source, year)).toEqual({ sequence: 1, number: "AP-CTR100-0001" });
    }
  });
  it("continues above the highest legacy year, including out-of-order and future-dated audits", () => {
    const state = { pattern: defaultPlanNumberPattern, ranges: {
      [source.key]: { "2025": 125, "2026": 12, "2030": 20, continuous: 90 },
    } };
    for (const year of [2025, 2026, 2027, 2031]) expect(nextPlanNumber(state, source, year).sequence).toBe(126);
    state.ranges[source.key].continuous = 126;
    expect(nextPlanNumber(state, source, 2035)).toEqual({ sequence: 127, number: "AP-CTR100-0127" });
    expect(nextPlanNumber(state, { key: "department:d", sourceValue: "001" }, 2035).sequence).toBe(1);
  });
  it.each([
    ["audit_plan_numbering", planNumberState],
    ["audit_report_numbering", reportNumberState],
    ["audit_car_numbering", carNumberState],
  ] as const)("normalizes %s without mutating saved history or other configuration", (key, read) => {
    const map = { [key]: { ranges: { [source.key]: { "2025": 125, "2026": 12 } } }, lessons: { counter: 90 } };
    const original = JSON.stringify(map);
    expect(read(map).ranges[source.key]).toEqual({ "2025": 125, "2026": 12, continuous: 125 });
    expect(JSON.stringify(map)).toBe(original);
  });
  it("keeps finding-type and source high-water marks independent", () => {
    const state = findingNumberState({ audit_finding_numbering: { ranges: {
      "Major NC": { "project:p": { "2025": 125, "2026": 12 } },
      "Minor NC": { "project:p": { "2025": 2 }, "department:d": { "2026": 9 } },
    } } });
    expect(state.ranges["Major NC"]["project:p"].continuous).toBe(125);
    expect(state.ranges["Minor NC"]["project:p"].continuous).toBe(2);
    expect(state.ranges["Minor NC"]["department:d"].continuous).toBe(9);
  });
  it("allows a last-used counter of zero or the same value, but never a rewind", () => {
    expect(() => validateLastNumber(0, 0)).not.toThrow();
    expect(() => validateLastNumber(125, 125)).not.toThrow();
    expect(() => validateLastNumber(124, 125)).toThrow("cannot be below 125");
    for (const invalid of [-1, 1.5, NaN, Infinity, 999_999_999_999]) expect(() => validateLastNumber(invalid, 0)).toThrow();
  });
  it("rejects corrupt or exhausted counters instead of restarting at one", () => {
    for (const value of [-1, 1.5, NaN]) expect(() => continuousLastUsed({ "2026": value })).toThrow();
    expect(() => nextPlanNumber({ pattern: defaultPlanNumberPattern,
      ranges: { [source.key]: { continuous: 999_999_999_999 } } }, source, 2027)).toThrow("exhausted");
    expect(continuousRanges()).toEqual({});
  });
  it.each([UpdateAuditPlanNumberRangeBody, UpdateAuditReportNumberRangeBody, UpdateAuditCarNumberRangeBody])(
    "accepts yearless last-used range maintenance in the API contract", schema => {
      expect(schema.parse({ scope: source.key, lastNumber: 125 })).toEqual({ scope: source.key, lastNumber: 125 });
      expect(schema.safeParse({ scope: source.key, year: 2026, nextNumber: 126 }).success).toBe(false);
    });
  it("retains the required finding type with the yearless last-used contract", () => {
    expect(UpdateAuditFindingNumberRangeBody.parse({ scope: source.key, findingType: "Major NC", lastNumber: 125 }))
      .toEqual({ scope: source.key, findingType: "Major NC", lastNumber: 125 });
    expect(UpdateAuditFindingNumberRangeBody.safeParse({ scope: source.key, lastNumber: 125 }).success).toBe(false);
  });
});
