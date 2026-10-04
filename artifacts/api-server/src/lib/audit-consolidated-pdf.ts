import { readFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportSectionData } from "./audit-consolidated-report";

async function asset(name: string) {
  try { return await readFile(new URL(`./${name}`, import.meta.url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFile(new URL(`../assets/${name}`, import.meta.url));
  }
}
export async function renderConsolidatedAuditPdf(input: {
  title: string; reference: string; sections: ReportSectionData[];
  photos?: Map<string, Uint8Array>;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setTitle(`Quality Internal Audit Report — ${input.title}`);
  pdf.setAuthor("QMS360"); pdf.setSubject(input.reference);
  const normal = await pdf.embedFont(await asset("DejaVuSans.ttf"), { subset: true });
  const bold = await pdf.embedFont(await asset("DejaVuSans-Bold.ttf"), { subset: true });
  const logo = await pdf.embedPng(await asset("memo-letterhead-logo.png"));
  const width = 960, height = 540, margin = 38, contentWidth = width - margin * 2;
  const ink = rgb(.13, .18, .17), green = rgb(.12, .36, .28), pale = rgb(.92, .96, .94), border = rgb(.77, .83, .8);
  let page!: PDFPage, y = 0, currentTitle = "";
  const wrap = (s: string, max: number, size = 10, isBold = false) => {
    const font = isBold ? bold : normal; const lines: string[] = [];
    for (const paragraph of s.replace(/\t/g, "    ").split(/\r?\n/)) {
      let line = "";
      for (const char of paragraph) {
        if (line && font.widthOfTextAtSize(line + char, size) > max) {
          const space = line.lastIndexOf(" ");
          if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1) + char; }
          else { lines.push(line); line = char; }
        } else line += char;
      }
      lines.push(line);
    }
    return lines;
  };
  const draw = (s: string, x: number, top: number, size = 10, isBold = false) =>
    page.drawText(s, { x, y: height - top - size, size, font: isBold ? bold : normal, color: isBold ? green : ink });
  const newPage = (continued = false) => {
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 0, y: height - 15, width, height: 15, color: green });
    const dims = logo.scaleToFit(95, 42);
    page.drawImage(logo, { x: width - margin - dims.width, y: height - 30 - dims.height, ...dims });
    draw("QUALITY INTERNAL AUDIT REPORT", margin, 30, 11, true);
    wrap(`${currentTitle}${continued ? " (continued)" : ""}`, contentWidth - 120, 20, true).slice(0, 2)
      .forEach((line, i) => draw(line, margin, 51 + i * 24, 20, true));
    y = 108;
  };
  const ensure = (space: number) => { if (y + space > height - 48) newPage(true); };
  const paragraph = (text: string, size = 10, isBold = false) => {
    for (const line of wrap(text, contentWidth, size, isBold)) {
      ensure(size * 1.4); draw(line, margin, y, size, isBold); y += size * 1.4;
    }
    y += 7;
  };
  const table = (data: ReportSectionData["tables"][number]) => {
    ensure(55); paragraph(data.title, 12, true);
    if (!data.rows.length) { paragraph("Not recorded."); return; }
    const cellWidth = contentWidth / Math.max(1, data.columns.length);
    const headerLines = data.columns.map(c => wrap(c, cellWidth - 12, 9, true));
    const headerHeight = Math.max(...headerLines.map(c => c.length)) * 12 + 12;
    const header = () => {
      ensure(headerHeight);
      page.drawRectangle({ x: margin, y: height - y - headerHeight, width: contentWidth, height: headerHeight, color: pale });
      headerLines.forEach((lines, col) => lines.forEach((line, n) => draw(line, margin + col * cellWidth + 6, y + 6 + n * 12, 9, true)));
      y += headerHeight;
    };
    header();
    for (const row of data.rows) {
      const cells = data.columns.map((_, i) => wrap(row[i] ?? "Not recorded", cellWidth - 12, 9));
      let offset = 0, total = Math.max(...cells.map(c => c.length));
      while (offset < total) {
        if (height - 48 - y < 30) { newPage(true); header(); }
        const count = Math.max(1, Math.min(total - offset, Math.floor((height - 48 - y - 12) / 12)));
        const rowHeight = count * 12 + 12;
        cells.forEach((lines, col) => {
          page.drawRectangle({ x: margin + col * cellWidth, y: height - y - rowHeight, width: cellWidth, height: rowHeight,
            borderColor: border, borderWidth: .4 });
          lines.slice(offset, offset + count).forEach((line, n) => draw(line, margin + col * cellWidth + 6, y + 6 + n * 12, 9));
        });
        y += rowHeight; offset += count;
        if (offset < total) { newPage(true); header(); }
      }
    }
    y += 15;
  };
  for (const section of input.sections) {
    currentTitle = section.title; newPage();
    for (const field of section.fields) {
      ensure(38); paragraph(field.label, 10, true); paragraph(field.value);
    }
    for (const data of section.tables) table(data);
    for (const photo of section.photos) {
      ensure(200);
      paragraph(`${photo.reference} — ${photo.fileName}`, 11, true);
      const bytes = input.photos?.get(photo.id);
      if (bytes) {
        const image = await pdf.embedPng(bytes);
        const dims = image.scaleToFit(contentWidth, 220);
        ensure(dims.height + 12);
        page.drawImage(image, { x: margin, y: height - y - dims.height, ...dims });
        y += dims.height + 12;
      } else paragraph("Photograph not available.");
      paragraph(photo.description);
    }
    for (const note of section.notes) paragraph(note, 9);
  }
  pdf.getPages().forEach((p, index) => {
    const footer = `${input.reference} | ${input.title}`;
    const line = wrap(footer, contentWidth - 90, 8)[0] ?? "";
    p.drawText(line, { x: margin, y: 22, size: 8, font: normal, color: ink });
    p.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: width - margin - 65, y: 22, size: 8, font: normal, color: ink });
  });
  return pdf.save();
}