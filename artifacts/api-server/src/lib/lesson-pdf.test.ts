import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage, StandardFonts } from "pdf-lib";
import { createLessonPdf } from "./lesson-pdf";
import { lessonParagraphLines } from "./lesson-pdf-table";

const basicLesson = {
  referenceNumber: "LAYOUT-LL-000001", title: "Concrete Honeycombing on the External Surface",
  sourceName: "Verification project", capturedAt: "2026-10-22T10:00:00Z", impact: "Positive",
};
const normalize = (text: string) => text.replace(/\s/g, "");

describe("Lessons PDF auto-sizing table", () => {
  it("justifies narrative lines to both cell margins, leaving paragraph endings left aligned", async () => {
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      await createLessonPdf({ ...basicLesson,
        description: "During site surveillance, honeycombing was observed on the external surface of the building. ".repeat(5)
          + "FirstParagraphEnd.\n\nFinal short paragraph.",
        reference: "Reference text",
      });
      const firstWord = texts.mock.calls.find(([text]) => text === "During");
      expect(firstWord).toBeDefined();
      const baseline = firstWord![1]!.y;
      const firstLine = texts.mock.calls.filter(([, options]) => options?.y === baseline);
      expect(firstLine[0]![1]!.x).toBeCloseTo(155.3);
      const [lastWord, lastOptions] = firstLine.at(-1)!;
      expect(lastOptions!.x! + lastOptions!.font!.widthOfTextAtSize(lastWord, lastOptions!.size!)).toBeCloseTo(561.6);
      for (const [text, options] of texts.mock.calls) {
        if (text.includes("FirstParagraphEnd.") || text === "Final short paragraph." || text === "Reference text") {
          expect(options!.x).toBeCloseTo(155.3);
        }
      }
      expect(texts.mock.calls.some(([text]) => text === "Final short paragraph.")).toBe(true);
      const title = texts.mock.calls.find(([text]) => text === basicLesson.title);
      // Metadata is not affected by the narrative alignment change.
      if (title) expect(title[1]!.x).toBeGreaterThan(214.4);
    } finally { texts.mockRestore(); }
  });

  it("retains paragraph-end and empty-line markers independently of page splits", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const lines = lessonParagraphLines("First paragraph has several wrapped lines ending here.\n\nSecond paragraph.", font, 9.5, 95);
    expect(lines[0]!.justify).toBe(true);
    expect(lines.find(line => line.text.endsWith("here."))!.justify).toBe(false);
    expect(lines).toContainEqual({ text: "", justify: false });
    expect(lines.at(-1)!.justify).toBe(false);
  });

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
