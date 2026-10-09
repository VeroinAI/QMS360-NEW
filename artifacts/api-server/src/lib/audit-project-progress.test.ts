import { describe, expect, it } from "vitest";
import { normalizeProjectProgress, projectProgressPhases, projectProgressTotalWeight, projectProgressVariance } from "@workspace/field-controls";

const rows = () => projectProgressPhases.map(([id]) => ({ id, weight: null as number | null, plan: null as number | null, actual: null as number | null, priorPeriod: null as number | null, remarks: "" }));
describe("Overall project progress", () => {
  it("provides all seven phases without fabricating manual values", () => {
    const result = normalizeProjectProgress(rows());
    expect(result.map(row => row.phase)).toEqual(projectProgressPhases.map(([, phase]) => phase));
    expect(result.every(row => row.weight === null && row.plan === null && row.actual === null && row.variance === null && row.priorPeriod === null)).toBe(true);
  });
  it.each([[10, 25, 15], [25, 10, -15], [0, 0, 0], [0.1, 0.3, 0.2]])("calculates Actual minus Plan: %s, %s => %s", (plan, actual, expected) => {
    expect(projectProgressVariance(plan, actual)).toBe(expected);
  });
  it("leaves variance blank if either input is blank", () => {
    expect(projectProgressVariance(null, 5)).toBeNull();
    expect(projectProgressVariance(5, undefined)).toBeNull();
  });
  it.each([0, 99.5, 100])("accepts total weight of %s%%", weight => {
    const input = rows(); input[0].weight = weight;
    expect(normalizeProjectProgress(input)[0].weight).toBe(weight);
  });
  it("accepts decimal weights totaling exactly 100%", () => {
    const input = rows(); [33.33, 33.33, 33.34].forEach((weight, i) => input[i].weight = weight);
    expect(projectProgressTotalWeight(input)).toBe(100);
    expect(normalizeProjectProgress(input)).toHaveLength(7);
  });
  it("rejects combined weight greater than 100%", () => {
    const input = rows(); input[0].weight = 60; input[1].weight = 40.01;
    expect(() => normalizeProjectProgress(input)).toThrow(/Total Weight.*100%/);
  });
  it("does not let rounded totals bypass the 100% cap", () => {
    const input = rows(); input[0].weight = 100; input[1].weight = 1e-11;
    expect(() => normalizeProjectProgress(input)).toThrow(/Total Weight/);
  });
  it.each(["weight", "plan", "actual", "priorPeriod"] as const)("rejects invalid %s values", field => {
    for (const value of [-1, NaN, Infinity]) {
      const input = rows(); input[0][field] = value;
      expect(() => normalizeProjectProgress(input)).toThrow(/non-negative/);
    }
  });
  it("treats Weight as a percentage without inventing percentage limits for other columns", () => {
    const input = rows(); input[0].weight = 100.1;
    expect(() => normalizeProjectProgress(input)).toThrow(/Weight/);
    input[0].weight = 50; input[0].actual = 500; input[0].plan = 400; input[0].priorPeriod = 350;
    expect(normalizeProjectProgress(input)[0]).toMatchObject({ weight: 50, actual: 500, plan: 400, priorPeriod: 350, variance: 100 });
  });
  it("rejects missing, duplicate and unknown phases", () => {
    expect(() => normalizeProjectProgress(rows().slice(0, 6))).toThrow(/seven/);
    const duplicate = rows(); duplicate[1].id = duplicate[0].id;
    expect(() => normalizeProjectProgress(duplicate)).toThrow(/once/);
    expect(() => normalizeProjectProgress([{ ...rows()[0], id: "unexpected" }])).toThrow(/valid phase/);
  });
  it("keeps remarks/prior period and recomputes rather than trusting supplied variance", () => {
    const input = rows().map(row => ({ ...row, variance: 9999 }));
    input[0].plan = 20; input[0].actual = 15; input[0].priorPeriod = 12; input[0].remarks = " Phase note ";
    const result = normalizeProjectProgress(input);
    expect(result[0]).toMatchObject({ priorPeriod: 12, remarks: "Phase note", variance: -5 });
    expect(input[0].variance).toBe(9999);
  });
});
