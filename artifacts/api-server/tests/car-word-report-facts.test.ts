import { describe, expect, it } from "vitest";
import { findingCreationEvidence } from "../src/lib/audit-photo-finding-metadata";
import { carCalendarDate, carSubmissionDate, carVerification } from "../src/lib/car-word-report-facts";

describe("Factual CAR Word mappings", () => {
  it("retains the first finding transition's creator and date across edits, reclassification and lead changes", () => {
    const item = { id: "finding", auditFinding: "Major NC" };
    const created = { createdAt: "2026-10-01T10:00:00Z", actorId: "original-lead",
      before: { checklistState: [{ ...item, auditFinding: "Not applicable" }] }, after: { checklistState: [item] } };
    const later = { ...created, actorId: "new-lead", createdAt: "2026-10-05T10:00:00Z",
      before: created.after, after: { checklistState: [{ ...item, description: "Edited", findingDate: "2026-10-08" }] } };
    expect(findingCreationEvidence([later, { ...created, actorId: "reclassifier", createdAt: "2026-10-09" }, created]).get(item.id)).toBe(created);
    expect(findingCreationEvidence([{ ...created, before: null }]).size).toBe(0);
    expect(findingCreationEvidence([later]).size).toBe(0);
  });
  it("uses the latest actual submission, not draft, review, CAR creation or update timestamps", () => {
    const events = [
      { action: "submit", createdAt: "2026-10-02T12:00:00Z" },
      { action: "resubmit", createdAt: "2026-10-06T12:00:00Z" },
      { action: "accept", createdAt: "2026-10-08T12:00:00Z" },
      { action: "update", createdAt: "2026-10-09T12:00:00Z" },
    ];
    expect(carSubmissionDate({}, events)).toBe("2026-10-06");
    expect(carSubmissionDate({ carApproval: { submittedAt: "2026-10-07T23:00:00Z" } }, events)).toBe("2026-10-07");
    expect(carSubmissionDate({}, events.slice(2))).toBeNull();
  });
  it.each(["open", "draft", "submitted", "rejected"])("does not mistake %s or intermediate acceptance for final acceptance", workflowState => {
    expect(carVerification({ workflowState }, { reviewOutcome: "accept", carApproval: { status: "Pending approval" } }, "2026-10-05"))
      .toEqual({ accepted: false, withinAcd: false, completed: false });
  });
  it.each(["query", "rework", "reject"])("does not accept a returned %s", reviewOutcome => {
    expect(carVerification({ workflowState: "rejected" }, { reviewOutcome, carApproval: { status: "Sent back" } }, null).accepted).toBe(false);
  });
  it.each(["accepted", "closed"])("supports legacy final %s", workflowState => {
    expect(carVerification({ workflowState }, { reviewOutcome: "accept" }, null).accepted).toBe(true);
  });
  it.each([["2026-10-04T23:59:59Z", true], ["2026-10-05T23:59:59Z", true], ["2026-10-06", false], [null, null], ["invalid", null]])(
    "compares closure %s inclusively at calendar precision", (closedAt, withinAcd) => {
      expect(carVerification({ workflowState: "closed" }, { closedAt, carApproval: { status: "Approved" } }, "2026-10-05"))
        .toEqual({ accepted: true, withinAcd, completed: true });
    });
  it("distinguishes missing closure/deadline evidence from known unclosed negatives", () => {
    expect(carVerification({ workflowState: "closed" }, { closedAt: "2026-10-05" }, null).withinAcd).toBeNull();
    expect(carVerification(undefined, {}, null)).toEqual({ accepted: false, completed: false, withinAcd: false });
    for (const date of ["2026-02-30", "unknown", new Date("invalid")]) expect(carCalendarDate(date)).toBeNull();
  });
});
