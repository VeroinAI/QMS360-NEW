import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { formatDateInTimeZone } from "@workspace/spreadsheet-dates";
import { PDFDocument, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { lessonTable, type LessonBox } from "./lesson-pdf-table";

type PdfLesson = Record<string, unknown>;
export type LessonPdfImage = { mimeType: string; imageBytes: Uint8Array };
export type LessonPdfPhoto = LessonPdfImage & { category: string };
export type LessonPdfAssets = {
  photos?: LessonPdfPhoto[];
  preparedSignature?: LessonPdfImage;
  approvedSignature?: LessonPdfImage;
};
type Box = LessonBox;
const BLACK = rgb(0, 0, 0);

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
  const templatePage = document.getPages()[0]!;
  const table = await lessonTable(document, templatePage, regular, bold);
  const threeColumns = [179.5, 179.5, 179.7];
  const values = async (items: unknown[], widths = threeColumns) =>
    table.row(items.map((text, index) => ({ width: widths[index]!, text: valueText(text) })));
  // Keep the supplied form's actual branding, labels, photos and document controls.
  await table.band([28.9, 83.1, 538.7, 28.5]);
  await values([lesson.referenceNumber, lesson.title, lesson.disciplineLabel ?? lesson.disciplineId]);
  await table.band([28.9, 140.1, 538.7, 28.3]);
  await values([lesson.categorisationId, dateText(lesson.capturedAt),
    lesson.repeatLocation || (lesson.gpsLat != null && lesson.gpsLng != null ? `${lesson.gpsLat}, ${lesson.gpsLng}` : null)]);
  const department = Boolean(lesson.departmentId);
  for (const [label, text] of [
    ["Project / Department", department ? "Department" : "Project"],
    [department ? "Department" : "Project", valueText(lesson.sourceName ?? lesson.departmentName ?? lesson.projectName)],
  ]) await table.row([{ width: 120.4, text: label, bold: true, shade: true }, { width: 418.3, text }]);
  const impactBand = await table.band([28.9, 196.9, 538.7, 25.5]);
  const impact = String(lesson.impact).toLowerCase();
  if (impact === "positive" || impact === "negative") {
    impactBand.page.drawText("X", { x: impact === "positive" ? 204.8 : 382,
      y: impactBand.page.getHeight() - impactBand.top - 16.5, font: bold, size: 9, color: BLACK });
  }
  for (const [text, top, rowHeight] of [
    [lesson.description, 222.4, 28.7], [lesson.reference, 251.1, 28.7],
    [lesson.rootCause, 279.8, 51], [lesson.correction, 330.8, 51], [lesson.correctiveAction, 381.8, 51],
  ] as const) {
    await table.row([
      { width: 120.4, label: [31.9, top + 3, 114.4, rowHeight - 6] },
      { width: 418.3, text: valueText(text), align: "justify" },
    ], rowHeight);
  }
  for (const [category, top] of [["before", 440.2], ["after", 542.2]] as const) {
    const position = await table.band([28.9, top - 5.7, 538.7, 102]);
    const photos = (assets.photos ?? []).filter(photo => photo.category === category).slice(0, 2);
    const embedded: PDFImage[] = [];
    for (const photo of photos) {
      try { embedded.push(await embedImage(document, photo)); } catch { /* Preserve the photo area if evidence is not a readable image. */ }
    }
    embedded.forEach((image, index) => {
      const slot = 406 / embedded.length;
      drawContainedImage(position.page, image, [154 + index * slot + 3, position.top + 8.7, slot - 6, 85.2]);
    });
  }
  // Avoid separating the approval heading from a normal-sized signature block.
  table.reserve(156.1);
  await table.band([28.9, 642.9, 538.7, 45.1]);
  for (const [prepared, approved, top] of [
    [lesson.submittedByDesignation, lesson.reviewedByDesignation, 688],
    [lesson.submittedByName, lesson.reviewedByName, 716.5],
  ] as const) {
    await table.row([
      { width: 85, label: [29.9, top + 1, 83, 26.5] },
      { width: 188.6, text: valueText(prepared) },
      { width: 79.4, label: [303.5, top + 1, 77.4, 26.5] },
      { width: 185.7, text: valueText(approved) },
    ]);
  }
  const signatures = await table.band([28.9, 745, 538.7, 25.5]);
  for (const [signature, x, width] of [
    [assets.preparedSignature, 117.9, 180.6], [assets.approvedSignature, 385.9, 176.4],
  ] as const) {
    if (!signature) continue;
    try { drawContainedImage(signatures.page, await embedImage(document, signature), [x, signatures.top + 3, width, 19.5]); }
    catch { /* Never substitute or fabricate a signature. */ }
  }
  await table.row([
    { width: 85, label: [29.9, 771.5, 83, 23.5] },
    { width: 188.6, text: dateText(lesson.submittedAt) },
    { width: 79.4, label: [303.5, 771.5, 77.4, 23.5] },
    { width: 185.7, text: dateText(lesson.reviewedAt) },
  ], 25.5);
  table.finish();
  document.removePage(0);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
