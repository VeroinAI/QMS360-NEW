import { describe, expect, it } from "vitest";
import { getUpdateNumberingPatternUrl, getResetNumberingPatternUrl } from "@workspace/api-client-react";

describe("Lessons numbering source survives generated client requests", () => {
  it.each(["Project", "Department"] as const)("includes %s on both save and reset", sourceType => {
    expect(getUpdateNumberingPatternUrl("lessons", { sourceType })).toBe(`/api/platform/numbering/lessons?sourceType=${sourceType}`);
    expect(getResetNumberingPatternUrl("lessons", { sourceType })).toBe(`/api/platform/numbering/lessons?sourceType=${sourceType}`);
  });

  it("keeps existing other-module requests unchanged", () => {
    expect(getUpdateNumberingPatternUrl("audit")).toBe("/api/platform/numbering/audit");
    expect(getResetNumberingPatternUrl("qaqc")).toBe("/api/platform/numbering/qaqc");
  });
});
