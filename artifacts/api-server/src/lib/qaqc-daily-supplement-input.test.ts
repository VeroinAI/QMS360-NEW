import { describe, expect, it } from "vitest";
import { DAILY_ADDITIONS, DAILY_SUPPLEMENT_ADDITIONS, dailyDisciplineSnapshot } from "@workspace/field-controls";
import { calculateReport } from "./qaqc-reporting-model";
import { dailyDashboardData } from "./qaqc-daily-dashboard-data";

const input = (count: number, tagged = true): any => ({
  ...(tagged ? { dailySupplementInputMode: DAILY_SUPPLEMENT_ADDITIONS } : {}),
  documentTypes: { drawing: count, materials: count, calculation: count, general: count },
  correspondence: { incoming: count, outgoing: count },
  rejectedSubmissions: { drawing: count, materials: count, calculation: count, general: count },
  revisions: { drawings: [{ name: "Rev 0", value: count }], submittals: [{ name: "Rev 0", value: count }] },
  pending: { client: { review: { days0to15: count } } },
});

describe("Daily additions for document types, revisions, correspondence and rejected submissions", () => {
  it("carries 100 + 12 to 112, then +16 to 128, without changing raw entries or adding opening twice", () => {
    const opening = input(100, false), today = input(12);
    const saved = structuredClone(today);
    const end = dailyDisciplineSnapshot(today, opening);
    for (const field of ["documentTypes", "correspondence", "rejectedSubmissions"])
      expect(Object.values(end[field])).toEqual(Object.values(today[field]).map(() => 112));
    for (const category of ["drawings", "submittals"]) expect(end.revisions[category][0].value).toBe(112);
    expect(end.pending).toBe(today.pending);
    expect(today).toEqual(saved);
    expect(dailyDisciplineSnapshot(end, opening)).toEqual(end);
    for (let i = 0; i < 5; i++) expect(dailyDisciplineSnapshot(today, opening)).toEqual(end);
    const next = dailyDisciplineSnapshot(input(16), end);
    expect(next.documentTypes.drawing).toBe(128);
    expect(next.correspondence.incoming).toBe(128);
    expect(next.rejectedSubmissions.materials).toBe(128);
    expect(next.revisions.drawings[0].value).toBe(128);
    expect(next.pending.client.review.days0to15).toBe(16);
  });
  it("matches revisions by normalized name within each category and retains prior-only rows", () => {
    const baseline = input(100, false), today = input(12);
    baseline.revisions.drawings.push({ name: "Rev 1", value: 40 });
    baseline.revisions.submittals[0].value = 200;
    today.revisions.drawings[0].name = " rev 0 ";
    today.revisions.drawings.push({ name: "Rev 2", value: 7 });
    const output = dailyDisciplineSnapshot(today, baseline);
    expect(output.revisions.drawings).toEqual([
      { name: " rev 0 ", value: 112 }, { name: "Rev 2", value: 7 }, { name: "Rev 1", value: 40 },
    ]);
    expect(output.revisions.submittals[0].value).toBe(212);
    expect(baseline.revisions.drawings[0].value).toBe(100);
  });
  it("handles zero additions, missing openings and incomplete drafts", () => {
    const today = input(0);
    expect(dailyDisciplineSnapshot(today, input(100, false)).correspondence.incoming).toBe(100);
    expect(dailyDisciplineSnapshot(input(12)).documentTypes.drawing).toBe(12);
    today.documentTypes.drawing = undefined;
    today.revisions.drawings[0].value = undefined;
    const output = dailyDisciplineSnapshot(today, input(100, false));
    expect(output.documentTypes.drawing).toBeUndefined();
    expect(output.revisions.drawings[0].value).toBeUndefined();
  });
  it("preserves legacy and discipline-only reports without reinterpreting their other tiles", () => {
    const old = input(12, false);
    expect(dailyDisciplineSnapshot(old, input(100, false))).toBe(old);
    const disciplineOnly = { ...old, dailyDisciplineInputMode: DAILY_ADDITIONS };
    expect(dailyDisciplineSnapshot(disciplineOnly, input(100, false)).correspondence.incoming).toBe(12);
  });
  it("calculates cumulative totals for all four tiles and retains raw data", () => {
    const today = input(12);
    const computed: any = calculateReport("daily", today, input(100, false));
    expect(computed.documentTypes.drawing).toBe(112);
    expect(computed.correspondence.incoming).toBe(112);
    expect(computed.rejectedSubmissions.general).toBe(112);
    expect(computed.revisions.submittals[0].value).toBe(112);
    expect(today.correspondence.incoming).toBe(12);
  });
  it("exports supplementary daily movement from cumulative snapshots rather than subtracting raw additions", () => {
    const data = input(12), baseline = input(100, false);
    const mapped = dailyDashboardData({
      id: "report", organizationId: "org", projectId: "project", projectName: "Example",
      reportType: "daily", period: "2026-10-29", state: "submitted", data, baseline,
      computed: calculateReport("daily", data, baseline),
    } as any);
    expect(mapped.values["Added CORRESPONDENCE chip 1 value"]).toBe("+12");
    expect(mapped.values["Added CORRESPONDENCE chip 2 value"]).toBe("+12");
    expect(mapped.values["Cum CORRESPONDENCE chip 1 value"]).toBe("112");
    expect(mapped.values["Cum CORRESPONDENCE chip 2 value"]).toBe("112");
  });
});
