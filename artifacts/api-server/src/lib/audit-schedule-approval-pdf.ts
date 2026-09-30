import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type AuditScheduleApprovalPdfInput = {
  title: string;
  subject: string;
  memo: string;
  rows: Array<{
    title: string;
    fromDate: string;
    toDate: string;
    auditType?: string;
    departmentProject?: string;
    ownerName?: string;
    auditNumber?: string;
    qaqcReference?: string;
    scope?: string;
    clauses?: string;
    remarks?: string;
  }>;
};

const PAGE_WIDTH = 1684;
const PAGE_HEIGHT = 1191;
const MARGIN = 24;
const BOTTOM = 24;
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
  const timeline = programmeTimeline(yearForRows(input.rows));
  const fixedWidths = [150, 120, 100, 125, 110, 200, 140];
  const remarksWidth = 150;
  const fixedWidth = fixedWidths.reduce((sum, width) => sum + width, 0);
  const timelineWidth = PAGE_WIDTH - MARGIN * 2 - fixedWidth - remarksWidth;
  const weekWidth = timelineWidth / timeline.totalSlots;
  const columnHeaders = [
    "Business Category / Audit",
    "Department / Project",
    "Process Owner",
    "Audit Number / Site Visit No",
    "QA/QC Reference",
    "QA/QC Scope",
    "QA/QC Clauses",
  ];
  const rowValues = (row: ProgrammeRow) => [
    [row.title, row.auditType].filter(Boolean).join(" / "),
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

  const memoLines = wrapText(printable(input.memo), regular, 10, PAGE_WIDTH - MARGIN * 2 - 16);
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
  memoTop -= 16;

  const chartHeaderHeight = 62;
  const minRowHeight = 34;
  const chartStart = (chartPage: PDFPage, top: number) => {
    chartPage.drawText(`Audit Schedule Programme - ${yearForRows(input.rows)}`, {
      x: MARGIN, y: top - 23, size: 15, font: bold, maxWidth: PAGE_WIDTH - MARGIN * 2,
    });
    const tableTop = top - 31;
    let x = MARGIN;
    fixedWidths.forEach((width, index) => {
      drawBorder(chartPage, x, tableTop, width, 40, PURPLE);
      const headerLines = wrapText(columnHeaders[index]!, bold, 7, width - 10);
      drawLines(chartPage, headerLines.slice(0, 4), x, tableTop - 2, width, 36, bold, 7);
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

  // Keep the approval request and its programme together when practical. Longer memos
  // flow to additional pages before the chart begins.
  if (memoTop - BOTTOM >= chartHeaderHeight + minRowHeight) {
    var chartPage = page;
    var chartState = chartStart(chartPage, memoTop);
  } else {
    chartPage = addPage();
    chartState = chartStart(chartPage, PAGE_HEIGHT - MARGIN);
  }
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
      if (chartState.y - BOTTOM < minRowHeight) {
        chartPage = addPage();
        chartState = chartStart(chartPage, PAGE_HEIGHT - MARGIN);
      }
      const availableHeight = chartState.y - BOTTOM;
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

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function timelineYear(timeline: Timeline) {
  return new Date(timeline.startTime + 4 * 24 * 60 * 60 * 1000).getUTCFullYear();
}