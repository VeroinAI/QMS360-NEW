import type { Document, Element } from "@xmldom/xmldom";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const nodes = (node: Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const LINE = 177800; // 14pt at an explicit 11pt font.
const INSET = 73152;
type OfiRow = { cells: string[]; height: number };
export type OfiPage = { rows: OfiRow[]; continuation?: { reference: string; lines: string[] } };

/** Conservative wrapping, preserving every character (including unbroken identifiers). */
function lines(text: string, width: number): string[] {
  // Include safety for italic template text and viewers that apply both the
  // cell margins and body insets. Wide glyphs must not trigger extra wrapping.
  const capacity = Math.max(1.2, (width - INSET * 4) / (11 * 12700));
  const units = (char: string) => /[MW@%]|[^\u0000-\u024f]/u.test(char) ? 1.2 : 0.8;
  return text.split(/\r?\n/).flatMap(paragraph => {
    const result: string[] = [];
    let line = "", used = 0;
    for (const char of paragraph) {
      if (used + units(char) > capacity && line) {
        const space = line.lastIndexOf(" ");
        if (space > line.length / 2) {
          result.push(line.slice(0, space + 1)); line = line.slice(space + 1);
          used = Array.from(line).reduce((n, c) => n + units(c), 0);
        } else { result.push(line); line = ""; used = 0; }
      }
      line += char; used += units(char);
    }
    return [...result, line];
  });
}

export function ofiPages(table: Element, rows: string[][]): OfiPage[] {
  const templateRows = nodes(table, A, "tr");
  const budget = templateRows.slice(2).reduce((sum, row) => sum + Number(row.getAttribute("h")), 0);
  const widths = nodes(table, A, "gridCol").map(col => Number(col.getAttribute("w")));
  const maxLines = Math.floor((budget - INSET * 2) / LINE);
  // Reserve one line for a continuation notice only for exceptional, page-sized cells.
  const pages: OfiPage[] = [{ rows: [] }];
  let used = 0;
  for (const row of rows) {
    const wrapped = row.map((cell, i) => lines(cell, widths[i]!));
    const overflow = wrapped.some(cell => cell.length > maxLines);
    const limit = overflow ? maxLines - 1 : maxLines;
    const cells = wrapped.map(cell => [
      ...cell.slice(0, limit), ...(cell.length > limit ? ["(Text continues)"] : []),
    ].join("\n"));
    const height = Math.max(676656, Math.max(...wrapped.map(cell => Math.min(cell.length, limit) + (cell.length > limit ? 1 : 0))) * LINE + INSET * 2);
    if (used + height > budget && pages.at(-1)!.rows.length) { pages.push({ rows: [] }); used = 0; }
    pages.at(-1)!.rows.push({ cells, height }); used += height;
    if (overflow) {
      const labels = ["Finding reference", "Audit area / finding", "Objective evidence", "Requirement", "Grade"];
      const rest = wrapped.flatMap((cell, col) => cell.length > limit
        ? lines(`${labels[col]} (continued)\n${cell.slice(limit).join("\n")}`, widths.reduce((a, b) => a + b, 0)) : []);
      const heading = lines(`Continued text for ${row[0]} — not an additional OFI`, widths.reduce((a, b) => a + b, 0));
      const capacity = Math.max(1, maxLines - heading.length);
      for (let i = 0; i < rest.length; i += capacity) pages.push({
        rows: [], continuation: { reference: row[0]!, lines: [...heading, ...rest.slice(i, i + capacity)] },
      });
      // A following finding starts on its own table page, never inside continuation text.
      pages.push({ rows: [] }); used = 0;
    }
  }
  if (pages.length > 1 && !pages.at(-1)!.rows.length && !pages.at(-1)!.continuation) pages.pop();
  return pages;
}

/** Explicit spacing is inserted BEFORE template bullet/default-run properties. */
function formatText(container: Element) {
  const doc = container.ownerDocument!;
  for (const body of nodes(container, A, "bodyPr")) {
    for (const tag of ["normAutofit", "spAutoFit", "noAutofit"]) for (const child of nodes(body, A, tag)) body.removeChild(child);
    body.setAttribute("wrap", "none");
    body.setAttribute("lIns", String(INSET)); body.setAttribute("rIns", String(INSET));
    body.setAttribute("tIns", "0"); body.setAttribute("bIns", "0");
    body.appendChild(doc.createElementNS(A, "a:noAutofit"));
  }
  for (const paragraph of nodes(container, A, "p")) {
    let props = nodes(paragraph, A, "pPr")[0];
    if (!props) { props = doc.createElementNS(A, "a:pPr"); paragraph.insertBefore(props, paragraph.firstChild); }
    for (const tag of ["lnSpc", "spcBef", "spcAft"]) for (const child of nodes(props, A, tag)) props.removeChild(child);
    for (const tag of ["spcAft", "spcBef", "lnSpc"]) {
      const spacing = doc.createElementNS(A, `a:${tag}`), value = doc.createElementNS(A, "a:spcPts");
      value.setAttribute("val", tag === "lnSpc" ? "1400" : "0");
      spacing.appendChild(value); props.insertBefore(spacing, props.firstChild);
    }
    for (const tag of ["rPr", "endParaRPr"]) for (const run of nodes(paragraph, A, tag)) run.setAttribute("sz", "1100");
  }
}

export function renderOfiPage(doc: Document, table: Element, page: OfiPage, setText: (node: Element, value: string) => void) {
  const rows = nodes(table, A, "tr"), prototype = rows[2]!.cloneNode(true) as Element;
  for (const row of rows.slice(2)) table.removeChild(row);
  for (const item of page.rows) {
    const row = prototype.cloneNode(true) as Element; row.setAttribute("h", String(item.height));
    nodes(row, A, "tc").forEach((cell, i) => {
      setText(cell, item.cells[i]!); formatText(cell);
      const props = nodes(cell, A, "tcPr")[0]!;
      props.setAttribute("marT", String(INSET)); props.setAttribute("marB", String(INSET)); props.setAttribute("anchor", "t");
    });
    table.appendChild(row);
  }
  let frame = table.parentNode as Element;
  while (frame.localName !== "graphicFrame") frame = frame.parentNode as Element;
  const height = nodes(table, A, "tr").reduce((sum, row) => sum + Number(row.getAttribute("h")), 0);
  nodes(frame, A, "ext")[0]!.setAttribute("cy", String(height));
  if (!page.rows.length) {
    // Empty state and continued prose are text boxes, never fabricated finding rows.
    const tree = frame.parentNode!;
    const box = doc.createElementNS(P, "p:sp");
    const id = Math.max(...nodes(tree as Element, P, "cNvPr").map(n => Number(n.getAttribute("id")))) + 1;
    const properties = doc.createElementNS(P, "p:nvSpPr");
    const info = doc.createElementNS(P, "p:cNvPr"); info.setAttribute("id", String(id)); info.setAttribute("name", "OFI section note");
    properties.appendChild(info); properties.appendChild(doc.createElementNS(P, "p:cNvSpPr")); properties.appendChild(doc.createElementNS(P, "p:nvPr")); box.appendChild(properties);
    const geometry = doc.createElementNS(P, "p:spPr"), transform = doc.createElementNS(A, "a:xfrm");
    const off = nodes(frame, A, "off")[0]!.cloneNode(true) as Element;
    off.setAttribute("y", String(Number(off.getAttribute("y")) + height + INSET));
    const ext = nodes(frame, A, "ext")[0]!.cloneNode(true) as Element; ext.setAttribute("cy", "3383280");
    transform.appendChild(off); transform.appendChild(ext); geometry.appendChild(transform); box.appendChild(geometry);
    const body = nodes(prototype, A, "txBody")[0]!.cloneNode(true) as Element;
    const txBody = doc.createElementNS(P, "p:txBody");
    for (const child of Array.from(body.childNodes)) txBody.appendChild(child.cloneNode(true));
    box.appendChild(txBody);
    const notice = page.continuation
      ? page.continuation.lines.join("\n")
      : "No opportunities for improvement recorded.";
    setText(box, notice); formatText(box); tree.appendChild(box);
  }
}
