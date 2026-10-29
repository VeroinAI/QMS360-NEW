import { describe, expect, it } from "vitest";
import { DAILY_ADDITIONS, dailyDisciplineSnapshot } from "@workspace/field-controls";
import { calculateReport, DISCIPLINES } from "./qaqc-reporting-model";
import { dailyDashboard, type DashboardReport } from "./qaqc-consolidated-daily";
const grid = (counts: number[]) => Object.fromEntries(["drawings", "submittals"].map(category => [category,
  Object.fromEntries(DISCIPLINES.map(name => [name, Object.fromEntries(["approved", "resubmit", "rejected", "underReview"].map((status, i) => [status, counts[i]]))])),
]));
const opening = { disciplines: grid([25, 25, 25, 25]), pending: { unchanged: 7 }, correspondence: { outgoing: 13 } };
const additions = (counts: number[]) => ({ dailyDisciplineInputMode: DAILY_ADDITIONS, disciplines: grid(counts), pending: { unchanged: 2 }, correspondence: { outgoing: 3 } });
const total = (data: Record<string, any>) => Object.values(data.disciplines.drawings.Civil).reduce<number>((sum, value) => sum + Number(value), 0);
describe("Daily additions are distinct from cumulative discipline snapshots", () => {
  it("carries the reviewed QA example from 100 + 12 to 112 across every discipline and category", () => {
    const snapshot = dailyDisciplineSnapshot(additions([5, 2, 1, 4]), opening);
    for (const category of ["drawings", "submittals"]) for (const discipline of DISCIPLINES)
      expect(snapshot.disciplines[category][discipline]).toEqual({ approved: 30, resubmit: 27, rejected: 26, underReview: 29 });
    expect(total(snapshot)).toBe(112);
    expect(snapshot.pending).toEqual({ unchanged: 2 });
    expect(snapshot.correspondence).toEqual({ outgoing: 3 });
  });
  it("carries a subsequent 16 forward to 128 without adding historical opening a second time", () => {
    const yesterday = dailyDisciplineSnapshot(additions([5, 2, 1, 4]), opening);
    const today = additions([4, 4, 4, 4]);
    const result = dailyDisciplineSnapshot(today, yesterday);
    expect(total(result)).toBe(128);
    for (let i = 0; i < 10; i++) expect(dailyDisciplineSnapshot(today, yesterday)).toEqual(result);
    expect(dailyDisciplineSnapshot(result, yesterday)).toEqual(result);
    expect(total(yesterday)).toBe(112);
    expect(total(opening)).toBe(100);
    expect(total(today)).toBe(16);
  });
  it("preserves yesterday for explicit zero additions and starts without history at zero", () => {
    expect(total(dailyDisciplineSnapshot(additions([0, 0, 0, 0]), opening))).toBe(100);
    expect(total(dailyDisciplineSnapshot(additions([5, 2, 1, 4])))).toBe(12);
  });
  it("does not silently reinterpret unmarked historical snapshots or alter unrelated report sections", () => {
    const legacy = { disciplines: grid([5, 2, 1, 4]) };
    expect(dailyDisciplineSnapshot(legacy, opening)).toBe(legacy);
    expect(total(dailyDisciplineSnapshot(legacy, opening))).toBe(12);
    const computed = calculateReport("daily", additions([5, 2, 1, 4]), opening) as any;
    expect(computed.disciplineTotals["drawings.Civil"]).toBe(112);
    expect(computed.correspondence).toEqual({ outgoing: 3 });
  });
  it("keeps missing draft counts missing instead of silently filling them with yesterday", () => {
    const incomplete = additions([5, 2, 1, 4]);
    delete (incomplete.disciplines.drawings.Civil as any).approved;
    expect(dailyDisciplineSnapshot(incomplete, opening).disciplines.drawings.Civil.approved).toBeUndefined();
  });
  it("uses cumulative snapshots for approved dashboards and daily additions for movements", () => {
    const data = additions([5, 2, 1, 4]);
    const row: DashboardReport = { id: "row", projectId: "p", reportType: "daily", period: "2026-10-26", state: "approved", data, baseline: opening, computed: calculateReport("daily", data, opening) };
    const projects = [{ id: "p", name: "Project" }];
    const cumulative = dailyDashboard([row], projects, "2026-10-26", null, "cumulative");
    expect(cumulative.data.drawings.total).toBe(112 * DISCIPLINES.length);
    const movement = dailyDashboard([row], projects, "2026-10-26", null, "movement");
    expect(movement.data.drawings.total).toBe(12 * DISCIPLINES.length);
    expect(movement.data.trend.at(-1)?.drawings).toBe(12 * DISCIPLINES.length);
    expect(data.disciplines.drawings.Civil).toEqual({ approved: 5, resubmit: 2, rejected: 1, underReview: 4 });
  });
});
