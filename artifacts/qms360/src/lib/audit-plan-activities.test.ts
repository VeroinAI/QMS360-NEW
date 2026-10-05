import { describe, expect, it } from "vitest";
import { newPlanActivity, selectPlanActivity } from "./audit-plan-activities";
const first = { id: "first", section: "General", remarks: "Notes", auditeeId: "user",
  plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" };
const second = { ...first, id: "second", section: "Design", plannedStartDateTime: "2026-01-02T22:00", plannedEndDateTime: "2026-01-02T23:59" };
describe("Audit Plan activity form state", () => {
  it("preserves dates and auditees while copying master remarks on selection", () => {
    const rows = selectPlanActivity([first, second], "first", "Quality", "Copied master notes", false);
    expect(rows[0]).toEqual({ ...first, section: "Quality", remarks: "Copied master notes" });
    expect(rows[1]).toBe(second);
    expect(first.section).toBe("General");
  });
  it("does not overwrite administrator-locked remarks when changing a section", () => {
    expect(selectPlanActivity([first], "first", "Quality", "Copied master notes", true)[0]?.remarks).toBe("Notes");
  });
  it("adds a blank undated row without disturbing existing or derived legacy rows", () => {
    const legacy = { ...first, legacyDateTimeDerived: true };
    const rows = [legacy, second, newPlanActivity()];
    expect(rows[0]).toBe(legacy);
    expect(rows[1]).toBe(second);
    expect(rows[2]).not.toHaveProperty("plannedStartDateTime");
    expect(rows[2]).not.toHaveProperty("plannedEndDateTime");
    expect(rows[2]?.id).toBeTruthy();
  });
});