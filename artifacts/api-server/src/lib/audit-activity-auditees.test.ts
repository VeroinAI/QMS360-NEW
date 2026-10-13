import { describe, expect, it } from "vitest";
import { auditActivityAuditeeIds, hasAuditActivityAuditeeSelection } from "@workspace/field-controls";

describe("Audit Plan activity auditee selections", () => {
  it("accepts selected roles when no schedule users exist or the removed user column is empty", () => {
    for (const activity of [
      { roleIds: ["audit-role"], auditeeId: "" },
      { roleIds: ["audit-role"], auditeeId: "", auditeeIds: [] },
      { roleIds: ["audit-role"] },
    ]) {
      expect(hasAuditActivityAuditeeSelection(activity)).toBe(true);
      expect(auditActivityAuditeeIds(activity)).toEqual([]);
    }
  });
  it("preserves assigned, manually selected and legacy auditees", () => {
    expect(auditActivityAuditeeIds({ roleIds: ["role"], auditeeIds: ["one", "two"], auditeeId: "one" })).toEqual(["one", "two"]);
    expect(hasAuditActivityAuditeeSelection({ auditeeIds: ["manual"] })).toBe(true);
    expect(hasAuditActivityAuditeeSelection({ auditeeId: "legacy" })).toBe(true);
    expect(auditActivityAuditeeIds({ auditeeId: "legacy" })).toEqual(["legacy"]);
  });
  it("rejects missing selections without resurrecting cleared legacy users", () => {
    for (const activity of [{}, { roleIds: [], auditeeIds: [] }, { roleIds: [" "], auditeeId: " " },
      { auditeeIds: [], auditeeId: "old" }]) expect(hasAuditActivityAuditeeSelection(activity)).toBe(false);
  });
  it("does not inject blank user IDs into participant validation or change stored values", () => {
    const activity = { roleIds: ["role"], auditeeId: "", auditeeIds: ["", "valid-user"] };
    const before = JSON.stringify(activity);
    expect(auditActivityAuditeeIds(activity)).toEqual(["valid-user"]);
    expect(JSON.stringify(activity)).toBe(before);
  });
});
