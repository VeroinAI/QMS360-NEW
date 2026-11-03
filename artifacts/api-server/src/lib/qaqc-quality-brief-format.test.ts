import { describe, expect, it } from "vitest";
import { conciseQualityBrief } from "./qaqc-quality-brief-format";

describe("Concise quality assessment format", () => {
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
