import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type AuditScheduleApprovalPdfInput = {
  title: string;
  subject: string;
  memo: string;
  signatories?: {
    preparedBy?: ApprovalSignatory | null;
    reviewedBy?: ApprovalSignatory[];
    approvedBy?: ApprovalSignatory | null;
  };
  rows: Array<{
    title: string;
    fromDate: string;
    toDate: string;
    auditCategory?: string;
    departmentProject?: string;
    ownerName?: string;
    auditNumber?: string;
    qaqcReference?: string;
    scope?: string;
    clauses?: string;
    remarks?: string;
  }>;
};

type ApprovalSignatory = {
  name: string;
  designation?: string | null;
  role?: string | null;
  signatureDataUrl?: string | null;
};

const PAGE_WIDTH = 1684;
const PAGE_HEIGHT = 1191;
const MARGIN = 18;
const BOTTOM = 18;
// The same logo embedded in the approved Audit Schedule download template.
const PROGRAMME_LOGO_JPEG = "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";
const PURPLE = rgb(0.91, 0.89, 0.95);
const PALE_PURPLE = rgb(0.96, 0.95, 0.98);
const ALT_ROW = rgb(0.98, 0.98, 0.99);
const DARK_BLUE = rgb(0.1, 0.32, 0.58);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

type Timeline = ReturnType<typeof programmeTimeline>;
type ProgrammeRow = AuditScheduleApprovalPdfInput["rows"][number];

function printable(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "?");
}

function dateParts(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.slice(0, 10) ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month: month - 1, day };
}

function programmeTimeline(year: number) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const isoYearStart = (isoYear: number) => {
    const januaryFourth = new Date(Date.UTC(isoYear, 0, 4));
    const daysSinceMonday = (januaryFourth.getUTCDay() + 6) % 7;
    return Date.UTC(isoYear, 0, 4 - daysSinceMonday);
  };
  const startTime = isoYearStart(year);
  const endTime = isoYearStart(year + 1);
  const totalSlots = Math.round((endTime - startTime) / weekMs);
  const labels = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthBoundary = (month: number) => Math.max(0, Math.min(
    totalSlots,
    (Date.UTC(year, month, 1) - startTime) / weekMs,
  ));
  const monthStartSlots = labels.map((_, index) => index === 0 ? 0 : monthBoundary(index));
  const months = labels.map((label, index) => {
    const startSlot = monthStartSlots[index]!;
    const endSlot = index === labels.length - 1 ? totalSlots : monthBoundary(index + 1);
    return { label, weeks: endSlot - startSlot };
  });
  return { months, monthStartSlots, totalSlots, weekNumbers: Array.from({ length: totalSlots }, (_, index) => index + 1), startTime, weekMs };
}

function timelinePosition(value: string | null | undefined, end: boolean, timeline: Timeline) {
  const parsed = dateParts(value);
  if (!parsed) return 0;
  const dateTime = Date.UTC(parsed.year, parsed.month, parsed.day);
  if (dateTime < timeline.startTime) return 0;
  if (dateTime >= timeline.startTime + timeline.totalSlots * timeline.weekMs) return timeline.totalSlots;
  return (dateTime - timeline.startTime + (end ? 24 * 60 * 60 * 1000 : 0)) / timeline.weekMs;
}

function wrapText(value: string, font: PDFFont, size: number, width: number) {
  const paragraphs = value.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const originalWord of words) {
      let word = originalWord;
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut -= 1;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawBorder(page: PDFPage, x: number, top: number, width: number, height: number, fill?: ReturnType<typeof rgb>) {
  page.drawRectangle({
    x,
    y: top - height,
    width,
    height,
    color: fill,
    borderColor: rgb(0.45, 0.45, 0.45),
    borderWidth: 0.35,
  });
}

function drawCentered(page: PDFPage, value: string, x: number, top: number, width: number, height: number, font: PDFFont, size: number, color = BLACK) {
  const text = printable(value);
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: x + Math.max(2, (width - textWidth) / 2),
    y: top - height / 2 - size * 0.34,
    size,
    font,
    color,
    maxWidth: Math.max(2, width - 4),
  });
}

function drawLines(page: PDFPage, lines: string[], x: number, top: number, width: number, height: number, font: PDFFont, size: number) {
  const lineHeight = size + 2;
  const shown = lines;
  const contentHeight = shown.length * lineHeight;
  let y = top - Math.max(5, (height - contentHeight) / 2) - size;
  for (const line of shown) {
    page.drawText(printable(line), { x: x + 4, y, size, font, maxWidth: Math.max(1, width - 8) });
    y -= lineHeight;
  }
}

function yearForRows(rows: ProgrammeRow[]) {
  for (const row of rows) {
    const parsed = dateParts(row.fromDate) ?? dateParts(row.toDate);
    if (parsed) return parsed.year;
  }
  return new Date().getFullYear();
}

export async function renderAuditScheduleApprovalPdf(input: AuditScheduleApprovalPdfInput): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.setTitle(printable(input.title) || "Audit Schedule Approval");
  document.setSubject(printable(input.subject));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedJpg(Buffer.from(PROGRAMME_LOGO_JPEG, "base64"));
  const timeline = programmeTimeline(yearForRows(input.rows));
  const fixedWidths = [105, 135, 100, 120, 105, 180, 130];
  const remarksWidth = 130;
  const fixedWidth = fixedWidths.reduce((sum, width) => sum + width, 0);
  const timelineWidth = PAGE_WIDTH - MARGIN * 2 - fixedWidth - remarksWidth;
  const weekWidth = timelineWidth / timeline.totalSlots;
  const columnHeaders = [
    "Business Category",
    "Department / Project",
    "Process Owner",
    "Audit Number / Site Visit No",
    "QA/QC Reference",
    "QA/QC Scope",
    "QA/QC Clauses",
  ];
  const rowValues = (row: ProgrammeRow) => [
    row.auditCategory ?? row.title,
    row.departmentProject ?? "",
    row.ownerName ?? "",
    row.auditNumber ?? "",
    row.qaqcReference ?? "",
    row.scope ?? "",
    row.clauses ?? "",
  ];
  const addPage = () => document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  let page = addPage();
  let memoTop = PAGE_HEIGHT - MARGIN;
  const drawMemoHeader = (continued: boolean) => {
    page.drawText(printable(input.title) || "Audit Schedule Approval", {
      x: MARGIN, y: memoTop - 31, size: 20, font: bold, maxWidth: PAGE_WIDTH - MARGIN * 2,
    });
    if (continued) {
      page.drawText("(Memo continued)", { x: MARGIN, y: memoTop - 49, size: 9, font: regular });
      memoTop -= 64;
    } else {
      memoTop -= 48;
    }
  };
  drawMemoHeader(false);
  const subjectLines = wrapText(printable(input.subject) || "(No subject)", bold, 11, PAGE_WIDTH - MARGIN * 2 - 82);
  const subjectHeight = Math.max(30, subjectLines.length * 15 + 12);
  drawBorder(page, MARGIN, memoTop, PAGE_WIDTH - MARGIN * 2, subjectHeight, PURPLE);
  page.drawText("Subject", { x: MARGIN + 10, y: memoTop - 20, size: 10, font: bold });
  drawLines(page, subjectLines, MARGIN + 75, memoTop - 2, PAGE_WIDTH - MARGIN * 2 - 85, subjectHeight - 4, regular, 10);
  memoTop -= subjectHeight + 12;
  page.drawText("Submitted Memo", { x: MARGIN, y: memoTop - 12, size: 11, font: bold });
  memoTop -= 21;

  // Normalize characters per paragraph so line breaks in the submitted memo
  // survive PDF font encoding instead of turning into question marks.
  const memoText = String(input.memo ?? "").replace(/\r\n?/g, "\n").split("\n").map(printable).join("\n");
  const memoLines = wrapText(memoText, regular, 10, PAGE_WIDTH - MARGIN * 2 - 16);
  const memoLineHeight = 13;
  let memoIndex = 0;
  while (memoIndex < memoLines.length) {
    const availableLines = Math.floor((memoTop - BOTTOM - 8) / memoLineHeight);
    if (availableLines < 1) {
      page = addPage();
      memoTop = PAGE_HEIGHT - MARGIN;
      drawMemoHeader(true);
      continue;
    }
    const count = Math.min(availableLines, memoLines.length - memoIndex);
    for (const line of memoLines.slice(memoIndex, memoIndex + count)) {
      page.drawText(printable(line), { x: MARGIN + 8, y: memoTop - 10, size: 10, font: regular, maxWidth: PAGE_WIDTH - MARGIN * 2 - 16 });
      memoTop -= memoLineHeight;
    }
    memoIndex += count;
  }
  // A chart is always a fresh page: the submitted memo must stand alone, even
  // when it is short enough to leave space beneath it.
  const footerHeight = input.signatories
    ? Math.max(112, 30 + (input.signatories.reviewedBy?.length ?? 0) * 62)
    : 0;
  const chartBottom = BOTTOM + footerHeight + (footerHeight ? 10 : 0);
  const minRowHeight = 34;
  const chartStart = (chartPage: PDFPage, top: number) => {
    const titleHeight = 44;
    const headingLeftWidth = 128;
    const headingRightWidth = 84;
    const headingCenterWidth = PAGE_WIDTH - MARGIN * 2 - headingLeftWidth - headingRightWidth;
    drawBorder(chartPage, MARGIN, top, headingLeftWidth, titleHeight);
    drawBorder(chartPage, MARGIN + headingLeftWidth, top, headingCenterWidth, titleHeight);
    drawBorder(chartPage, PAGE_WIDTH - MARGIN - headingRightWidth, top, headingRightWidth, titleHeight);
    const logoHeight = 36;
    const logoWidth = logoHeight * 180 / 59;
    chartPage.drawImage(logo, {
      x: MARGIN + (headingLeftWidth - logoWidth) / 2,
      y: top - titleHeight + (titleHeight - logoHeight) / 2,
      width: logoWidth,
      height: logoHeight,
    });
    drawCentered(chartPage, input.title, MARGIN + headingLeftWidth, top, headingCenterWidth, titleHeight, bold, 10);
    const tableTop = top - titleHeight;
    let x = MARGIN;
    fixedWidths.forEach((width, index) => {
      drawBorder(chartPage, x, tableTop, width, 40, PURPLE);
      const headerLines = wrapText(columnHeaders[index]!, bold, 5.2, width - 10);
      drawLines(chartPage, headerLines.slice(0, 4), x, tableTop, width, 40, bold, 5.2);
      x += width;
    });
    const timelineX = x;
    const headerBottom = tableTop - 40;
    timeline.months.forEach((month, index) => {
      const monthX = timelineX + timeline.monthStartSlots[index]! * weekWidth;
      const monthWidth = month.weeks * weekWidth;
      if (monthWidth <= 0) return;
      drawBorder(chartPage, monthX, tableTop, monthWidth, 20, PURPLE);
      drawCentered(chartPage, month.label, monthX, tableTop, monthWidth, 20, bold, 6.3);
    });
    for (let week = 0; week < timeline.totalSlots; week += 1) {
      const weekX = timelineX + week * weekWidth;
      drawBorder(chartPage, weekX, headerBottom, weekWidth, 20, PALE_PURPLE);
      drawCentered(chartPage, `W${timeline.weekNumbers[week]}`, weekX, headerBottom, weekWidth, 20, regular, 5.2);
    }
    drawBorder(chartPage, timelineX + timelineWidth, tableTop, remarksWidth, 40, PURPLE);
    drawCentered(chartPage, "Remarks", timelineX + timelineWidth, tableTop, remarksWidth, 40, bold, 8);
    return { y: headerBottom - 1, timelineX };
  };

  let chartPage = addPage();
  let chartState = chartStart(chartPage, PAGE_HEIGHT - MARGIN);
  const rowsToRender: Array<ProgrammeRow | null> = input.rows.length ? input.rows : [null];
  for (let rowIndex = 0; rowIndex < rowsToRender.length; rowIndex += 1) {
    const row = rowsToRender[rowIndex];
    const values = row ? rowValues(row) : ["No audit schedule rows", "", "", "", "", "", ""];
    const wrapped = values.map((value, index) => wrapText(printable(value), regular, 7, fixedWidths[index]! - 10));
    wrapped.push(wrapText(printable(row?.remarks ?? ""), regular, 7, remarksWidth - 10));
    const maxLineCount = Math.max(1, ...wrapped.map(lines => lines.length));
    let lineOffset = 0;
    let fragmentIndex = 0;
    while (lineOffset < maxLineCount) {
      if (chartState.y - chartBottom < minRowHeight) {
        chartPage = addPage();
        chartState = chartStart(chartPage, PAGE_HEIGHT - MARGIN);
      }
      const availableHeight = chartState.y - chartBottom;
      const maxFragmentLines = Math.floor((availableHeight - 8) / 9);
      if (maxFragmentLines < 1) {
        chartPage = addPage();
        chartState = chartStart(chartPage, PAGE_HEIGHT - MARGIN);
        continue;
      }
      const fragmentLines = Math.min(maxFragmentLines, maxLineCount - lineOffset);
      const rowHeight = Math.max(minRowHeight, fragmentLines * 9 + 8);
      const rowTop = chartState.y;
      const rowBottom = rowTop - rowHeight;
      const fill = rowIndex % 2 ? ALT_ROW : WHITE;
      let cellX = MARGIN;
      fixedWidths.forEach((width, index) => {
        drawBorder(chartPage, cellX, rowTop, width, rowHeight, fill);
        drawLines(chartPage, wrapped[index]!.slice(lineOffset, lineOffset + fragmentLines), cellX, rowTop, width, rowHeight, regular, 7);
        cellX += width;
      });
      const timelineX = chartState.timelineX;
      chartPage.drawRectangle({
        x: timelineX, y: rowBottom, width: timelineWidth, height: rowHeight,
        color: fill, borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.35,
      });
      for (let week = 1; week < timeline.totalSlots; week += 1) {
        const weekX = timelineX + week * weekWidth;
        chartPage.drawLine({
          start: { x: weekX, y: rowBottom },
          end: { x: weekX, y: rowTop },
          color: rgb(0.78, 0.78, 0.78),
          thickness: 0.25,
        });
      }
      const remarksX = timelineX + timelineWidth;
      drawBorder(chartPage, remarksX, rowTop, remarksWidth, rowHeight, fill);
      drawLines(chartPage, wrapped[7]!.slice(lineOffset, lineOffset + fragmentLines), remarksX, rowTop, remarksWidth, rowHeight, regular, 7);

      if (row && fragmentIndex === 0) {
        const start = Math.max(0, Math.min(timeline.totalSlots, timelinePosition(row.fromDate, false, timeline)));
        const end = Math.max(0, Math.min(timeline.totalSlots, timelinePosition(row.toDate, true, timeline)));
        const barWidth = Math.max(0, end - start) * weekWidth;
        if (barWidth > 0 && end >= start) {
          chartPage.drawRectangle({
            x: timelineX + start * weekWidth,
            y: rowBottom + 8,
            width: Math.max(2, barWidth),
            height: Math.max(4, rowHeight - 16),
            color: DARK_BLUE,
          });
        }
      }
      chartState.y = rowBottom;
      lineOffset += fragmentLines;
      fragmentIndex += 1;
    }
  }

  if (input.signatories) {
    const footerWidth = (PAGE_WIDTH - MARGIN * 2) / 3;
    const groups = [
      { label: "Prepared By", people: input.signatories.preparedBy ? [input.signatories.preparedBy] : [] },
      { label: "Reviewed By", people: input.signatories.reviewedBy ?? [] },
      { label: "Approved By", people: input.signatories.approvedBy ? [input.signatories.approvedBy] : [] },
    ];
    for (const [column, group] of groups.entries()) {
      const x = MARGIN + column * footerWidth;
      drawBorder(chartPage, x, BOTTOM + footerHeight, footerWidth, footerHeight);
      chartPage.drawText(group.label, { x: x + 5, y: BOTTOM + footerHeight - 14, font: bold, size: 7 });
      const personHeight = (footerHeight - 26) / Math.max(1, group.people.length);
      for (const [index, person] of group.people.entries()) {
        const top = BOTTOM + footerHeight - 23 - index * personHeight;
        const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+=*)$/i.exec(person.signatureDataUrl ?? "");
        if (match) {
          const bytes = Buffer.from(match[2]!, "base64");
          const image = match[1]!.toLowerCase() === "png"
            ? await document.embedPng(bytes) : await document.embedJpg(bytes);
          const scale = Math.min(100 / image.width, 18 / image.height);
          chartPage.drawImage(image, {
            x: x + (footerWidth - image.width * scale) / 2,
            y: top - 28,
            width: image.width * scale,
            height: image.height * scale,
          });
        }
        let y = top - 40;
        for (const [lineIndex, value] of [person.name, person.designation, person.role].filter(Boolean).entries()) {
          for (const line of wrapText(printable(value), lineIndex ? regular : bold, lineIndex ? 6 : 6.5, footerWidth - 14).slice(0, 2)) {
            drawCentered(chartPage, line, x, y + 8, footerWidth, 9, lineIndex ? regular : bold, lineIndex ? 6 : 6.5);
            y -= 9;
          }
        }
      }
    }
  }

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function timelineYear(timeline: Timeline) {
  return new Date(timeline.startTime + 4 * 24 * 60 * 60 * 1000).getUTCFullYear();
}