import { describe, expect, it } from "vitest";
import { findingForNumberRepair, preserveFindingNumber } from "./audit-finding-number-repair";

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
  it.each(["Minor NC", "Moderate NC", "Major NC", "OFI"])("accepts saved %s rows from checklist and finding-only origins", type => {
    for (const source of [undefined, "finding"]) {
      const item = { id: "row", source, auditFinding: type, evidenceIds: ["file"] };
      expect(findingForNumberRepair([item], "row")).toBe(item);
    }
  });
  it("does not number a missing row, Not applicable or an empty checklist shell", () => {
    expect(() => findingForNumberRepair([], "row")).toThrow("Finding not found");
    expect(() => findingForNumberRepair([{ id: "row", auditFinding: "Not applicable" }], "row")).toThrow("Only saved");
    expect(() => findingForNumberRepair([{ id: "row" }], "row")).toThrow("Only saved");
  });
});
