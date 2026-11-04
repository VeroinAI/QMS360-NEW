import { describe, expect, it } from "vitest";
import { projectDashboardDimensions } from "./qaqc-project-dimensions";

describe("Project Master dashboard classifications", () => {
  it("uses saved Additional Data values and trims whitespace", () => {
    expect(projectDashboardDimensions({ sbg: "old", projectGroup: "old", qmsAdditionalData: {
      sbg: " Construction ", bu: " Infrastructure ", projectGroup: " Central ",
    } })).toEqual({ sbg: "Construction", bu: "Infrastructure", projectGroup: "Central" });
  });
  it("never substitutes older source classifications for missing Additional Data", () => {
    expect(projectDashboardDimensions({ SBG: "Legacy SBG", sbg: "Source SBG",
      bu: "Source BU", businessUnit: "Legacy BU", project_group: "Legacy group", projectGroup: "Source group" }))
      .toEqual({ sbg: "Unassigned", bu: "Unassigned", projectGroup: "Unassigned" });
  });
  it("clearing saved values makes them Unassigned instead of restoring stale source data", () => {
    expect(projectDashboardDimensions({ sbg: "old", bu: "old", projectGroup: "old",
      qmsAdditionalData: { sbg: null, bu: "", projectGroup: " " } }))
      .toEqual({ sbg: "Unassigned", bu: "Unassigned", projectGroup: "Unassigned" });
  });
  it.each([null, undefined, {}, { qmsAdditionalData: null }])("handles projects without classification metadata", fields => {
    expect(projectDashboardDimensions(fields)).toEqual({ sbg: "Unassigned", bu: "Unassigned", projectGroup: "Unassigned" });
  });
  it("normalizes duplicate labels and supports combined project selection", () => {
    const rows = [
      { id: "1", ...projectDashboardDimensions({ qmsAdditionalData: { sbg: " A ", bu: "B", projectGroup: "G" } }) },
      { id: "2", ...projectDashboardDimensions({ qmsAdditionalData: { sbg: "A", bu: "C", projectGroup: "G" } }) },
      { id: "3", ...projectDashboardDimensions({ qmsAdditionalData: { sbg: "Other", bu: "B", projectGroup: "G" } }) },
    ];
    expect([...new Set(rows.map(row => row.sbg))]).toEqual(["A", "Other"]);
    expect(rows.filter(row => row.sbg === "A" && row.bu === "B" && row.projectGroup === "G").map(row => row.id)).toEqual(["1"]);
  });
});
