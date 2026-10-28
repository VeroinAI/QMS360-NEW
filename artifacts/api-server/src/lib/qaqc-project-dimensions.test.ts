import { describe, expect, it } from "vitest";
import { projectDashboardDimensions } from "./qaqc-project-dimensions";

describe("Project Master dashboard classifications", () => {
  it("uses saved QMS values before source classifications and trims whitespace", () => {
    expect(projectDashboardDimensions({ sbg: "old", projectGroup: "old", qmsAdditionalData: {
      sbg: " Construction ", bu: " Infrastructure ", projectGroup: " Central ",
    } }, "Source BU")).toEqual({ sbg: "Construction", bu: "Infrastructure", projectGroup: "Central" });
  });
  it("preserves existing source values until an additional-data field is maintained", () => {
    expect(projectDashboardDimensions({ SBG: "Legacy SBG", project_group: "Legacy group" }, "Source BU"))
      .toEqual({ sbg: "Legacy SBG", bu: "Source BU", projectGroup: "Legacy group" });
  });
  it("clearing saved values makes them Unassigned instead of restoring stale source data", () => {
    expect(projectDashboardDimensions({ sbg: "old", bu: "old", projectGroup: "old",
      qmsAdditionalData: { sbg: null, bu: "", projectGroup: " " } }, "old"))
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
