import type { Element } from "@xmldom/xmldom";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const nodes = (node: Element, tag: string) => Array.from(node.getElementsByTagNameNS(A, tag));
export const CAR_HEADERS = ["Ref", "Grade", "Root cause", "Correction", "Corrective action", "Owner", "Due date", "Status", "Verified by / date"];
// Sum equals the branded frame's original width; no changes to other slides.
const WIDTHS = [1005840, 685800, 1554480, 1691640, 1691640, 1143000, 914400, 1051560, 1353312];
const LINE = 152400; // 12pt spacing, 10pt text.
const INSET = 36576;
const HEADER = 609600;
const BUDGET = 4352544 - HEADER;
type CarRow = { cells: string[]; height: number };
export type CarPage = CarRow[];

/** Preserve whitespace and unbroken identifiers, allowing for italic/wide glyphs. */
function wrap(text: string, width: number): string[] {
  const capacity = (width - INSET * 4) / 127000;
  const units = (char: string) => /\s/u.test(char) ? 0.35 : /[MW@%]|[^\u0000-\u024f]/u.test(char) ? 1.2 : 0.7;
  return text.split(/\r?\n/).flatMap(paragraph => {
    const lines: string[] = [];
    let line = "", used = 0;
    for (const char of paragraph) {
      if (line && used + units(char) > capacity) {
        const space = line.lastIndexOf(" ");
        if (space > line.length / 2) {
          lines.push(line.slice(0, space + 1)); line = line.slice(space + 1);
          used = Array.from(line).reduce((sum, c) => sum + units(c), 0);
        } else { lines.push(line); line = ""; used = 0; }
      }
      line += char; used += units(char);
    }
    return [...lines, line];
  });
}

export function carPages(rows: string[][]): CarPage[] {
  if (!rows.length) return [[{ cells: ["No CAR responses recorded", ...Array<string>(8).fill("-")], height: 762000 }]];
  const pages: CarPage[] = [[]];
  let used = 0;
  const limit = Math.floor((BUDGET - INSET * 2) / LINE);
  for (const row of rows) {
    if (row.length !== 9) throw new Error("PowerPoint CAR tracker requires nine separate columns");
    const wrapped = row.map((cell, col) => wrap(cell, WIDTHS[col]!));
    // Reserve reference space for the continuation marker; each part retains
    // its reference and short workflow/ownership values, never another CAR's.
    const reference = wrap(`${row[0]} (continued)`, WIDTHS[0]!);
    if (reference.length > limit) throw new Error("CAR reference is too long to fit on a tracker slide");
    const count = Math.max(1, ...wrapped.map(cell => Math.ceil(cell.length / limit)));
    for (let part = 0; part < count; part++) {
      const cells = wrapped.map((cell, col) => col === 0 && part ? reference
        : part && col >= 5 && cell.length <= limit ? cell
        : cell.slice(part * limit, (part + 1) * limit));
      const height = Math.max(566928, Math.max(...cells.map(cell => cell.length)) * LINE + INSET * 2);
      if (used + height > BUDGET && pages.at(-1)!.length) { pages.push([]); used = 0; }
      pages.at(-1)!.push({ cells: cells.map(cell => cell.join("\n")), height });
      used += height;
    }
  }
  return pages;
}

function format(cell: Element) {
  const doc = cell.ownerDocument!;
  const body = nodes(cell, "bodyPr")[0]!;
  for (const tag of ["normAutofit", "spAutoFit", "noAutofit"]) for (const child of nodes(body, tag)) body.removeChild(child);
  body.setAttribute("wrap", "none");
  for (const attr of ["lIns", "rIns", "tIns", "bIns"]) body.setAttribute(attr, "0");
  body.appendChild(doc.createElementNS(A, "a:noAutofit"));
  const tcPr = nodes(cell, "tcPr")[0]!;
  for (const attr of ["marL", "marR", "marT", "marB"]) tcPr.setAttribute(attr, String(INSET));
  tcPr.setAttribute("anchor", "t");
  for (const paragraph of nodes(cell, "p")) {
    let props = nodes(paragraph, "pPr")[0];
    if (!props) { props = doc.createElementNS(A, "a:pPr"); paragraph.insertBefore(props, paragraph.firstChild); }
    for (const tag of ["lnSpc", "spcBef", "spcAft"]) for (const child of nodes(props, tag)) props.removeChild(child);
    for (const tag of ["spcAft", "spcBef", "lnSpc"]) {
      const spacing = doc.createElementNS(A, `a:${tag}`), value = doc.createElementNS(A, "a:spcPts");
      value.setAttribute("val", tag === "lnSpc" ? "1200" : "0");
      spacing.appendChild(value); props.insertBefore(spacing, props.firstChild);
    }
    for (const tag of ["rPr", "endParaRPr"]) for (const run of nodes(paragraph, tag)) run.setAttribute("sz", "1000");
  }
}

/** Extend only the pristine tracker table; keep the supplied binary template intact. */
export function renderCarPage(table: Element, page: CarPage, setText: (cell: Element, value: string) => void) {
  const rows = nodes(table, "tr");
  const header = rows[0]!.cloneNode(true) as Element;
  const prototype = rows[2]!.cloneNode(true) as Element;
  const grid = nodes(table, "tblGrid")[0]!;
  const column = nodes(grid, "gridCol")[0]!.cloneNode(true) as Element;
  for (const child of nodes(grid, "gridCol")) grid.removeChild(child);
  for (const width of WIDTHS) {
    const col = column.cloneNode(true) as Element; col.setAttribute("w", String(width)); grid.appendChild(col);
  }
  for (const row of rows) table.removeChild(row);
  const fill = (row: Element, values: string[], height: number, headings = false) => {
    const old = nodes(row, "tc");
    // Duplicate only the combined response cell, shifting owner and later cells.
    row.insertBefore(old[3]!.cloneNode(true), old[4]!);
    row.setAttribute("h", String(height));
    nodes(row, "tc").forEach((cell, col) => {
      setText(cell, headings ? wrap(values[col]!, WIDTHS[col]!).join("\n") : values[col]!);
      format(cell);
    });
    table.appendChild(row);
  };
  fill(header, CAR_HEADERS, HEADER, true);
  for (const item of page) fill(prototype.cloneNode(true) as Element, item.cells, item.height);
  let frame = table;
  while (!(frame.namespaceURI === P && frame.localName === "graphicFrame")) frame = frame.parentNode as Element;
  nodes(frame, "ext")[0]!.setAttribute("cy", String(HEADER + page.reduce((sum, row) => sum + row.height, 0)));
}
