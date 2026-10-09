import { describe, expect, it } from "vitest";
import { submissionMemoDefaults } from "./submission-memo-defaults";

describe("Audit Schedule submission memo defaults", () => {
  it("prefills new submissions from organization text values", () => {
    expect(submissionMemoDefaults({ from: "Quality Department", to: "All BU's, Function Heads and PM's" }, {}))
      .toEqual({ from: "Quality Department", to: "All BU's, Function Heads and PM's" });
  });
  it("uses current configured values on resubmission instead of obsolete defaults", () => {
    expect(submissionMemoDefaults({ from: "Updated department", to: "Updated audience" }, {
      submissionFrom: "Previous department", submissionTo: "Previous audience",
    })).toEqual({ from: "Updated department", to: "Updated audience" });
  });
  it("retains saved headings independently when a default is empty", () => {
    expect(submissionMemoDefaults({ from: "", to: "New audience" }, {
      submissionFrom: "Custom sender heading", submissionTo: "Previous audience",
    })).toEqual({ from: "Custom sender heading", to: "New audience" });
  });
  it("keeps unset defaults and unsaved headings blank", () => {
    expect(submissionMemoDefaults({ from: "", to: "" }, {})).toEqual({ from: "", to: "" });
  });
  it("trims values without changing the source objects", () => {
    const defaults = { from: "  Quality  ", to: "  Department heads  " };
    const previous = { submissionFrom: "Previous" };
    expect(submissionMemoDefaults(defaults, previous)).toEqual({ from: "Quality", to: "Department heads" });
    expect(defaults.from).toBe("  Quality  ");
    expect(previous.submissionFrom).toBe("Previous");
  });
});
