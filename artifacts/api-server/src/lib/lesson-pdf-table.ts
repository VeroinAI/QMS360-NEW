import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

export type LessonBox = readonly [x: number, top: number, width: number, height: number];
export type LessonCell = {
  width: number;
  text?: string;
  bold?: boolean;
  label?: LessonBox;
  shade?: boolean;
  align?: "center" | "justify";
};
const BLACK = rgb(0, 0, 0), WHITE = rgb(1, 1, 1);
const SIZE = 9.5, LEADING = SIZE * 1.15, PADDING = 6;

export function wrapLessonText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        const characters = Array.from(line);
        let low = 1, high = characters.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (font.widthOfTextAtSize(characters.slice(0, middle).join(""), size) <= width) low = middle;
          else high = middle - 1;
        }
        lines.push(characters.slice(0, low).join(""));
        line = characters.slice(low).join("");
      }
    }
    lines.push(line);
  }
  return lines;
}

export function lessonParagraphLines(text: string, font: PDFFont, size: number, width: number) {
  return text.split(/\r?\n/).flatMap(paragraph => {
    const lines = wrapLessonText(paragraph, font, size, width);
    return lines.map((text, index) => ({ text, justify: index < lines.length - 1 }));
  });
}

/** Flow the original form's rows, never shrink text or clip it to a fixed cell. */
export async function lessonTable(
  document: PDFDocument, template: PDFPage, regular: PDFFont, bold: PDFFont,
) {
  const width = template.getWidth(), height = template.getHeight();
  const header = await document.embedPage(template, { left: 24, bottom: height - 78, right: 572, top: height - 24 });
  const footer = await document.embedPage(template, { left: 24, bottom: height - 816, right: 572, top: height - 807 });
  const firstTop = 83.1, bottom = 796, capacity = bottom - 107;
  let page: PDFPage;
  let top = firstTop;
  const pages: PDFPage[] = [];
  const newPage = () => {
    page = document.addPage([width, height]);
    page.drawPage(header, { x: 24, y: height - 78, width: 548, height: 54 });
    page.drawPage(footer, { x: 24, y: height - 816, width: 548, height: 9 });
    page.drawRectangle({ x: 24.25, y: height - 827.5, width: 546.75, height: 803.25,
      borderColor: BLACK, borderWidth: 0.5 });
    top = firstTop;
    if (pages.length) {
      page.drawText("Lesson Learned Form — continued", { x: 29, y: height - 95, size: 8, font: regular, color: BLACK });
      top = 107;
    }
    pages.push(page);
  };
  newPage();
  const crops = new Map<string, Awaited<ReturnType<PDFDocument["embedPage"]>>>();
  const crop = async (box: LessonBox) => {
    const key = box.join(",");
    if (!crops.has(key)) crops.set(key, await document.embedPage(template,
      { left: box[0], bottom: height - box[1] - box[3], right: box[0] + box[2], top: height - box[1] }));
    return crops.get(key)!;
  };
  const reserve = (rowHeight: number) => {
    if (top + rowHeight > bottom) newPage();
  };
  const band = async (box: LessonBox) => {
    reserve(box[3]);
    page.drawPage(await crop(box), { x: box[0], y: height - top - box[3], width: box[2], height: box[3] });
    const position = { page, top };
    top += box[3];
    return position;
  };
  const row = async (cells: LessonCell[], minimum = 28.5) => {
    const pending = cells.map(cell => cell.text == null ? [] :
      lessonParagraphLines(cell.text, cell.bold ? bold : regular, SIZE, cell.width - 2 * PADDING));
    const labelHeight = Math.max(minimum, ...cells.map(cell => (cell.label?.[3] ?? 0) + 2));
    const fullHeight = Math.max(labelHeight, ...pending.map(lines => lines.length * LEADING + 2 * PADDING));
    // Keep normal rows together. Exceptionally large rows split at line boundaries.
    if (fullHeight <= capacity) reserve(fullHeight);
    let more = true;
    while (more) {
      if (bottom - top < Math.max(labelHeight, LEADING + 2 * PADDING)) newPage();
      const count = Math.max(1, Math.floor((bottom - top - 2 * PADDING) / LEADING));
      const chunks = pending.map(lines => lines.splice(0, count));
      const rowHeight = Math.max(labelHeight, ...chunks.map(lines => lines.length * LEADING + 2 * PADDING));
      let x = 28.9;
      for (let index = 0; index < cells.length; index++) {
        const cell = cells[index]!, lines = chunks[index]!;
        page.drawRectangle({ x, y: height - top - rowHeight, width: cell.width, height: rowHeight,
          color: cell.label || cell.shade ? rgb(0.9, 0.9, 0.9) : WHITE, borderColor: BLACK, borderWidth: 0.4 });
        if (cell.label) {
          const label = await crop(cell.label);
          page.drawPage(label, { x: x + (cell.width - cell.label[2]) / 2, y: height - top - (rowHeight + cell.label[3]) / 2,
            width: cell.label[2], height: cell.label[3] });
        }
        const font = cell.bold ? bold : regular;
        let baseline = height - top - (rowHeight - lines.length * LEADING) / 2 - SIZE;
        for (const line of lines) {
          const options = { y: baseline, font, size: SIZE, color: BLACK };
          const words = line.text.split(" ");
          if (cell.align === "justify" && line.justify && words.length > 1) {
            const wordWidths = words.map(word => font.widthOfTextAtSize(word, SIZE));
            const gap = (cell.width - 2 * PADDING - wordWidths.reduce((sum, width) => sum + width, 0)) / (words.length - 1);
            let wordX = x + PADDING;
            words.forEach((word, index) => {
              page.drawText(word, { ...options, x: wordX });
              wordX += wordWidths[index]! + gap;
            });
          } else {
            // Word-style justification leaves paragraph endings and single-word
            // lines flush left. Metadata and signature cells remain centered.
            page.drawText(line.text, { ...options, x: cell.align === "justify" ? x + PADDING :
              x + (cell.width - font.widthOfTextAtSize(line.text, SIZE)) / 2 });
          }
          baseline -= LEADING;
        }
        x += cell.width;
      }
      top += rowHeight;
      more = pending.some(lines => lines.length > 0);
      if (more) newPage();
    }
  };
  const finish = () => {
    pages.forEach((sheet, index) => {
      const count = `${index + 1} of ${pages.length}`;
      sheet.drawRectangle({ x: 531, y: height - 815, width: 38.2, height: 7.2, color: WHITE });
      sheet.drawText(count, { x: 531 + (38.2 - regular.widthOfTextAtSize(count, 6)) / 2,
        y: height - 813.8, font: regular, size: 6, color: BLACK });
    });
  };
  return { row, band, finish, reserve };
}
