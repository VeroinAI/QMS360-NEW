import { describe, expect, it } from "vitest";
import { lessonApprovalHistory } from "./lesson-approval-history";

const people = new Map([
  ["author", { fullName: "Author", designation: "Engineer" }],
  ["reviewer", { fullName: "Reviewer", designation: "Manager" }],
]);
const event = (id: string, action: string, date: string, after: Record<string, unknown> = {}) => ({
  id, action, createdAt: date, after, actorId: action === "submit" ? "author" : "reviewer",
});
describe("Lesson Learned complete approval history", () => {
  it("keeps all cycles in newest-first order with the original review comments", () => {
    const rows = [
      event("1", "submit", "2026-10-01T08:00:00Z"),
      event("2", "send_back", "2026-10-02T08:00:00Z", { reviewComments: "First corrections", reviewedByName: "Original Reviewer" }),
      event("3", "submit", "2026-10-03T08:00:00Z"),
      event("4", "send_back", "2026-10-04T08:00:00Z", { remarks: "Second corrections" }),
      event("5", "submit", "2026-10-05T08:00:00Z"),
      event("6", "approve", "2026-10-06T08:00:00Z", { reviewComments: "Accepted" }),
    ];
    const history = lessonApprovalHistory(rows, people, {});
    expect(history.map(entry => entry.id)).toEqual(["6", "5", "4", "3", "2", "1"]);
    expect(history[2].comments).toBe("Second corrections");
    expect(history[4]).toMatchObject({ actorName: "Original Reviewer", comments: "First corrections" });
  });
  it("does not impose the activity timeline's 50-entry limit", () => {
    const rows = Array.from({ length: 70 }, (_, i) => event(String(i), i % 2 ? "send_back" : "submit", new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString()));
    const history = lessonApprovalHistory(rows, people, {});
    expect(history).toHaveLength(70);
    expect(history[0].id).toBe("69");
    expect(history.at(-1)?.id).toBe("0");
  });
  it("fills legacy history from saved current metadata without inventing earlier cycles", () => {
    const history = lessonApprovalHistory([], people, {
      submittedAt: "2026-10-01T08:00:00Z", submittedById: "author", submittedByName: "Author",
      reviewedAt: "2026-10-02T08:00:00Z", reviewedById: "reviewer", reviewDecision: "approve", reviewComments: "Approved legacy record",
    });
    expect(history.map(entry => entry.action)).toEqual(["approve", "submit"]);
    expect(history[0].comments).toBe("Approved legacy record");
  });
  it("does not duplicate canonical events when transaction and audit timestamps differ", () => {
    const submittedAt = "2026-10-01T08:00:00Z";
    const history = lessonApprovalHistory([event("saved", "submit", "2026-10-01T08:00:03Z", { submittedAt })], people,
      { submittedAt, submittedById: "author", submittedBySignatureUrl: "/api/lessons/users/author/signature" });
    expect(history).toHaveLength(1);
    expect(history[0].signatureUrl).toContain("/author/signature");
  });
  it("keeps missing newer metadata as an additional event and does not reuse today's signature on old cycles", () => {
    const history = lessonApprovalHistory([event("old", "submit", "2026-10-01T08:00:00Z")], people, {
      submittedAt: "2026-10-03T08:00:00Z", submittedById: "author", submittedBySignatureUrl: "/new/signature",
    });
    expect(history).toHaveLength(2);
    expect(history[0].signatureUrl).toBe("/new/signature");
    expect(history[1].signatureUrl).toBeNull();
  });
  it("keeps send-back legacy actions and workflow transfers, excluding ordinary draft edits", () => {
    const history = lessonApprovalHistory([
      event("update", "update", "2026-10-03T08:00:00Z"),
      event("transfer", "transfer", "2026-10-02T08:00:00Z", { reason: "Reviewer changed" }),
      event("legacy-reject", "reject", "2026-10-01T08:00:00Z", { remarks: "Correct this" }),
    ], people, {});
    expect(history.map(entry => entry.action)).toEqual(["transfer", "send_back"]);
    expect(history.map(entry => entry.comments)).toEqual(["Reviewer changed", "Correct this"]);
  });
  it("never labels a legacy review with an unknown decision as a send-back", () => {
    expect(lessonApprovalHistory([], people, { reviewedAt: "2026-10-01T08:00:00Z" })[0].action).toBe("review");
  });
});
