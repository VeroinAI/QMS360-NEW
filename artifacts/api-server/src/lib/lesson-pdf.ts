import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { formatDateInTimeZone } from "@workspace/spreadsheet-dates";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

type PdfLesson = Record<string, unknown>;
export type LessonPdfImage = { mimeType: string; imageBytes: Uint8Array };
export type LessonPdfPhoto = LessonPdfImage & { category: string };
export type LessonPdfAssets = {
  photos?: LessonPdfPhoto[];
  preparedSignature?: LessonPdfImage;
  approvedSignature?: LessonPdfImage;
};
type Box = readonly [x: number, top: number, width: number, height: number];
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

async function asset(name: string) {
  try { return await readFile(new URL(`./${name}`, import.meta.url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFile(new URL(`../assets/${name}`, import.meta.url));
  }
}

function valueText(value: unknown) {
  return String(value ?? "").trim() || "—";
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? valueText(value) : formatDateInTimeZone(date, "UTC");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawLines(page: PDFPage, lines: string[], font: PDFFont, size: number, box: Box, center = true) {
  const [x, top, width, height] = box;
  const leading = size * 1.15;
  let baseline = page.getHeight() - top - (height - lines.length * leading) / 2 - size;
  for (const line of lines) {
    page.drawText(line, {
      x: center ? x + (width - font.widthOfTextAtSize(line, size)) / 2 : x + 5,
      y: baseline, font, size, color: BLACK,
    });
    baseline -= leading;
  }
}

async function embedImage(document: PDFDocument, image: LessonPdfImage) {
  const bytes = image.imageBytes;
  return image.mimeType.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50)
    ? document.embedPng(bytes) : document.embedJpg(bytes);
}

function drawContainedImage(page: PDFPage, image: PDFImage, [x, top, width, height]: Box) {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  page.drawImage(image, { x: x + (width - w) / 2, y: page.getHeight() - top - height + (height - h) / 2, width: w, height: h });
}

export async function createLessonPdf(lesson: PdfLesson, assets: LessonPdfAssets = {}) {
  const [template, regularBytes, boldBytes] = await Promise.all([
    asset("lesson-learned-template.pdf"), asset("DejaVuSans.ttf"), asset("DejaVuSans-Bold.ttf"),
  ]);
  const document = await PDFDocument.load(template);
  document.registerFontkit(fontkit);
  document.setTitle(`Lesson Learned Form - ${valueText(lesson.referenceNumber)}`);
  document.setSubject(`APPROVAL STATUS: ${valueText(lesson.workflowState).toUpperCase()}`);
  const regular = await document.embedFont(regularBytes, { subset: true });
  const bold = await document.embedFont(boldBytes, { subset: true });
  const page = document.getPages()[0]!;
  const overflow: { label: string; text: string }[] = [];
  const field = (label: string, value: unknown, box: Box) => {
    const text = valueText(value);
    let size = 9.5, lines = wrap(text, regular, size, box[2] - 10);
    while (lines.length * size * 1.15 > box[3] - 6 && size > 7) {
      size -= 0.5;
      lines = wrap(text, regular, size, box[2] - 10);
    }
    if (lines.length * size * 1.15 > box[3] - 6) {
      overflow.push({ label, text });
      const count = Math.max(1, Math.floor((box[3] - 6) / (size * 1.15)));
      lines = [...lines.slice(0, count - 1), "(See continuation)"];
    }
    drawLines(page, lines, regular, size, box);
  };
  // Exact cell coordinates from the supplied Word form. Its embedded logo,
  // small-cap title, Quality band, colours, borders and control footer stay intact.
  field("Reference # (LL)", lesson.referenceNumber, [28.9, 111.6, 179.4, 28.5]);
  field("Title", lesson.title, [208.4, 111.6, 179.4, 28.5]);
  field("Discipline", lesson.disciplineId, [387.9, 111.6, 179.6, 28.5]);
  field("Categorization (LL)", lesson.categorisationId, [28.9, 168.4, 179.4, 28.5]);
  field("Date", dateText(lesson.capturedAt), [208.4, 168.4, 179.4, 28.5]);
  field("Location", lesson.repeatLocation || (lesson.gpsLat != null && lesson.gpsLng != null ? `${lesson.gpsLat}, ${lesson.gpsLng}` : null), [387.9, 168.4, 179.6, 28.5]);
  const impact = String(lesson.impact).toLowerCase();
  if (impact === "positive" || impact === "negative") {
    page.drawText("X", { x: impact === "positive" ? 204.8 : 382, y: page.getHeight() - 213.4, font: bold, size: 9, color: BLACK });
  }
  field("Description", lesson.description, [149.3, 222.4, 418.3, 28.7]);
  field("Reference", lesson.reference, [149.3, 251.1, 418.3, 28.7]);
  field("Why Did It Happen? (Root cause)", lesson.rootCause, [149.3, 279.8, 418.3, 51]);
  field("How can we rectify? (Correction)", lesson.correction, [149.3, 330.8, 418.3, 51]);
  field("How It can Be Avoided in Future? (Corrective action)", lesson.correctiveAction, [149.3, 381.8, 418.3, 51]);

  for (const [category, top] of [["before", 440.2], ["after", 542.2]] as const) {
    const photos = (assets.photos ?? []).filter(photo => photo.category === category).slice(0, 2);
    const embedded: PDFImage[] = [];
    for (const photo of photos) {
      try { embedded.push(await embedImage(document, photo)); } catch { /* Preserve the photo area if evidence is not a readable image. */ }
    }
    embedded.forEach((image, index) => {
      const slot = 406 / embedded.length;
      drawContainedImage(page, image, [154 + index * slot + 3, top + 3, slot - 6, 85.2]);
    });
  }
  field("Prepared by — Designation", lesson.submittedByDesignation, [113.9, 688, 188.6, 28.5]);
  field("Approved by — Designation", lesson.reviewedByDesignation, [381.9, 688, 184.4, 28.5]);
  field("Prepared by — Name", lesson.submittedByName, [113.9, 716.5, 188.6, 28.5]);
  field("Approved by — Name", lesson.reviewedByName, [381.9, 716.5, 184.4, 28.5]);
  for (const [signature, x, width] of [
    [assets.preparedSignature, 117.9, 180.6], [assets.approvedSignature, 385.9, 176.4],
  ] as const) {
    if (!signature) continue;
    try { drawContainedImage(page, await embedImage(document, signature), [x, 748, width, 19.5]); }
    catch { /* Never substitute or fabricate a signature. */ }
  }
  field("Prepared by — Date", dateText(lesson.submittedAt), [113.9, 770.5, 188.6, 25.5]);
  field("Approved by — Date", dateText(lesson.reviewedAt), [381.9, 770.5, 184.4, 25.5]);

  // Keep the fixed Word form readable without silently losing unusually long data.
  if (overflow.length) {
    const header = await document.embedPage(page, { left: 24, bottom: page.getHeight() - 78, right: 572, top: page.getHeight() - 24 });
    const footer = await document.embedPage(page, { left: 24, bottom: 25, right: 572, top: 37 });
    let continuation: PDFPage;
    let top = 0;
    const addContinuation = () => {
      continuation = document.addPage([page.getWidth(), page.getHeight()]);
      continuation.drawPage(header, { x: 24, y: page.getHeight() - 78, width: 548, height: 54 });
      continuation.drawPage(footer, { x: 24, y: 25, width: 548, height: 12 });
      drawLines(continuation, [`Additional lesson details — ${valueText(lesson.referenceNumber)}`], bold, 9, [29, 90, 538, 20]);
      top = 120;
    };
    addContinuation();
    for (const entry of overflow) {
      for (const line of [...wrap(entry.label, bold, 10, 528), ...wrap(entry.text, regular, 9.5, 528), ""]) {
        if (top > 780) addContinuation();
        drawLines(continuation!, [line], regular, 9.5, [29, top, 538, 14], false);
        top += 14;
      }
    }
    document.getPages().forEach((sheet, index, pages) => {
      sheet.drawRectangle({ x: 531.5, y: sheet.getHeight() - 815.4, width: 33.5, height: 8.5, color: WHITE });
      drawLines(sheet, [`${index + 1} of ${pages.length}`], regular, 6, [532, 807, 32, 8.5]);
    });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
