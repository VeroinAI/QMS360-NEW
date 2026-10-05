import { describe, expect, it } from "vitest";
import { auditPlanDateErrors, datedActivities, plannedDate, planActivityFieldValues } from "@workspace/field-controls";

const bounds = { plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02" };
const plan = {
  startDateTime: "2026-01-01T00:00", endDateTime: "2026-01-02T23:59:59",
  openingMeetingDateTime: "2026-01-01T08:00", closingMeetingDateTime: "2026-01-02T23:59",
};
const rows = [
  { id: "one", plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" },
  { id: "two", plannedStartDateTime: "2026-01-02T22:00", plannedEndDateTime: "2026-01-02T23:59:59" },
];
describe("Audit Plan calendar-date invariants", () => {
  it("accepts distinct ranges on both inclusive boundary days and end-of-day times", () => {
    expect(auditPlanDateErrors(plan, bounds, rows)).toEqual({});
    expect(auditPlanDateErrors(plan, bounds, rows.map(row => ({
      ...row, plannedStartDateTime: `${row.plannedStartDateTime}+14:00`, plannedEndDateTime: `${row.plannedEndDateTime}-12:00`,
    })))).toEqual({});
  });
  it.each(["", "bad", "2026-02-30T09:00", "2026-01-02T24:00", "2026-01-02T23:60", "2026-01-02"])(
    "rejects missing/malformed mandatory timestamps %s", value => {
      expect(auditPlanDateErrors(plan, bounds, [{ ...rows[0], plannedEndDateTime: value }]))
        .toHaveProperty("activity-one-plannedEndDateTime");
    });
  it("names the precise row and field for reversed or out-of-range dates", () => {
    expect(auditPlanDateErrors(plan, bounds, [{ ...rows[0], plannedEndDateTime: "2026-01-01T08:00" }]))
      .toHaveProperty("activity-one-plannedEndDateTime", expect.stringContaining("on or after"));
    const errors = auditPlanDateErrors({ ...plan, openingMeetingDateTime: "2025-12-31T23:59" }, bounds,
      [{ ...rows[1], plannedEndDateTime: "2026-01-03T00:00" }]);
    expect(errors.openingMeetingDateTime).toContain("inclusive");
    expect(errors["activity-two-plannedEndDateTime"]).toContain("inclusive");
  });
  it("rejects unavailable/invalid authoritative Audit bounds rather than supplying a year or parent range", () => {
    expect(auditPlanDateErrors(plan, {}, rows).scheduleId).toContain("unavailable");
    expect(auditPlanDateErrors(plan, { plannedStartDate: bounds.plannedEndDate, plannedEndDate: bounds.plannedStartDate }, rows).scheduleId)
      .toContain("invalid");
  });
  it("derives dates only from saved legacy data and never overrides explicit/partially missing row dates", () => {
    expect(datedActivities([{ id: "legacy" }], "2026-01-01T09:00")[0]).toMatchObject({
      plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T09:00", legacyDateTimeDerived: true,
    });
    expect(datedActivities([{ id: "missing" }])[0]).not.toHaveProperty("plannedStartDateTime");
    expect(datedActivities(rows, "2025-01-01T09:00")).toEqual(rows);
    const partial = datedActivities([{ ...rows[0], plannedEndDateTime: "" }], "2026-01-01T09:00");
    expect(auditPlanDateErrors(plan, bounds, partial)).toHaveProperty("activity-one-plannedEndDateTime");
  });
  it("projects every row into both field-control stores so second-row writes cannot bypass locks", () => {
    const first = planActivityFieldValues({ activities: rows });
    const changed = planActivityFieldValues({ activities: [rows[0], { ...rows[1], plannedEndDateTime: "2026-01-02T23:55" }] });
    expect(first.activityPlannedStartDateTime).toEqual(changed.activityPlannedStartDateTime);
    expect(first.activityPlannedEndDateTime).not.toEqual(changed.activityPlannedEndDateTime);
    expect(first.activityDateTime).not.toEqual(changed.activityDateTime);
  });
  it("does not shift explicit timestamp offsets across a calendar day", () => {
    expect(plannedDate("2026-01-02T23:59:59-12:00")).toBe("2026-01-02");
    expect(auditPlanDateErrors(plan, bounds, [{ id: "offsets",
      plannedStartDateTime: "2026-01-02T22:00+14:00", plannedEndDateTime: "2026-01-02T22:00-12:00",
    }])).toEqual({});
    expect(auditPlanDateErrors(plan, bounds, [{ id: "fractions",
      plannedStartDateTime: "2026-01-02T22:00:00.9", plannedEndDateTime: "2026-01-02T22:00:00.1",
    }])).toHaveProperty("activity-fractions-plannedEndDateTime");
  });
});