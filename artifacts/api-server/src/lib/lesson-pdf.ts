import { formatDateInTimeZone } from "@workspace/spreadsheet-dates";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

type PdfLesson = Record<string, unknown>;
export type LessonPdfImage = { mimeType: string; imageBytes: Uint8Array };
export type LessonPdfPhoto = LessonPdfImage & { category: string };
export type LessonPdfAssets = {
  logoBytes?: Uint8Array;
  photos?: LessonPdfPhoto[];
  preparedSignature?: LessonPdfImage;
  approvedSignature?: LessonPdfImage;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 29;
const TOP = 813;
const WIDTH = PAGE_WIDTH - LEFT * 2;
const PURPLE = rgb(0.35, 0.16, 0.52);
const LIGHT_GREY = rgb(0.9, 0.9, 0.9);
const PHOTO_BLUE = rgb(0.91, 0.95, 1);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

function valueText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? valueText(value) : formatDateInTimeZone(date, "UTC");
}

function wrapText(text: string, font: PDFFont, size: number, width: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const visible = lines.slice(0, maxLines);
    let last = visible[maxLines - 1]!;
    while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
    visible[maxLines - 1] = `${last}…`;
    return visible;
  }
  return lines.length ? lines : ["—"];
}

function cell(page: PDFPage, x: number, top: number, width: number, height: number, fill = WHITE, borderWidth = 0.65) {
  page.drawRectangle({ x, y: top - height, width, height, color: fill, borderColor: BLACK, borderWidth });
}

function cellText(
  page: PDFPage,
  text: unknown,
  x: number,
  top: number,
  width: number,
  height: number,
  font: PDFFont,
  options: { size?: number; align?: "left" | "center"; color?: ReturnType<typeof rgb>; padding?: number } = {},
) {
  const size = options.size ?? 8.2;
  const padding = options.padding ?? 6;
  const leading = size * 1.12;
  const maxLines = Math.max(1, Math.floor((height - padding * 2) / leading));
  const lines = wrapText(valueText(text), font, size, width - padding * 2, maxLines);
  let y = top - (height - lines.length * leading) / 2 - size;
  for (const line of lines) {
    const textWidth = font.widthOfTextAtSize(line, size);
    const tx = options.align === "center" ? x + Math.max(padding, (width - textWidth) / 2) : x + padding;
    page.drawText(line, { x: tx, y, size, font, color: options.color ?? BLACK });
    y -= leading;
  }
}

async function embedImage(document: PDFDocument, image: LessonPdfImage) {
  const bytes = image.imageBytes;
  const isPng = image.mimeType.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50);
  return isPng ? document.embedPng(bytes) : document.embedJpg(bytes);
}

function drawContainedImage(page: PDFPage, image: PDFImage, x: number, top: number, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, {
    x: x + (width - drawWidth) / 2,
    y: top - height + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
}

export async function createLessonPdf(lesson: PdfLesson, assets: LessonPdfAssets = {}) {
  const document = await PDFDocument.create();
  document.setTitle(`Lesson Learned Form - ${valueText(lesson.referenceNumber)}`);
  document.setSubject(`APPROVAL STATUS: ${valueText(lesson.workflowState).toUpperCase()}`);
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let y = TOP;

  // Client template header: exact three-cell purple band and Alghaz Holding logo.
  const headerHeight = 48;
  const logoWidth = 130;
  const codeWidth = 83;
  cell(page, LEFT, y, logoWidth, headerHeight, PURPLE);
  cell(page, LEFT + logoWidth, y, WIDTH - logoWidth - codeWidth, headerHeight, PURPLE);
  cell(page, LEFT + WIDTH - codeWidth, y, codeWidth, headerHeight, PURPLE);
  if (assets.logoBytes) {
    try {
      const logo = await document.embedJpg(assets.logoBytes);
      drawContainedImage(page, logo, LEFT + 7, y - 4, logoWidth - 14, headerHeight - 8);
    } catch {
      cellText(page, "ALGIHAZ HOLDING", LEFT, y, logoWidth, headerHeight, bold, { size: 8, align: "center", color: WHITE });
    }
  } else {
    cellText(page, "ALGIHAZ HOLDING", LEFT, y, logoWidth, headerHeight, bold, { size: 8, align: "center", color: WHITE });
  }
  cellText(page, "LESSON LEARNED FORM", LEFT + logoWidth, y, WIDTH - logoWidth - codeWidth, headerHeight, bold, { size: 14, align: "center", color: WHITE });
  cellText(page, "SHEQ", LEFT + WIDTH - codeWidth, y, codeWidth, headerHeight, bold, { size: 13, align: "center", color: WHITE });
  y -= headerHeight + 6;

  const third = WIDTH / 3;
  const metaRow = (labels: string[], values: unknown[]) => {
    for (let index = 0; index < 3; index += 1) {
      const x = LEFT + third * index;
      cell(page, x, y, third, 23, LIGHT_GREY);
      cellText(page, labels[index], x, y, third, 23, bold, { align: "center" });
    }
    y -= 23;
    for (let index = 0; index < 3; index += 1) {
      const x = LEFT + third * index;
      cell(page, x, y, third, 31);
      cellText(page, values[index], x, y, third, 31, regular, { align: "center", size: 8.5 });
    }
    y -= 31;
  };
  metaRow(["Reference # (LL)", "Title", "Discipline"], [lesson.referenceNumber, lesson.title, lesson.disciplineId]);
  metaRow(["Categorization (LL)", "Date", "Location"], [
    lesson.categorisationId,
    dateText(lesson.capturedAt),
    lesson.repeatLocation || (lesson.gpsLat && lesson.gpsLng ? `${lesson.gpsLat}, ${lesson.gpsLng}` : "—"),
  ]);

  const labelWidth = 120;
  const dataWidth = WIDTH - labelWidth;
  const fieldRow = (label: string, value: unknown, height: number) => {
    cell(page, LEFT, y, labelWidth, height, LIGHT_GREY);
    cell(page, LEFT + labelWidth, y, dataWidth, height);
    cellText(page, label, LEFT, y, labelWidth, height, bold);
    cellText(page, value, LEFT + labelWidth, y, dataWidth, height, regular, { align: "center", size: 8.4 });
    y -= height;
  };

  cell(page, LEFT, y, labelWidth, 28, LIGHT_GREY);
  cell(page, LEFT + labelWidth, y, dataWidth, 28);
  cellText(page, "Impact (LL)", LEFT, y, labelWidth, 28, bold);
  const positive = String(lesson.impact).toLowerCase() === "positive";
  const negative = String(lesson.impact).toLowerCase() === "negative";
  const choiceY = y - 17;
  page.drawRectangle({ x: LEFT + 176, y: choiceY, width: 8, height: 8, borderColor: BLACK, borderWidth: 0.7 });
  page.drawRectangle({ x: LEFT + 352, y: choiceY, width: 8, height: 8, borderColor: BLACK, borderWidth: 0.7 });
  if (positive) page.drawText("X", { x: LEFT + 177, y: choiceY + 0.5, size: 7, font: bold });
  if (negative) page.drawText("X", { x: LEFT + 353, y: choiceY + 0.5, size: 7, font: bold });
  page.drawText("Positive", { x: LEFT + 190, y: choiceY, size: 8.4, font: regular });
  page.drawText("Negative", { x: LEFT + 366, y: choiceY, size: 8.4, font: regular });
  y -= 28;

  fieldRow("Description", lesson.description, 34);
  fieldRow("Reference", lesson.reference, 31);
  fieldRow("Why Did It Happen? (Root cause)", lesson.rootCause, 55);
  fieldRow("How can we rectify? (Correction)", lesson.correction, 55);
  fieldRow("How It can Be Avoided in Future? (Corrective action)", lesson.correctiveAction, 55);

  const photoRow = async (label: string, category: string) => {
    const height = 91;
    cell(page, LEFT, y, labelWidth, height, LIGHT_GREY);
    cell(page, LEFT + labelWidth, y, dataWidth, height, PHOTO_BLUE);
    cellText(page, label, LEFT, y, labelWidth, height, bold);
    const candidates = (assets.photos ?? []).filter(photo => photo.category === category).slice(0, 2);
    const embedded: PDFImage[] = [];
    for (const photo of candidates) {
      try { embedded.push(await embedImage(document, photo)); } catch { /* Keep the template cell intact for unsupported/corrupt images. */ }
    }
    if (!embedded.length) {
      cellText(page, "No photo attached", LEFT + labelWidth, y, dataWidth, height, regular, { align: "center", color: rgb(0.45, 0.45, 0.45) });
    } else {
      const slotWidth = dataWidth / embedded.length;
      embedded.forEach((image, index) => drawContainedImage(page, image, LEFT + labelWidth + slotWidth * index + 4, y - 4, slotWidth - 8, height - 8));
    }
    y -= height;
  };
  await photoRow("Before Photo", "before");
  await photoRow("After Photo", "after");

  const status = valueText(lesson.workflowState).toUpperCase();
  cell(page, LEFT, y, WIDTH, 23, PURPLE);
  cellText(page, `Approval  |  Status: ${status}`, LEFT, y, WIDTH, 23, bold, { align: "center", color: WHITE, size: 8.5 });
  y -= 23;
  const half = WIDTH / 2;
  cell(page, LEFT, y, half, 22, LIGHT_GREY);
  cell(page, LEFT + half, y, half, 22, LIGHT_GREY);
  cellText(page, "Prepared by", LEFT, y, half, 22, bold, { align: "center" });
  cellText(page, "Approved by", LEFT + half, y, half, 22, bold, { align: "center" });
  y -= 22;
  const approvalLabel = 84;
  const approvalValue = half - approvalLabel;
  const approvalRow = (label: string, prepared: unknown, approved: unknown) => {
    cell(page, LEFT, y, approvalLabel, 22, LIGHT_GREY);
    cell(page, LEFT + approvalLabel, y, approvalValue, 22);
    cell(page, LEFT + half, y, approvalLabel, 22, LIGHT_GREY);
    cell(page, LEFT + half + approvalLabel, y, approvalValue, 22);
    cellText(page, label, LEFT, y, approvalLabel, 22, bold);
    cellText(page, prepared, LEFT + approvalLabel, y, approvalValue, 22, regular, { align: "center", size: 7.8 });
    cellText(page, label, LEFT + half, y, approvalLabel, 22, bold);
    cellText(page, approved, LEFT + half + approvalLabel, y, approvalValue, 22, regular, { align: "center", size: 7.8 });
    y -= 22;
  };
  approvalRow("Designation", lesson.submittedByDesignation, lesson.reviewedByDesignation);
  approvalRow("Name", lesson.submittedByName, lesson.reviewedByName);
  cell(page, LEFT, y, approvalLabel, 22, LIGHT_GREY);
  cell(page, LEFT + approvalLabel, y, approvalValue, 22);
  cell(page, LEFT + half, y, approvalLabel, 22, LIGHT_GREY);
  cell(page, LEFT + half + approvalLabel, y, approvalValue, 22);
  cellText(page, "Signature", LEFT, y, approvalLabel, 22, bold);
  cellText(page, "Signature", LEFT + half, y, approvalLabel, 22, bold);
  const drawSignature = async (signature: LessonPdfImage | undefined, x: number) => {
    if (!signature) {
      cellText(page, "", x, y, approvalValue, 22, regular, { align: "center", size: 7.8 });
      return;
    }
    try {
      const image = await embedImage(document, signature);
      drawContainedImage(page, image, x + 3, y - 2, approvalValue - 6, 18);
    } catch {
      cellText(page, "", x, y, approvalValue, 22, regular, { align: "center", size: 7.8 });
    }
  };
  await drawSignature(assets.preparedSignature, LEFT + approvalLabel);
  await drawSignature(assets.approvedSignature, LEFT + half + approvalLabel);
  y -= 22;
  approvalRow("Date", dateText(lesson.submittedAt), dateText(lesson.reviewedAt));

  const footerTop = y - 6;
  const footerWidths = [65, 70, 73, 120, 70, 63, 35, 41];
  const footerValues = ["Revision Date", "19-Dec-2023", "Control Number", "SHEQ-01-SF-005", "Revision", "00", "Page", "1 of 1"];
  let footerX = LEFT;
  footerWidths.forEach((width, index) => {
    cell(page, footerX, footerTop, width, 12, index % 2 === 0 ? LIGHT_GREY : WHITE, 0.45);
    cellText(page, footerValues[index], footerX, footerTop, width, 12, index % 2 === 0 ? bold : regular, { align: "center", size: 5.2, padding: 2 });
    footerX += width;
  });

  page.drawRectangle({ x: LEFT - 5, y: footerTop - 17, width: WIDTH + 10, height: TOP - footerTop + 22, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 0.7 });
  return Buffer.from(await document.save({ useObjectStreams: false }));
}