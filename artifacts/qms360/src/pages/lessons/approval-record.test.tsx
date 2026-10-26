import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LessonApprovalRecord } from "./approval-record";

describe("Lesson Approval record", () => {
  it("renders all actions, people, dates and historical comments in the supplied newest-first order", () => {
    const html = renderToStaticMarkup(<LessonApprovalRecord items={[
      { id: "approved", action: "approve", actorName: "Final reviewer", occurredAt: "2026-10-03T08:00:00Z", comments: "Accepted now" },
      { id: "returned", action: "send_back", actorName: "Earlier reviewer", occurredAt: "2026-10-02T08:00:00Z", comments: "Old correction" },
      { id: "submitted", action: "submit", actorName: "Original author", occurredAt: "2026-10-01T08:00:00Z" },
    ]} />);
    expect(html.indexOf("Final reviewer")).toBeLessThan(html.indexOf("Earlier reviewer"));
    expect(html.indexOf("Earlier reviewer")).toBeLessThan(html.indexOf("Original author"));
    expect(html).toContain("Accepted now");
    expect(html).toContain("Old correction");
    expect(html).toContain("Latest action first");
    expect(html).toContain("Approved by");
    expect(html).toContain("Sent back by");
  });
  it("retains more than 50 events in a scrollable tile rather than dropping the oldest", () => {
    const html = renderToStaticMarkup(<LessonApprovalRecord items={Array.from({ length: 70 }, (_, i) => ({
      id: String(i), action: "submit", actorName: `Person ${i}`, occurredAt: "2026-10-01T08:00:00Z",
    }))} />);
    expect(html.match(/<li /g)).toHaveLength(70);
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("Person 69");
  });
  it("shows an explicit load error and retry, not an empty-history message", () => {
    const html = renderToStaticMarkup(<LessonApprovalRecord items={[]} error="Could not load approval history" />);
    expect(html).toContain("Retry");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No approval actions");
  });
  it("shows a clear empty state for a draft with no approval actions", () => {
    expect(renderToStaticMarkup(<LessonApprovalRecord items={[]} />)).toContain("No approval actions recorded yet.");
  });
});
