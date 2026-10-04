import { describe, expect, it } from "vitest";
import { parseFeedbackFilters } from "./feedback-filters";

describe("feedback list and export filters", () => {
  it("leaves all modules and statuses unrestricted when omitted", () => {
    expect(parseFeedbackFilters({})).toEqual({ module: undefined, resolutions: undefined });
  });
  it.each(["open", "hold", "resolved", "closed", "additional_info_required"])(
    "filters exact status %s", (resolution) => {
      expect(parseFeedbackFilters({ resolution }).resolutions).toEqual([resolution]);
    },
  );
  it("includes legacy reviewing entries under the displayed Reviewing status", () => {
    expect(parseFeedbackFilters({ resolution: "reviewing" }).resolutions)
      .toEqual(["reviewing", "additional_info_required"]);
  });
  it("combines module and status without removing either filter", () => {
    expect(parseFeedbackFilters({ module: "audit", resolution: "resolved" }))
      .toEqual({ module: "audit", resolutions: ["resolved"] });
  });
  it.each(["invalid", "", ["open"], { status: "open" }])("rejects invalid status %j", (resolution) => {
    expect(() => parseFeedbackFilters({ resolution })).toThrow("Invalid feedback status");
  });
  it("rejects invalid modules", () => {
    expect(() => parseFeedbackFilters({ module: "invalid" })).toThrow("Invalid feedback module");
  });
});