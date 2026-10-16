import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
    // The supplied Word form contains its own logo and pale-blue photo backdrop.
    // These (including the logo's transparency mask) are retained in addition
    // to the record photo and two signatures.
    expect(content.match(/\/Subtype \/Image/g)).toHaveLength(6);
    expect(content).toContain("%%EOF");
  });
  it("retains the actual Word template branding even without any record images", async () => {
    const [pdf, template] = await Promise.all([
      createLessonPdf({ referenceNumber: "LL-TEST", workflowState: "Draft" }),
      readFile(new URL("../src/assets/lesson-learned-template.pdf", import.meta.url)),
    ]);
    const result = await PDFDocument.load(pdf), original = await PDFDocument.load(template);
    expect(result.getPages()[0]!.getSize()).toEqual(original.getPages()[0]!.getSize());
    expect(result.getPageCount()).toBe(1);
    expect(pdf.toString("latin1").match(/\/Subtype \/Image/g)).toHaveLength(3);
    expect(result.getSubject()).toBe("APPROVAL STATUS: DRAFT");
  });
  it("preserves long field content on continuation pages instead of clipping it", async () => {
    const pdf = await createLessonPdf({
      referenceNumber: "LL-LONG",
      description: "This is the full description. ".repeat(300) + "END OF LONG DESCRIPTION",
      rootCause: "Details with accents: é ñ and العربية.",
      workflowState: "Approved",
    });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
    const output = resolve(process.cwd(), "../../generated-artifacts/lesson-form");
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "long-content-check.pdf"), pdf);
  });
});