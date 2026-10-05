import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { TO_BE_MAPPED, type AuditPlanReportData } from "./audit-plan-report-data";

async function asset(name: string) {
  try { return await readFile(new URL(`./${name}`, import.meta.url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFile(new URL(`../assets/${name}`, import.meta.url));
  }
}
const purple = rgb(0.33, 0.18, 0.49), pale = rgb(0.86, 0.81, 0.92), black = rgb(0, 0, 0);
const white = rgb(1, 1, 1), grey = rgb(0.45, 0.45, 0.45);

export async function renderAuditPlanPdf(data: AuditPlanReportData): Promise<Uint8Array> {
  const [templateBytes, regularBytes, boldBytes] = await Promise.all([
    asset("audit-plan-template.pdf"), asset("DejaVuSans.ttf"), asset("DejaVuSans-Bold.ttf"),
  ]);
  const source = await PDFDocument.load(templateBytes);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const normal = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const overflow: Array<[string, string]> = [];
  const wrap = (text: string, width: number, size: number, font: PDFFont) => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const char of paragraph) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) {
          const space = line.lastIndexOf(" ");
          if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1) + char; }
          else { lines.push(line); line = char; }
        } else line += char;
      }
      lines.push(line);
    }
    return lines;
  };
  const text = (page: PDFPage, value: string, x: number, top: number, width: number, height: number,
    size = 10, isBold = false, color = black, center = false, label = "") => {
    const font = isBold ? bold : normal;
    let lines = wrap(value, width, size, font);
    while (size > 7 && lines.length * size * 1.25 > height) { size -= 0.5; lines = wrap(value, width, size, font); }
    if (lines.length * size * 1.25 > height) {
      overflow.push([label || value.slice(0, 50), value]);
      lines = [...lines.slice(0, Math.max(0, Math.floor(height / (size * 1.25)) - 1)), "See continuation"];
    }
    lines.forEach((line, i) => page.drawText(line, { x: center ? x + (width - font.widthOfTextAtSize(line, size)) / 2 : x,
      y: page.getHeight() - top - size - i * size * 1.25, size, font, color }));
  };
  const lineBox = (page: PDFPage, x: number, top: number, width: number, height: number, fill?: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: page.getHeight() - top - height, width, height, borderColor: grey, borderWidth: 0.5, ...(fill ? { color: fill } : {}) });
  const add = async (index: number) => { const [p] = await pdf.copyPages(source, [index]); return pdf.addPage(p); };
  const cover = await add(0);
  text(cover, data.title.toUpperCase(), 38, 274, 520, 45, 18, true, purple, true, "Audit title");
  text(cover, data.reference, 38, 335, 520, 18, 12, true, black, true, "Audit reference");
  text(cover, "PROJECT AUDIT PLAN", 38, 363, 520, 30, 20, true, white, true);
  const coverRow = (label: string, value: string, top: number, height: number) => {
    text(cover, label, 41, top + 5, 75, height - 8, 10, true);
    text(cover, value, 127, top + 5, 427, height - 8, 10, false, black, false, label);
  };
  coverRow("Lead/Internal\nAuditor", data.lead, 401, 36);
  coverRow("Audit Team", data.team, 437, 36);
  coverRow("Auditee", data.auditee, 473, 36);
  coverRow("Scope", data.scope, 509, 41);
  for (const [label, value, x, top, width] of [
    ["Audit Type", data.types, 41, 555, 75], ["Standard(s) Ref.", data.standards, 278, 555, 101],
    ["Audit\nLanguage", data.language, 41, 593, 75], ["SHEQ Audit Ref.", data.sheqReference, 278, 593, 101],
  ] as const) {
    text(cover, label, x, top, width, 29, 10, true);
    text(cover, value, x === 41 ? 127 : 390, top, x === 41 ? 140 : 164, 29, 9, false, black, false, label);
  }
  text(cover, `Revision: ${TO_BE_MAPPED}`, 370, 630, 189, 16, 8, false, black, true);

  const header = (page: PDFPage) => {
    text(page, "PROJECT AUDIT PLAN", 154, 53, 283, 24, 17, true, black, true);
    text(page, data.title.toUpperCase(), 38, 94, 516, 15, 9, true, black, true, "Audit title");
    const widths = [113, 213, 85, 113];
    const values = [data.project[1]![1], data.reference, data.auditNumber, data.preparedDate];
    const labels = ["Contract Number", "Audit Reference Number", "Audit No", "Date"];
    let x = 35;
    widths.forEach((width, i) => {
      text(page, values[i]!, x + 3, 111, width - 6, 13, 8, i === 1, black, true, labels[i]);
      text(page, labels[i]!, x + 3, 125, width - 6, 13, 8, true, black, true);
      x += width;
    });
  };
  let page = await add(1);
  header(page);
  text(page, "Start Times and Date of Audit:", 41, 152, 335, 18, 11, true, purple);
  text(page, "Remarks", 392, 152, 160, 18, 11, true, purple);
  [["Start Date:", data.start], ["End Date:", data.end], ["Opening Meeting:", data.opening], ["Closing Meeting:", data.closing]].forEach(([label, value], i) => {
    const top = 175 + i * 25;
    text(page, label!, 41, top, 165, 23, 11, true, purple);
    text(page, value!, 216, top, 160, 23, 10, false, black, false, label);
    text(page, TO_BE_MAPPED, 392, top, 159, 23, 9);
  });
  text(page, "Project Details", 41, 296, 512, 18, 11, true, purple, true);
  let top = 322;
  for (const [label, value] of data.project) {
    const height = label === "Project Name" ? 49 : 25;
    text(page, label, 41, top, 164, height - 6, 10, true, purple);
    text(page, value, 216, top, 337, height - 6, 10, false, black, false, label);
    top += height;
  }
  text(page, "Section/Activities to be\nAccessed", 40, 664, 179, 35, 11, true, purple, true);
  text(page, "Auditee", 225, 664, 159, 35, 11, true, purple, true);
   text(page, "Planned Start / Planned End", 390, 664, 164, 35, 11, true, purple, true);
  let y = 704;
  const newActivityPage = async (withTable = true) => {
    page = await add(2); header(page);
    if (!withTable) { y = 151; return; }
     [["Section/Activities to be Accessed", 35, 185], ["Auditee", 220, 165], ["Planned Start / Planned End", 385, 174]].forEach(([label, x, width]) => {
      lineBox(page, x as number, 151, width as number, 38, pale);
      text(page, label as string, (x as number) + 5, 157, (width as number) - 10, 29, 10, true, purple, true);
    });
    y = 189;
  };
  const activity = async (section: string, remarks: string, auditee: string, when: string) => {
    const cols = [wrap(`${section}\n${remarks}`, 175, 10, normal), wrap(auditee, 155, 10, normal), wrap(when, 164, 10, normal)];
    let remaining = Math.max(...cols.map(c => c.length));
    let offset = 0;
    while (remaining > 0) {
      const available = Math.floor((806 - y - 10) / 13);
      if (available < 2 || 806 - y < 40) { await newActivityPage(); continue; }
      const count = Math.min(remaining, available);
      const height = Math.max(40, count * 13 + 10);
      [35, 220, 385].forEach((x, i) => {
        const width = [185, 165, 174][i]!;
        lineBox(page, x, y, width, height, white);
        cols[i]!.slice(offset, offset + count).forEach((value, j) =>
          text(page, value, x + 5, y + 5 + j * 13, width - 10, 13, 10, i === 0 && offset + j === 0));
      });
      y += height; offset += count; remaining -= count;
    }
  };
  for (const row of data.activities) await activity(row.section, row.remarks, row.auditee, row.dateTime);
  // Fixed-size fields that exceed their template cell remain available in full.
  const continuations = overflow.splice(0);
  for (const [label, value] of continuations) await activity(`${label} (continuation)`, value, TO_BE_MAPPED, TO_BE_MAPPED);
  if (y > 600) await newActivityPage(false);
  const signatureTop = Math.max(y + 35, 560);
  text(page, `Signature: ${TO_BE_MAPPED}`, 47, signatureTop, 220, 23, 10);
  text(page, `Signature: ${TO_BE_MAPPED}`, 337, signatureTop, 217, 23, 10);
  text(page, "Prepared By\nLead Auditor", 36, signatureTop + 44, 235, 42, 11, true);
  text(page, data.lead, 36, signatureTop + 90, 235, 65, 10, false, black, false, "Prepared by");
  text(page, "QMS Audit Manager", 330, signatureTop + 44, 225, 24, 11, true, black, true);
  text(page, TO_BE_MAPPED, 330, signatureTop + 90, 225, 30, 10, false, black, true);
  pdf.getPages().forEach((p, i) => { if (i) text(p, `Page ${i + 1} of ${pdf.getPageCount()}`, 180, 807, 235, 11, 8, false, black, true); });
  pdf.setTitle(`Audit Plan - ${data.title}`); pdf.setCreator("QMS360");
  return pdf.save();
}