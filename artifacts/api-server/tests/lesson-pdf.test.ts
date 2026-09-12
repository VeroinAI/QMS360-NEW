import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createLessonPdf } from "../src/lib/lesson-pdf";

describe("Lesson Learned PDF", () => {
  it("creates a one-page client-template PDF with approval status, photos, and both signatures", async () => {
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const pdf = await createLessonPdf({
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
    }, {
      photos: [{
        category: "before",
        mimeType: "image/png",
        imageBytes: tinyPng,
      }],
      preparedSignature: { mimeType: "image/png", imageBytes: tinyPng },
      approvedSignature: { mimeType: "image/png", imageBytes: tinyPng },
    });
    const content = pdf.toString("latin1");
    const parsed = await PDFDocument.load(pdf);
    expect(content.startsWith("%PDF-")).toBe(true);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getSubject()).toBe("APPROVAL STATUS: APPROVED");
    expect(content.match(/\/Subtype \/Image/g)).toHaveLength(3);
    expect(content).toContain("%%EOF");
  });
});