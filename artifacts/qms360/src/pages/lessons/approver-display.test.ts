import { describe, expect, it } from "vitest";
import { lessonApproverDisplayName } from "./approver-display";

describe("Lessons workflow approver display", () => {
  const currentUser = { id: "approver", fullName: "Assigned Reviewer" };
  it("shows the assigned name even when the selectable list excludes the logged-in approver", () => {
    const options = [{ id: "other", fullName: "Other Reviewer" }];
    expect(lessonApproverDisplayName("approver", { approverId: "approver", approverName: "Assigned Reviewer" }, options, currentUser)).toBe("Assigned Reviewer");
    expect(options).toEqual([{ id: "other", fullName: "Other Reviewer" }]);
  });
  it("shows the saved assigned name to creators and delegates without reintroducing ineligible options", () => {
    expect(lessonApproverDisplayName("approver", { approverId: "approver", approverName: "Assigned Reviewer" }, [], { id: "delegate", fullName: "Delegate Reviewer" })).toBe("Assigned Reviewer");
  });
  it("uses the selected option after an unsaved approver change, not the previous assigned name", () => {
    expect(lessonApproverDisplayName("other", { approverId: "approver", approverName: "Assigned Reviewer" }, [{ id: "other", fullName: "Other Reviewer" }], currentUser)).toBe("Other Reviewer");
  });
  it("can display the logged-in assigned approver while an older API lacks the name", () => {
    expect(lessonApproverDisplayName("approver", { approverId: "approver" }, [], currentUser)).toBe("Assigned Reviewer");
  });
  it("keeps the empty selection placeholder and never invents a missing name", () => {
    expect(lessonApproverDisplayName("", undefined, [], currentUser)).toBeUndefined();
    expect(lessonApproverDisplayName("unknown", undefined, [], currentUser)).toBe("Approver name unavailable");
  });
});
