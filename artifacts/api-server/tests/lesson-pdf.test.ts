import { describe, expect, it } from "vitest";
import { createLessonPdf } from "../src/lib/lesson-pdf";

describe("Lesson Learned PDF", () => {
  it("creates a valid PDF containing the current approval status", () => {
    const pdf = createLessonPdf({
      referenceNumber: "LL-2026-001",
      title: "Concrete pour preparation",
      disciplineId: "Civil",
      categorisationId: "Quality",
      capturedAt: "2026-09-11T10:00:00.000Z",
      impact: "Positive",
      description: "Pre-pour checks prevented rework.",
      rootCause: "The checklist was completed before mobilization.",
      correction: "Retain the pre-pour hold point.",
      correctiveAction: "Apply the checklist to all future pours.",
      workflowState: "Approved",
      submittedByName: "Prepared User",
      reviewedByName: "Approved User",
      reviewedAt: "2026-09-11T12:00:00.000Z",
      reviewDecision: "Approved",
      photos: [],
    });
    const content = pdf.toString("latin1");
    expect(content.startsWith("%PDF-1.4")).toBe(true);
    expect(content).toContain("APPROVAL STATUS: APPROVED");
    expect(content).toContain("Approval Status");
    expect(content).toContain("%%EOF");
  });
});