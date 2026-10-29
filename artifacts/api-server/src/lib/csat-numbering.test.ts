import { describe, expect, it } from "vitest";
import { allocateCsatReference, applyCsatNumbering, csatNumberState, csatReferenceYear, formatCsatReference, validateCsatPattern } from "./csat-numbering";
import { organizationSettings, projects, qaqcReportSubmissions } from "@workspace/db";
import { vi } from "vitest";

const locks = vi.hoisted(() => ({ settings: null as any }));
vi.mock("./audit-schedule-numbering", () => ({
  lockScheduleNumbering: vi.fn(async () => ({ settings: locks.settings })),
}));

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

describe("CSAT reference allocation", () => {
  const pattern = { prefix: "SURVEY", separator: "-", padding: 4 };
  it("uses the CSAT Date's full year, selected project code and next counter", () => {
    expect(formatCsatReference(pattern, "AGH-ALPHA", "2024-12-31", 126)).toBe("SURVEY-AGH-ALPHA-2024-0126");
    expect(formatCsatReference({ prefix: "", separator: "/", padding: 2 }, "BETA", "2025-01-01", 1)).toBe("BETA/2025/01");
  });
  it.each(["", "2023-02-29", "2024-13-01", "1899-12-31", "2026-01-01T23:00:00Z"])("rejects invalid CSAT date %s", date => {
    expect(() => csatReferenceYear(date)).toThrow(/CSAT Date/);
  });
  it("rejects missing project code and exhausted counters", () => {
    expect(() => formatCsatReference(pattern, "", "2024-12-31", 1)).toThrow(/Project Code/);
    expect(() => formatCsatReference(pattern, "A", "2024-12-31", 1e12)).toThrow(/exhausted/);
  });
  function fixture(collisions: number) {
    locks.settings = { id: "settings", documentNumbering: {
      qaqc: { nextNumber: 88 }, csat_reference_numbering: { pattern,
        ranges: { alpha: { "2024": 125 }, beta: { "2024": 20 } } },
    } };
    const updates: any[] = [];
    let collisionReads = 0;
    const tx: any = {
      select: () => {
        let table: any;
        const query: any = {
          from: (value: any) => { table = value; return query; },
          where: () => query, limit: () => query,
          then: (resolve: any, reject: any) => Promise.resolve(table === projects ? [{ code: "ALPHA" }] :
            table === qaqcReportSubmissions && collisionReads++ < collisions ? [{ id: "existing" }] : []).then(resolve, reject),
        };
        return query;
      },
      update: (table: any) => ({ set: (value: any) => ({ where: async () => {
        expect(table).toBe(organizationSettings);
        updates.push(value);
        locks.settings.documentNumbering = value.documentNumbering;
      } }) }),
    };
    return { tx, updates };
  }
  it("increments the saved project/year counter and preserves other settings", async () => {
    const { tx, updates } = fixture(0);
    expect(await allocateCsatReference(tx, "org", "alpha", "2024-12-31")).toBe("SURVEY-ALPHA-2024-0126");
    expect(updates[0].documentNumbering.qaqc).toEqual({ nextNumber: 88 });
    expect(updates[0].documentNumbering.csat_reference_numbering.ranges).toEqual({
      alpha: { "2024": 126 }, beta: { "2024": 20 },
    });
    expect(await allocateCsatReference(tx, "org", "alpha", "2025-01-01")).toBe("SURVEY-ALPHA-2025-0001");
  });
  it("never reuses an existing historical reference", async () => {
    const { tx, updates } = fixture(1);
    expect(await allocateCsatReference(tx, "org", "alpha", "2024-12-31")).toBe("SURVEY-ALPHA-2024-0127");
    expect(updates[0].documentNumbering.csat_reference_numbering.ranges.alpha["2024"]).toBe(127);
  });
});
