import { describe, expect, it } from "vitest";
import { preserveFindingNumber } from "./audit-finding-number-repair";

describe("Historical finding number protection", () => {
  const prior = { id: "row", findingNumber: "FN-001", findingNumberScope: "project:x",
    findingNumberType: "Minor NC", findingNumberYear: 2026, findingNumberSequence: 1 };
  it("keeps all server-owned numbering values during ordinary checklist saves", () => {
    const request = { id: "row", question: "Edited question", findingNumber: "FORGED", findingNumberYear: 2050 };
    expect(preserveFindingNumber(request, prior)).toEqual({ ...prior, question: "Edited question" });
    expect(request.findingNumber).toBe("FORGED");
    expect(prior.findingNumber).toBe("FN-001");
  });
  it("rejects client numbering even for a new or previously unnumbered item", () => {
    expect(preserveFindingNumber(prior)).toEqual({ id: "row" });
    expect(preserveFindingNumber(prior, { id: "row" })).toEqual({ id: "row" });
  });
});
