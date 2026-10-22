import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { createLessonPdf } from "./lesson-pdf";

describe("Lessons PDF source-row outer border", () => {
  it.each(["Project", "Department"])("continues both template borders around %s rows", async sourceType => {
    const lines = vi.spyOn(PDFPage.prototype, "drawLine");
    try {
      const bytes = await createLessonPdf({
        referenceNumber: "BORDER-LL-000001", title: "Border regression check",
        sourceName: "Verification source", departmentId: sourceType === "Department" ? "department-id" : null,
        capturedAt: "2026-10-21T10:00:00Z", impact: "Positive",
      });
      const document = await PDFDocument.load(bytes);
      const { width, height } = document.getPage(0).getSize();
      const scale = height / (height + 56), left = (width - width * scale) / 2;
      for (const x of [24.25, 571]) {
        const border = lines.mock.calls.map(([options]) => options).find(options =>
          Math.abs((options?.start.x ?? 0) - (left + x * scale)) < 0.001
          && options?.start.x === options?.end.x);
        expect(border).toBeDefined();
        expect(border!.start.y).toBeGreaterThan(height - 196.9 * scale);
        expect(border!.end.y).toBeLessThan(height - (196.9 + 56) * scale);
        expect(border!.thickness).toBeCloseTo(0.5 * scale);
      }
    } finally { lines.mockRestore(); }
  });
});
