import { describe, expect, it } from "vitest";
import { applyCsatNumbering, csatNumberState, validateCsatPattern } from "./csat-numbering";

describe("CSAT configuration-only number ranges", () => {
  it("defaults independently without affecting other module settings", () => {
    const map = { qaqc: { nextNumber: 12 }, audit_plan_numbering: { ranges: { p: { "2026": 9 } } } };
    expect(csatNumberState(map)).toEqual({ pattern: { prefix: "CSAT", separator: "-", padding: 4 }, ranges: {} });
    expect(map.qaqc.nextNumber).toBe(12);
  });
  it("maintains last-used counters independently by project and full year", () => {
    const state = csatNumberState(undefined);
    const first = applyCsatNumbering(state, undefined, { projectId: "p1", year: 2026, lastNumber: 125 });
    const second = applyCsatNumbering(first, undefined, { projectId: "p2", year: 2026, lastNumber: 8 });
    const third = applyCsatNumbering(second, undefined, { projectId: "p1", year: 2027, lastNumber: 0 });
    expect(third.ranges).toEqual({ p1: { "2026": 125, "2027": 0 }, p2: { "2026": 8 } });
    expect(third.ranges.p1["2026"] + 1).toBe(126);
    expect(state.ranges).toEqual({});
  });
  it("preserves counters on format changes and does not issue numbers", () => {
    const state = applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p1", year: 2026, lastNumber: 125 });
    const next = applyCsatNumbering(state, { prefix: "AGH-CSAT", separator: "/", padding: 6 });
    expect(next.ranges).toEqual(state.ranges);
    expect(next.pattern.prefix).toBe("AGH-CSAT");
  });
  it("allows unchanged last-used values but prevents backwards movement", () => {
    const state = applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p1", year: 2026, lastNumber: 125 });
    expect(() => applyCsatNumbering(state, undefined, { projectId: "p1", year: 2026, lastNumber: 124 })).toThrow(/cannot be below 125/);
    expect(applyCsatNumbering(state, undefined, { projectId: "p1", year: 2026, lastNumber: 125 }).ranges).toEqual(state.ranges);
  });
  it.each([-1, 1.5, NaN, 999999999999])("rejects invalid last-used value %s", lastNumber => {
    expect(() => applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p", year: 2026, lastNumber })).toThrow(/whole last-used/);
  });
  it.each([1899, 10000, 2026.5])("rejects invalid year %s", year => {
    expect(() => applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p", year, lastNumber: 0 })).toThrow(/four-digit/);
  });
  it.each([0, 13, 1.5])("rejects invalid padding %s", padding => {
    expect(() => validateCsatPattern({ prefix: "CSAT", separator: "-", padding })).toThrow(/padding/);
  });
  it("rejects arbitrary template expressions and newlines", () => {
    expect(() => validateCsatPattern({ prefix: "{project}", separator: "-", padding: 4 })).toThrow(/literal/);
    expect(() => validateCsatPattern({ prefix: "CSAT", separator: "\n", padding: 4 })).toThrow(/literal/);
  });
});
