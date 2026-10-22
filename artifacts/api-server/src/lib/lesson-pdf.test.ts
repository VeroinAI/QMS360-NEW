import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { createLessonPdf } from "./lesson-pdf";

const basicLesson = {
  referenceNumber: "LAYOUT-LL-000001", title: "Concrete Honeycombing on the External Surface",
  sourceName: "Verification project", capturedAt: "2026-10-22T10:00:00Z", impact: "Positive",
};
const normalize = (text: string) => text.replace(/\s/g, "");

describe("Lessons PDF auto-sizing table", () => {
  it.each(["Project", "Department"])("keeps a complete outer frame on every %s page", async sourceType => {
    const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const bytes = await createLessonPdf({ ...basicLesson, departmentId: sourceType === "Department" ? "department-id" : null });
      const document = await PDFDocument.load(bytes);
      const borders = rectangles.mock.calls.filter(([box]) => box?.x === 24.25 && box?.width === 546.75);
      expect(borders).toHaveLength(document.getPageCount());
      for (const [box] of borders) {
        expect(box?.height).toBe(803.25);
        expect(box?.borderWidth).toBe(0.5);
      }
      expect(texts.mock.calls.map(([text]) => text)).toContain(sourceType);
      expect(texts.mock.calls.map(([text]) => text)).toContain(`${document.getPageCount()} of ${document.getPageCount()}`);
    } finally { rectangles.mockRestore(); texts.mockRestore(); }
  });

  it("grows the title, source and narrative rows instead of clipping or shrinking them", async () => {
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
    const narrative = "During site surveillance, honeycombing was observed on the external surface. ".repeat(12) + "NarrativeEndMarker";
    const title = "Concrete honeycombing on the external wall of the south side of the 132 kV building, with corrective action verification";
    try {
      await createLessonPdf({ ...basicLesson, title, sourceName: "A long project name ".repeat(15),
        description: narrative, reference: "Clause details ".repeat(20), rootCause: narrative,
        correction: narrative, correctiveAction: narrative, submittedByName: "Prepared person ".repeat(10),
        reviewedByDesignation: "Corporate quality assurance and quality control manager ".repeat(5) });
      const rendered = normalize(texts.mock.calls.map(([text]) => text).join(""));
      expect(rendered).toContain(normalize(title));
      expect(rendered.split("NarrativeEndMarker")).toHaveLength(5);
      expect(rendered).not.toContain("Seecontinuation");
      expect(rendered).not.toContain("…");
      expect(rectangles.mock.calls.some(([box]) => box?.x === 149.3 && (box.height ?? 0) > 51)).toBe(true);
      expect(texts.mock.calls.every(([, options]) => !options?.size || options.size >= 8 || options.size === 6)).toBe(true);
    } finally { texts.mockRestore(); rectangles.mockRestore(); }
  });

  it("splits exceptionally long rows at line boundaries and retains all text in order", async () => {
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    const description = Array.from({ length: 360 }, (_, index) => `DescriptionLine${index} with detailed observations.`).join("\n");
    const correction = "UNBROKEN" + "abcdefghij".repeat(90) + "TOKENEND";
    try {
      const bytes = await createLessonPdf({ ...basicLesson, description, correction });
      const document = await PDFDocument.load(bytes);
      expect(document.getPageCount()).toBeGreaterThan(3);
      const rendered = normalize(texts.mock.calls.map(([text]) => text).join(""));
      // Running continuation headings may occur between row fragments.
      const content = rendered.replaceAll("LessonLearnedForm—continued", "");
      expect(content).toContain(normalize(description));
      expect(content).toContain(correction);
      for (const [, options] of texts.mock.calls) {
        expect(options?.y).toBeGreaterThan(24);
        expect(options?.x).toBeGreaterThanOrEqual(28.9);
      }
    } finally { texts.mockRestore(); }
  });

  it("preserves real photo and signature assets in the flowing form", async () => {
    const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const image = { mimeType: "image/png", imageBytes };
    const draws = vi.spyOn(PDFPage.prototype, "drawImage");
    try {
      await createLessonPdf(basicLesson, { photos: [{ ...image, category: "before" }, { ...image, category: "after" }],
        preparedSignature: image, approvedSignature: image });
      expect(draws).toHaveBeenCalledTimes(4);
    } finally { draws.mockRestore(); }
  });
});
