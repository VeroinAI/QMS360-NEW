import type { Element } from "@xmldom/xmldom";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const nodes = (node: Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const LINE = 190500; // 15pt line spacing for the template's 12pt body text.
const INSET = 73152;
type SummaryRow = { cells: string[]; height: number; total: boolean };
export type SummaryPage = SummaryRow[];

/** Wrap without discarding spaces or characters in saved audit-area names. */
function wrap(text: string, width: number): string[] {
  const capacity = Math.max(1, (width - INSET * 4) / (12 * 12700));
  const units = (char: string) => /\s/u.test(char) ? 0.35 : /[MW@%]|[^\u0000-\u024f]/u.test(char) ? 1.2 : 0.65;
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

/** The builder supplies the grand Total last; never classify an area by its name. */
export function summaryPages(table: Element, rows: string[][]): SummaryPage[] {
  // Partial section exports have no summary source; do not fabricate one.
  if (!rows.length) return [];
  if (rows.at(-1)?.[0] !== "Total") {
    throw new Error("Findings summary is missing its final grand Total");
  }
  const templateRows = nodes(table, A, "tr");
  const budget = templateRows.slice(1).reduce((sum, row) => sum + Number(row.getAttribute("h")), 0);
  const minimum = Number(templateRows[1]!.getAttribute("h"));
  const widths = nodes(table, A, "gridCol").map(col => Number(col.getAttribute("w")));
  const pages: SummaryPage[] = [[]];
  let used = 0;
  rows.forEach((row, index) => {
    const wrapped = row.map((cell, col) => wrap(cell, widths[col]!));
    const height = Math.max(minimum, Math.max(...wrapped.map(lines => lines.length)) * LINE + INSET * 2);
    // Do not silently clip record text or generate extra audit-area/count rows.
    if (height > budget) throw new Error("Audit-area name is too long to fit on a findings-summary slide");
    if (used + height > budget) { pages.push([]); used = 0; }
    pages.at(-1)!.push({ cells: wrapped.map(lines => lines.join("\n")), height, total: index === rows.length - 1 });
    used += height;
  });
  return pages;
}

/** Rebuild only the summary's retained rows, using distinct body/Total prototypes. */
export function renderSummaryPage(table: Element, page: SummaryPage | undefined, setText: (cell: Element, value: string) => void) {
  let frame: Element | null = table;
  while (frame && !(frame.namespaceURI === P && frame.localName === "graphicFrame")) frame = frame.parentNode as Element | null;
  if (!frame) throw new Error("Findings summary has no graphic frame");
  // Theme-only continuations have no table, not a fresh set of template slots.
  if (!page) { frame.parentNode!.removeChild(frame); return; }
  const templateRows = nodes(table, A, "tr");
  // Use an interior body row: the first template row suppresses its top border,
  // which would also suppress the separators between repeated clones in Office.
  const body = templateRows[2]!, total = templateRows.at(-1)!;
  templateRows.slice(1).forEach(row => table.removeChild(row));
  page.forEach((item, index) => {
    const row = (item.total ? total : body).cloneNode(true) as Element;
    row.setAttribute("h", String(item.height));
    for (const id of Array.from(row.getElementsByTagName("*")).filter(node => node.localName === "rowId")) {
      id.setAttribute("val", String(10001 + index));
    }
    nodes(row, A, "tc").forEach((cell, col) => {
      setText(cell, item.cells[col]!);
      const bodyProps = nodes(cell, A, "bodyPr")[0]!;
      for (const attr of ["lIns", "rIns", "tIns", "bIns"]) bodyProps.setAttribute(attr, "0");
      bodyProps.setAttribute("wrap", "none");
      for (const fit of nodes(bodyProps, A, "normAutofit")) bodyProps.removeChild(fit);
      bodyProps.appendChild(table.ownerDocument!.createElementNS(A, "a:noAutofit"));
      for (const paragraph of nodes(cell, A, "p")) {
        const props = nodes(paragraph, A, "pPr")[0]!;
        for (const tag of ["lnSpc", "spcBef", "spcAft"]) {
          for (const old of nodes(props, A, tag)) props.removeChild(old);
        }
        // Insert spacing before the template's bullet properties, in schema order.
        const before = props.firstChild;
        for (const tag of ["lnSpc", "spcBef", "spcAft"]) {
          const spacing = table.ownerDocument!.createElementNS(A, `a:${tag}`);
          const points = table.ownerDocument!.createElementNS(A, "a:spcPts");
          points.setAttribute("val", tag === "lnSpc" ? "1500" : "0");
          spacing.appendChild(points); props.insertBefore(spacing, before);
        }
      }
    });
    table.appendChild(row);
  });
  nodes(frame, A, "ext")[0]!.setAttribute("cy",
    String(nodes(table, A, "tr").reduce((sum, row) => sum + Number(row.getAttribute("h")), 0)));
}
