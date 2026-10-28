import { describe, expect, it, vi } from "vitest";
import { numberSubmittedFindings, unnumberedFindingType } from "./audit-submit-finding-numbers";

describe("Finding IDs on audit submission", () => {
  const issued = (sequence: number, type = "OFI") => ({
    findingNumber: `REF-${type}-25-${sequence}`, findingNumberScope: "project:p",
    findingNumberYear: 2025, findingNumberSequence: sequence, findingNumberType: type,
  });
  it("numbers checklist and old manual findings sequentially without changing their contents", async () => {
    const rows = [
      { id: "a", auditFinding: "OFI", evidenceIds: ["e"], riskLevel: "High" },
      { id: "b", auditFinding: "OFI", source: "finding", actionTakerId: "user" },
      { id: "c", result: "Major NC", findingDate: "2025-11-12" },
    ];
    let next = 0;
    const allocate = vi.fn(async type => issued(++next, type));
    const result = await numberSubmittedFindings(rows, allocate);
    expect(allocate.mock.calls.map(call => call[0])).toEqual(["OFI", "OFI", "Major NC"]);
    expect(result[0]).toMatchObject({ ...rows[0], findingNumber: "REF-OFI-25-1" });
    expect(result[1]).toMatchObject({ ...rows[1], findingNumber: "REF-OFI-25-2" });
    expect(result[2]).toMatchObject({ ...rows[2], findingNumberYear: 2025 });
    expect(rows[0]).not.toHaveProperty("findingNumber");
    expect(await numberSubmittedFindings(result, allocate)).toEqual(result);
    expect(allocate).toHaveBeenCalledTimes(3);
  });
  it("preserves existing IDs and excludes blank, unsupported and Not applicable results", async () => {
    const rows = [
      { id: "saved", auditFinding: "Minor NC", findingNumber: "EXISTING", findingNumberSequence: 99 },
      { id: "na", auditFinding: "Not applicable" }, { id: "empty" }, { id: "other", result: "Conforming" },
    ];
    const allocate = vi.fn(async () => issued(1));
    expect(await numberSubmittedFindings(rows, allocate)).toEqual(rows);
    expect(allocate).not.toHaveBeenCalled();
    expect(unnumberedFindingType({ auditFinding: "Moderate NC", findingNumber: " " })).toBe("Moderate NC");
  });
  it("propagates allocation failure so the caller's transaction cannot submit partially numbered findings", async () => {
    const rows = [{ id: "first", auditFinding: "OFI" }, { id: "second", auditFinding: "Minor NC" }];
    const allocate = vi.fn().mockResolvedValueOnce(issued(1)).mockRejectedValueOnce(new Error("Number collision"));
    await expect(numberSubmittedFindings(rows, allocate)).rejects.toThrow("Number collision");
    expect(rows.every(row => !("findingNumber" in row))).toBe(true);
  });
});
