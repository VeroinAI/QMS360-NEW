import { describe, expect, it } from "vitest";
import { checklistDeletionBlockReason } from "@workspace/field-controls";

describe("Checklist deletion eligibility shared by UI and API", () => {
  it.each([{}, { auditFinding: null, evidenceIds: [] }, { auditFinding: "", result: "", evidenceIds: [] },
    { auditFinding: " ", result: "\n", evidenceIds: [] }])("allows deletion when both protected fields are empty (%j)", item => {
    expect(checklistDeletionBlockReason(item)).toBeNull();
  });
  it.each(["Minor NC", "Moderate NC", "Major NC", "OFI", "Not applicable"])("blocks the saved finding %s", auditFinding => {
    expect(checklistDeletionBlockReason({ auditFinding })).toContain("Audit Findings");
  });
  it("blocks evidence without a finding, including references to unavailable files", () => {
    expect(checklistDeletionBlockReason({ evidenceIds: ["missing-file"] })).toContain("Evidence");
  });
  it("blocks when both finding and evidence have been saved", () => {
    expect(checklistDeletionBlockReason({ auditFinding: "OFI", evidenceIds: ["evidence"] })).not.toBeNull();
  });
  it("protects historical findings stored in result even if auditFinding is blank", () => {
    expect(checklistDeletionBlockReason({ auditFinding: "", result: "Observation" })).toContain("Audit Findings");
  });
  it("excludes finding-only records from checklist deletion", () => {
    expect(checklistDeletionBlockReason({ source: "finding" })).not.toBeNull();
  });
});
