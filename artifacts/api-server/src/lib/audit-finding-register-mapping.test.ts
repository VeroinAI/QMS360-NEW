import { describe, expect, it } from "vitest";
import { mapAuditFindingRegister as map, type FindingRegisterContext } from "./audit-finding-register-mapping";

const context = (extra: Partial<FindingRegisterContext> = {}): FindingRegisterContext => ({
  auditExecutionId: "execution", auditId: "QREF-01", auditTitle: "Audit title",
  projectDepartment: "Civil Department", auditTeamLeadId: "lead", auditTeamLeadName: "Lead name",
  fullVisibility: true, viewerId: "viewer", teamIds: [],
  names: new Map([["current", "Current assignee"], ["old", "Old assignee"]]),
  owners: new Map([["legacy", ["current", "old"]]]),
  label: (group, value) => group === "Audit Area" && value === "design_engg" ? "Design and engineering" : value,
  ...extra,
});

describe("Audit Finding register projection", () => {
  it("maps saved identifiers, clause, area labels and current assignment without defaulting risk", () => {
    const [row] = map([{ id: "item", findingNumber: "NCR-01", clause: "8.2", auditArea: "design_engg",
      description: "Saved description", auditFinding: "Major NC", actionTakerId: "current" }], [], context());
    expect(row).toMatchObject({ findingNumber: "NCR-01", auditId: "QREF-01", clauseReference: "8.2",
      auditArea: "Design and engineering", findingType: "Major NC", riskLevel: null,
      actionTakers: [{ id: "current", name: "Current assignee" }] });
  });
  it("deduplicates checklist mirrors and excludes inapplicable/removed sources without deleting history", () => {
    const result = map([{ id: "a", auditFinding: "OFI" }, { id: "a", auditFinding: "OFI" },
      { id: "b", auditFinding: "Not applicable", result: "Major NC" }, null, { id: "blank" }], [
      { id: "mirror", auditId: "execution", classification: "OFI", evidence: { sourceChecklistItemId: "a" } },
      { id: "removed", auditId: "execution", classification: "Major NC", evidence: { sourceChecklistItemId: "gone" } },
      { id: "legacy", auditId: "execution", classification: "Minor NC", riskLevel: "High", evidence: { clause: "9" } },
    ], context());
    expect(result).toHaveLength(2);
    expect(result[0]!.findingNumber).toBeNull();
    expect(result[1]).toMatchObject({ source: "legacy", riskLevel: "High", clauseReference: "9", auditArea: null });
    expect(result[1]!.actionTakers).toHaveLength(2);
  });
  it("uses saved mirror risk, not classification-based risk or an assumed low risk", () => {
    const result = map([{ id: "a", auditFinding: "Major NC" }], [
      { id: "mirror", auditId: "execution", classification: "Major NC", riskLevel: "Medium", evidence: { sourceChecklistItemId: "a" } },
    ], context());
    expect(result[0]!.riskLevel).toBe("Medium");
  });
  it("does not expose other assignees under own visibility or borrow a stale CAR owner", () => {
    const items = [{ id: "a", auditFinding: "Minor NC", actionTakerId: "current" }];
    expect(map(items, [], context({ fullVisibility: false, viewerId: "old",
      owners: new Map([["a", ["old"]]]) }))).toHaveLength(0);
    expect(map(items, [], context({ fullVisibility: false, viewerId: "current" }))).toHaveLength(1);
  });
  it("retains lead/team own visibility and scoped full visibility", () => {
    const items = [{ id: "a", auditFinding: "OFI" }];
    expect(map(items, [], context({ fullVisibility: false, viewerId: "lead" }))).toHaveLength(1);
    expect(map(items, [], context({ fullVisibility: false, teamIds: ["viewer"] }))).toHaveLength(1);
    expect(map(items, [], context({ fullVisibility: false }))).toHaveLength(0);
    expect(map(items, [], context())).toHaveLength(1);
  });
  it("does not replace missing historical fields with unrelated values or internal IDs", () => {
    const [row] = map([], [{ id: "legacy", auditId: "execution", classification: "OFI", riskLevel: null }], context());
    expect(row).toMatchObject({ findingNumber: null, auditArea: null, clauseReference: null, riskLevel: null });
    expect(row!.id).toBe("legacy:legacy");
  });
});
