import { describe, expect, it } from "vitest";
import { responseFieldLabel, responseFieldLabels } from "./response-field-labels";

describe("response field display labels", () => {
  it("uses the exact requested wording for field keys and legacy labels", () => {
    for (const label of ["rootCause", "Root Cause", "Root cause"]) {
      expect(responseFieldLabel(label)).toBe("Why Did It Happen? (Root Cause)");
    }
    expect(responseFieldLabel("Correction")).toBe("How can we rectify? (Correction)");
    for (const label of ["correctiveAction", "Corrective Action", "Corrective action"]) {
      expect(responseFieldLabel(label)).toBe("How It can Be Avoided in Future? (Corrective Action)");
    }
  });

  it("preserves recorded status and combined report-column meanings", () => {
    expect(responseFieldLabel("Corrective Action Recorded")).toBe(`${responseFieldLabels.correctiveAction} — Recorded`);
    expect(responseFieldLabel("Correction and corrective action")).toBe(`${responseFieldLabels.correction} / ${responseFieldLabels.correctiveAction}`);
  });

  it("leaves module names, workflow wording and unrelated labels unchanged", () => {
    for (const label of ["Corrective Action Register", "Corrective Action Report", "Sent back for correction", "Description", "Project"]) {
      expect(responseFieldLabel(label)).toBe(label);
    }
  });
});
