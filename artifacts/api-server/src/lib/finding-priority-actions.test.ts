import { describe, expect, it } from "vitest";
import { findingPriorityActions, requireFindingPriorityAction } from "@workspace/field-controls";
import { CreateAuditFindingItemBody, AssignAuditFindingActionTakerBody } from "@workspace/api-zod";

describe("Finding recommended priority actions", () => {
  it.each(findingPriorityActions)("accepts the explicit %s choice for an assigned action taker", priority => {
    expect(requireFindingPriorityAction("user-id", priority)).toBe(priority);
  });
  it.each([undefined, null, ""])("rejects a missing choice when assigning an action taker (%s)", priority => {
    expect(() => requireFindingPriorityAction("user-id", priority)).toThrow(/required.*Action Taker/);
  });
  it("does not invent a priority for unassigned legacy findings", () => {
    expect(requireFindingPriorityAction(null, null)).toBeNull();
  });
  it("rejects other values rather than silently replacing them", () => {
    expect(() => requireFindingPriorityAction("user-id", "Other")).toThrow(/valid Recommended/);
  });
  it("requires the priority on the create API contract and rejects fabricated values", () => {
    const payload = { clause: "1.1", auditArea: "test-area", auditFinding: "Minor NC", actionTakerId: "user-id" };
    expect(CreateAuditFindingItemBody.safeParse(payload).success).toBe(false);
    expect(CreateAuditFindingItemBody.safeParse({ ...payload, recommendedPriorityAction: "Other" }).success).toBe(false);
    for (const priority of findingPriorityActions) {
      expect(CreateAuditFindingItemBody.safeParse({ ...payload, recommendedPriorityAction: priority }).success).toBe(true);
    }
  });
  it("permits retaining an existing valid priority on reassignment, but not leaving an assigned legacy row empty", () => {
    const change = AssignAuditFindingActionTakerBody.parse({ actionTakerId: "another-user" });
    expect(requireFindingPriorityAction(change.actionTakerId, "Correct and close")).toBe("Correct and close");
    expect(() => requireFindingPriorityAction(change.actionTakerId, undefined)).toThrow(/required/);
  });
  it("accepts updates with both selections and rejects invalid priority updates", () => {
    expect(AssignAuditFindingActionTakerBody.safeParse({ actionTakerId: "user-id", recommendedPriorityAction: "Prevent recurrence" }).success).toBe(true);
    expect(AssignAuditFindingActionTakerBody.safeParse({ actionTakerId: "user-id", recommendedPriorityAction: "Urgent" }).success).toBe(false);
  });
});
