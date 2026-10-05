import { describe, expect, it } from "vitest";
import { buildConsolidatedAuditReport } from "./audit-consolidated-report";
const programme = (plan: Record<string, unknown>) => buildConsolidatedAuditReport({
  audit: {}, plan, legacyFindings: [], cars: [], evidence: [], names: new Map(), roleNames: new Map(),
}).find(section => section.key === "programme")!.tables[0]!;
describe("consolidated Audit activity date mapping", () => {
  it("shows independent start/end dates without repeating the shared first-row mirror", () => {
    const table = programme({ activityDateTime: "2026-01-01T09:00", activities: [
      { section: "General", plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" },
      { section: "Design", plannedStartDateTime: "2026-01-02T22:00", plannedEndDateTime: "2026-01-02T23:59" },
    ] });
    expect(table.columns.slice(0, 2)).toEqual(["Planned Start", "Planned End"]);
    expect(table.rows.map(row => row.slice(0, 2))).toEqual([
      ["2026-01-01T09:00", "2026-01-01T10:00"], ["2026-01-02T22:00", "2026-01-02T23:59"],
    ]);
  });
  it("labels actually saved legacy timestamps and never invents dates for missing/malformed values", () => {
    expect(programme({ activitySection: "Legacy", activityDateTime: "2026-01-01T09:00" }).rows[0]!.slice(0, 2))
      .toEqual(["2026-01-01T09:00 (derived legacy)", "2026-01-01T09:00 (derived legacy)"]);
    expect(programme({ activities: [{ section: "Missing", plannedEndDateTime: "invalid" }] }).rows[0]!.slice(0, 2))
      .toEqual(["To Be Mapped", "To Be Mapped"]);
  });
  it.each(["Z", "+14:00", "-12:00"])("preserves the saved activity calendar dates with %s suffixes", suffix => {
    const start = `2026-01-01T00:15${suffix}`, end = `2026-01-02T23:59${suffix}`;
    expect(programme({ activities: [{ section: "General", plannedStartDateTime: start, plannedEndDateTime: end }] })
      .rows[0]!.slice(0, 2)).toEqual([start, end]);
  });
});