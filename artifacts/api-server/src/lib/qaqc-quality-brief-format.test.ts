import { describe, expect, it } from "vitest";
import { conciseQualityBrief, qualityBriefEvidence, qualityBriefWithProject } from "./qaqc-quality-brief-format";

describe("Concise quality assessment format", () => {
  it("uses the saved project name as a deterministic bullet, never a model-generated identity", () => {
    expect(qualityBriefWithProject("- PQI: 86%.", " Example Project "))
      .toBe("- Project: Example Project\n- PQI: 86%.");
    expect(qualityBriefWithProject("- PQI: 86%.", undefined)).toBe("- PQI: 86%.");
  });
  it("rejects internal UUIDs and organization labels in generated text", () => {
    for (const draft of [
      "- Project: 17325f7f-72b8-46b3-8af2-5b2be6416be5",
      "- Organization: Example organization", "- Organisation: Example organization",
    ]) expect(qualityBriefWithProject(draft, "Example Project")).toBeNull();
  });
  it("removes nested identifiers and organization names without altering metrics or the source", () => {
    const input = {
      organizationId: "org-id", organizationName: "Organization", projectId: "project-id",
      projectName: "Example Project", data: { id: "report-id", total: 12, approved: 10 },
    };
    expect(qualityBriefEvidence(input)).toEqual({ projectName: "Example Project", data: { total: 12, approved: 10 } });
    expect(input.data.id).toBe("report-id");
  });
  it("preserves factual figures, units and bullet order", () => {
    const draft = "- PQI: 86%, up 0.2 percentage points.\n- External NCRs: 10 open; 2 exceed 45 days and are critical.";
    expect(conciseQualityBrief(draft)).toBe(draft);
  });
  it("normalizes bullet symbols and spacing without rewriting facts", () => {
    expect(conciseQualityBrief("  • PQI: 86%.\n\n • External NCRs: 10 open. "))
      .toBe("- PQI: 86%.\n- External NCRs: 10 open.");
  });
  it("allows a short insufficient-data statement without inventing numbers", () => {
    expect(conciseQualityBrief("- Available data is insufficient for a quality summary."))
      .toBe("- Available data is insufficient for a quality summary.");
  });
  it("rejects paragraphs, headings, empty drafts and more than six bullets", () => {
    for (const draft of ["", "Detailed analysis.", "Quality summary\n- PQI: 86%.", Array(7).fill("- Quality figure.").join("\n")]) {
      expect(conciseQualityBrief(draft)).toBeNull();
    }
  });
  it("enforces the 120-word limit without cutting off a sentence or critical finding", () => {
    expect(conciseQualityBrief(`- ${Array(120).fill("word").join(" ")}`)).not.toBeNull();
    expect(conciseQualityBrief(`- ${Array(121).fill("word").join(" ")}`)).toBeNull();
  });
});
