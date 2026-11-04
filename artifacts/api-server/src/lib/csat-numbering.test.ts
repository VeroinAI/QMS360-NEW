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
    expect(csatNumberState(map)).toEqual({ pattern: { prefix: "CSAT", middle: "", separator: "-", padding: 4 }, ranges: {} });
    expect(map.qaqc.nextNumber).toBe(12);
  });
  it("maintains continuous last-used counters independently by project", () => {
    const state = csatNumberState(undefined);
    const first = applyCsatNumbering(state, undefined, { projectId: "p1", lastNumber: 125 });
    const second = applyCsatNumbering(first, undefined, { projectId: "p2", lastNumber: 8 });
    const third = applyCsatNumbering(second, undefined, { projectId: "p1", lastNumber: 126 });
    expect(third.ranges).toEqual({ p1: { continuous: 126 }, p2: { continuous: 8 } });
    expect(third.ranges.p1.continuous + 1).toBe(127);
    expect(state.ranges).toEqual({});
  });
  it("preserves counters on format changes and does not issue numbers", () => {
    const state = applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p1", lastNumber: 125 });
    const next = applyCsatNumbering(state, { prefix: "AGH", middle: "CSAT", separator: "/", padding: 6 });
    expect(next.ranges).toEqual(state.ranges);
    expect(next.pattern.middle).toBe("CSAT");
  });
  it("allows unchanged last-used values but prevents backwards movement", () => {
    const state = applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p1", lastNumber: 125 });
    expect(() => applyCsatNumbering(state, undefined, { projectId: "p1", lastNumber: 124 })).toThrow(/cannot be below 125/);
    expect(applyCsatNumbering(state, undefined, { projectId: "p1", lastNumber: 125 }).ranges).toEqual(state.ranges);
  });
  it.each([-1, 1.5, NaN, 999999999999])("rejects invalid last-used value %s", lastNumber => {
    expect(() => applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "p", lastNumber })).toThrow(/whole last-used/);
  });
  it("rejects an empty project", () => {
    expect(() => applyCsatNumbering(csatNumberState(undefined), undefined, { projectId: "", lastNumber: 0 })).toThrow(/Select a project/);
  });
  it("retains the highest former yearly value without changing saved configuration", () => {
    const saved = { csat_reference_numbering: { ranges: { p: { "2025": 125, "2026": 12 } } } };
    const state = csatNumberState(saved);
    expect(state.pattern.middle).toBe("");
    expect(state.ranges.p).toEqual({ "2025": 125, "2026": 12, continuous: 125 });
    expect(saved.csat_reference_numbering.ranges.p).not.toHaveProperty("continuous");
    expect(() => applyCsatNumbering(state, undefined, { projectId: "p", lastNumber: 124 })).toThrow(/cannot be below 125/);
  });
  it.each([0, 13, 1.5])("rejects invalid padding %s", padding => {
    expect(() => validateCsatPattern({ prefix: "CSAT", middle: "", separator: "-", padding })).toThrow(/padding/);
  });
  it("rejects arbitrary template expressions and newlines", () => {
    expect(() => validateCsatPattern({ prefix: "{project}", middle: "", separator: "-", padding: 4 })).toThrow(/literal/);
    expect(() => validateCsatPattern({ prefix: "CSAT", middle: "", separator: "\n", padding: 4 })).toThrow(/literal/);
    expect(() => validateCsatPattern({ prefix: "CSAT", middle: "{year}", separator: "-", padding: 4 })).toThrow(/literal/);
  });
});

describe("CSAT reference allocation", () => {
  const pattern = { prefix: "SURVEY", middle: "CSAT", separator: "-", padding: 4 };
  it("uses prefix, contract / project number, middle text and counter without a year", () => {
    expect(formatCsatReference(pattern, " CTR100 ", "2024-12-31", 126)).toBe("SURVEY-CTR100-CSAT-0126");
    expect(formatCsatReference({ prefix: "", middle: "", separator: "/", padding: 2 }, "BETA", "2025-01-01", 1)).toBe("BETA/01");
  });
  it.each(["", "2023-02-29", "2024-13-01", "1899-12-31", "2026-01-01T23:00:00Z"])("rejects invalid CSAT date %s", date => {
    expect(() => csatReferenceYear(date)).toThrow(/CSAT Date/);
  });
  it("rejects missing contract / project number and exhausted counters", () => {
    expect(() => formatCsatReference(pattern, "", "2024-12-31", 1)).toThrow(/Contract \/ project no./);
    expect(() => formatCsatReference(pattern, "A", "2024-12-31", 1e12)).toThrow(/exhausted/);
  });
  function fixture(collisions: number, customFields: Record<string, unknown> = { qmsAdditionalData: { contractProjectNumber: " CTR100 " } }) {
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
          then: (resolve: any, reject: any) => Promise.resolve(table === projects ? [{ code: "ALPHA", customFields }] :
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
  it("increments the continuous project counter across years and preserves other settings", async () => {
    const { tx, updates } = fixture(0);
    expect(await allocateCsatReference(tx, "org", "alpha", "2024-12-31")).toBe("SURVEY-CTR100-CSAT-0126");
    expect(updates[0].documentNumbering.qaqc).toEqual({ nextNumber: 88 });
    expect(updates[0].documentNumbering.csat_reference_numbering.ranges).toEqual({
      alpha: { "2024": 125, continuous: 126 }, beta: { "2024": 20, continuous: 20 },
    });
    expect(await allocateCsatReference(tx, "org", "alpha", "2025-01-01")).toBe("SURVEY-CTR100-CSAT-0127");
  });
  it("never reuses an existing historical reference", async () => {
    const { tx, updates } = fixture(1);
    expect(await allocateCsatReference(tx, "org", "alpha", "2024-12-31")).toBe("SURVEY-CTR100-CSAT-0127");
    expect(updates[0].documentNumbering.csat_reference_numbering.ranges.alpha.continuous).toBe(127);
  });
  it.each([{}, { qmsAdditionalData: { contractProjectNumber: " " } }])("does not fall back to project code when the contract number is missing", async customFields => {
    const { tx, updates } = fixture(0, customFields);
    await expect(allocateCsatReference(tx, "org", "alpha", "2024-12-31")).rejects.toThrow(/Additional Data/);
    expect(updates).toEqual([]);
    expect(locks.settings.documentNumbering.csat_reference_numbering.ranges.alpha["2024"]).toBe(125);
  });
});
