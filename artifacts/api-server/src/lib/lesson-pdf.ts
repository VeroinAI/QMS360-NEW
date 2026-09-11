type PdfLesson = Record<string, unknown>;

type TextStyle = {
  bold?: boolean;
  size?: number;
  color?: [number, number, number];
  gapAfter?: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function pdfText(value: unknown) {
  return String(value ?? "—")
    .replace(/[^\x20-\x7E]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

function wrap(value: unknown, size: number, maxWidth = CONTENT_WIDTH) {
  const text = pdfText(value);
  const maxChars = Math.max(12, Math.floor(maxWidth / (size * 0.52)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

export function createLessonPdf(lesson: PdfLesson) {
  const pages: string[][] = [[]];
  let page = 0;
  let y = PAGE_HEIGHT - MARGIN;

  const command = (value: string) => pages[page]!.push(value);
  const newPage = () => {
    pages.push([]);
    page += 1;
    y = PAGE_HEIGHT - MARGIN;
  };
  const ensure = (height: number) => {
    if (y - height < MARGIN) newPage();
  };
  const line = (x1: number, y1: number, x2: number, y2: number, width = 0.7) => command(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const fillRect = (x: number, bottom: number, width: number, height: number, color: [number, number, number]) =>
    command(`${color.join(" ")} rg ${x} ${bottom} ${width} ${height} re f 0 0 0 rg`);
  const text = (value: unknown, style: TextStyle = {}, x = MARGIN, maxWidth = CONTENT_WIDTH) => {
    const size = style.size ?? 9;
    const leading = size * 1.35;
    const lines = wrap(value, size, maxWidth);
    ensure(lines.length * leading + (style.gapAfter ?? 0));
    const font = style.bold ? "F2" : "F1";
    const color = style.color ?? [0, 0, 0];
    for (const row of lines) {
      command(`BT /${font} ${size} Tf ${color.join(" ")} rg 1 0 0 1 ${x} ${y} Tm (${row}) Tj ET`);
      y -= leading;
    }
    y -= style.gapAfter ?? 0;
  };
  const section = (title: string) => {
    ensure(28);
    fillRect(MARGIN, y - 18, CONTENT_WIDTH, 22, [0.12, 0.18, 0.31]);
    text(title, { bold: true, size: 10, color: [1, 1, 1], gapAfter: 7 }, MARGIN + 8, CONTENT_WIDTH - 16);
  };
  const field = (label: string, value: unknown) => {
    text(label, { bold: true, size: 8, color: [0.32, 0.35, 0.4] });
    text(value, { size: 9, gapAfter: 6 });
    line(MARGIN, y + 3, PAGE_WIDTH - MARGIN, y + 3, 0.35);
  };

  fillRect(MARGIN, y - 53, CONTENT_WIDTH, 57, [0.95, 0.96, 0.98]);
  text("SHEQ-01-SF-005", { bold: true, size: 9, color: [0.12, 0.18, 0.31] }, MARGIN + 10);
  text("LESSON LEARNED FORM", { bold: true, size: 18, color: [0.12, 0.18, 0.31], gapAfter: 15 }, MARGIN + 10);

  const approvalStatus = lesson.workflowState ?? "Draft";
  fillRect(MARGIN, y - 21, CONTENT_WIDTH, 25, [0.88, 0.94, 0.9]);
  text(`APPROVAL STATUS: ${String(approvalStatus).toUpperCase()}`, { bold: true, size: 11, color: [0.08, 0.35, 0.2], gapAfter: 12 }, MARGIN + 8);

  section("Lesson Details");
  field("Reference # (LL)", lesson.referenceNumber);
  field("Title", lesson.title);
  field("Discipline", lesson.disciplineId);
  field("Categorization (LL)", lesson.categorisationId);
  field("Date", dateText(lesson.capturedAt));
  field("Location", lesson.repeatLocation || (lesson.gpsLat && lesson.gpsLng ? `${lesson.gpsLat}, ${lesson.gpsLng}` : "—"));
  field("Impact (LL)", lesson.impact);

  section("Learning");
  field("Description", lesson.description);
  field("Reference", lesson.reference);
  field("Why Did It Happen? (Root cause)", lesson.rootCause);
  field("How can we rectify? (Correction)", lesson.correction);
  field("How It can Be Avoided in Future? (Corrective action)", lesson.correctiveAction);

  section("Photos");
  const photos = Array.isArray(lesson.photos) ? lesson.photos as Array<Record<string, unknown>> : [];
  field("Before Photo", photos.filter(photo => photo.category === "before").map(photo => photo.fileName).join(", ") || "No before photo attached");
  field("After Photo", photos.filter(photo => photo.category === "after").map(photo => photo.fileName).join(", ") || "No after photo attached");

  section("Approval");
  field("Approval Status", approvalStatus);
  field("Prepared by - Name", lesson.submittedByName);
  field("Prepared by - Designation", lesson.submittedByDesignation);
  field("Prepared by - Date", dateText(lesson.submittedAt));
  field("Approved by - Name", lesson.reviewedByName);
  field("Approved by - Designation", lesson.reviewedByDesignation);
  field("Approved by - Date", dateText(lesson.reviewedAt));
  field("Approval Decision", lesson.reviewDecision ?? approvalStatus);
  field("Approval Comments", lesson.reviewComments);

  pages.forEach((commands, index) => {
    commands.push(`BT /F1 7 Tf 0.4 0.4 0.4 rg 1 0 0 1 ${MARGIN} 22 Tm (${pdfText(lesson.referenceNumber)} | Page ${index + 1} of ${pages.length}) Tj ET`);
  });

  const objects: string[] = [];
  const addObject = (value: string) => {
    objects.push(value);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];

  for (const commands of pages) {
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}