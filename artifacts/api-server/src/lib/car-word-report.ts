import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { CarWordReportData } from "./car-word-report-data";

export const CAR_WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const CAR_UNMAPPED = "To be mapped";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const descendants = (node: Element, tag: string): Element[] => Array.from(node.getElementsByTagNameNS(W, tag));

async function template() {
  try { return await readFile(new URL("./car-report-template.docx", import.meta.url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFile(new URL("../assets/car-report-template.docx", import.meta.url));
  }
}

/** Populate the supplied OOXML package; retain its original styles and assets. */
export async function renderCarWordReport(data: CarWordReportData): Promise<Buffer> {
  const files = unzipSync(await template());
  const doc = new DOMParser().parseFromString(strFromU8(files["word/document.xml"]!), "application/xml");
  const root = doc.documentElement!;
  const values: Record<string, string | null | undefined> = {
    "-1201463209": data.auditor, "-504516565": data.date, "779770119": data.carNumber,
    "1884369710": data.department, "1496295070": data.recipient, "1941564181": data.auditReference,
    "-1421410589": data.area, "1613621716": data.source, "-36133475": data.finding,
    "1631673595": data.dueDate, "1010558488": data.rootCause, "1373969618": data.correction,
    "1583333247": data.correctiveAction, "304437587": data.recipient, "1857460274": data.designation,
    "-665015059": data.actionDate, "-175108953": data.verifiedBy, "419685897": data.auditor,
    "-278731234": data.verifiedDate,
  };
  const checked: Record<string, boolean> = {
    "716246398": true, "1705132684": false, // Quality, not HSE
    "-1304687705": data.risk === "high", "1105468106": data.risk === "medium", "835885652": data.risk === "low",
    "-1193917427": data.accepted === true, "369803212": data.accepted === false,
    "1887141608": data.withinAcd === true, "-834984029": data.withinAcd === false,
    "-2024163192": data.completed === true, "-122385946": data.completed === false,
  };
  const writeText = (content: Element, value: string) => {
    const texts = descendants(content, "t");
    const first = texts[0];
    if (!first) throw new Error("CAR template field has no text run");
    // PlaceholderText is grey: actual values inherit the template's normal font.
    for (const style of descendants(content, "rStyle")) {
      if (style.getAttributeNS(W, "val") === "PlaceholderText") style.parentNode!.removeChild(style);
    }
    for (const text of texts.slice(1)) text.parentNode!.removeChild(text);
    const lines = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").split(/\r?\n/);
    first.textContent = lines[0]!;
    first.setAttribute("xml:space", "preserve");
    for (const line of lines.slice(1)) {
      first.parentNode!.appendChild(doc.createElementNS(W, "w:br"));
      const next = doc.createElementNS(W, "w:t");
      next.setAttribute("xml:space", "preserve");
      next.textContent = line;
      first.parentNode!.appendChild(next);
    }
  };
  const controls = descendants(root, "sdt");
  for (const control of controls) {
    const id = descendants(control, "id")[0]?.getAttributeNS(W, "val");
    const content = descendants(control, "sdtContent")[0];
    if (!id || !content) throw new Error("Invalid CAR template content control");
    const checkbox = Object.prototype.hasOwnProperty.call(checked, id);
    writeText(content, checkbox ? checked[id] ? "☒" : "☐" : values[id]?.trim() || CAR_UNMAPPED);
  }
  // Flatten populated controls so Word cannot restore date/dropdown placeholders.
  // Cell and row controls retain their original tables, spacing and borders.
  for (const control of controls.reverse()) {
    const content = descendants(control, "sdtContent")[0]!;
    const parent = control.parentNode!;
    while (content.firstChild) parent.insertBefore(content.firstChild, control);
    parent.removeChild(control);
  }
  const tables = descendants(root, "tbl");
  const cell = (table: number, row: number, column: number) =>
    descendants(descendants(tables[table]!, "tr")[row]!, "tc")[column]!;
  const appendValue = (target: Element, value: string) => {
    const p = doc.createElementNS(W, "w:p");
    const run = doc.createElementNS(W, "w:r");
    const props = doc.createElementNS(W, "w:rPr");
    for (const [tag, val] of [["color", "000000"], ["sz", "18"]]) {
      const setting = doc.createElementNS(W, `w:${tag}`);
      setting.setAttributeNS(W, "w:val", val!); props.appendChild(setting);
    }
    run.appendChild(props);
    const text = doc.createElementNS(W, "w:t"); text.textContent = value; run.appendChild(text);
    p.appendChild(run); target.appendChild(p);
  };
  // There is no record-specific signature data in CAR: never copy or fabricate it.
  for (const [t, r, c] of [[1, 10, 0], [1, 10, 2], [1, 19, 2], [2, 5, 1], [2, 5, 2], [2, 5, 3]]) {
    appendValue(cell(t!, r!, c!), CAR_UNMAPPED);
  }
  if (!data.risk) appendValue(cell(1, 0, 0), CAR_UNMAPPED);
  for (const [index, value] of [data.accepted, data.withinAcd, data.completed].entries()) {
    if (value == null) appendValue(cell(2, 0, index), CAR_UNMAPPED);
  }
  files["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(doc));
  return Buffer.from(zipSync(files));
}
