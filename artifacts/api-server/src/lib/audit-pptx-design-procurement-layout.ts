import type { Document, Element } from "@xmldom/xmldom";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const TOP = 1600200, BOTTOM = 6035040, WIDTH = 4983480;
const TITLE = 274320, GAP = 91440, HEADER = 283464, LINE = 177800, PAD = 36576;
const X = [777240, 6428232];
const WIDTHS = [[2743200, 1097280, 1143000], [3840480, 1143000]];
const LABELS = ["Design submittals (DTS)", "Procurement"];
const BOX_X_INSET = 137160, BOX_Y_INSET = 109728;
const nodes = (node: Element | Document, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
type Entry = { kind: "row"; cells: string[]; height: number }
  | { kind: "note"; text: string; height: number; role: "check" | "comment" };
type Fragment = { section: number; column: number; y: number; continued: boolean; header: boolean;
  commentY: number; commentHeight: number; entries: Entry[] };
export type DesignProcurementPage = Fragment[];

/** Explicit conservative wrapping keeps saved text intact, including long identifiers. */
function wrap(value: string, width: number): string[] {
  const capacity = (width - PAD * 4) / 139700;
  const weight = (c: string) => /[MW@%]|[^\u0000-\u024f]/u.test(c) ? 1.1 : 0.65;
  return value.split(/\r?\n/).flatMap(paragraph => {
    const result: string[] = [];
    let line = "", used = 0;
    for (const char of paragraph) {
      if (used + weight(char) > capacity && line) {
        const space = line.lastIndexOf(" ");
        const cut = space > line.length / 2 ? space + 1 : line.length;
        result.push(line.slice(0, cut)); line = line.slice(cut);
        used = Array.from(line).reduce((sum, c) => sum + weight(c), 0);
      }
      line += char; used += weight(char);
    }
    return [...result, line];
  });
}

export function designProcurementPages(rows: string[][][], comments: string[], check: string): DesignProcurementPage[] {
  const rowStreams: Entry[][] = [0, 1].map(section =>
    (rows[section] ?? []).flatMap(row => {
      const cells = row.map((cell, col) => wrap(cell, WIDTHS[section]![col]!));
      const count = Math.max(1, ...cells.map(cell => Math.ceil(cell.length / 16)));
      return Array.from({ length: count }, (_, part): Entry => {
        const text = cells.map((cell, col) => {
          const chunk = cell.slice(part * 16, (part + 1) * 16).join("\n");
          return part && col === 0 ? `(continued)\n${chunk || row[0]}` : chunk || "-";
        });
        return { kind: "row", cells: text,
          height: Math.max(HEADER, Math.max(...text.map(cell => cell.split("\n").length)) * LINE + PAD * 2) };
      });
    }));
  const commentStreams = [0, 1].map(section => wrap(comments[section] || "Comment: -", WIDTH - 2 * BOX_X_INSET));
  const checkLines = check ? wrap(check, WIDTH) : [];
  const cursors = [0, 0], commentCursors = [0, 0], pages: DesignProcurementPage[] = [];
  let checked = !check;
  while (pages.length === 0 || rowStreams.some((stream, i) => cursors[i]! < stream.length)
    || commentStreams.some((stream, i) => commentCursors[i]! < stream.length)) {
    // Each subject stays in its original panel. Reserve a real, padded white
    // comment box before filling tables; never place Design under Procurement.
    const page: DesignProcurementPage = [];
    let commentY = TOP + TITLE + GAP + HEADER + GAP;
    for (let section = 0; section < 2; section++) {
      const entries: Entry[] = [], stream = rowStreams[section]!;
      let y = TOP + TITLE + GAP + HEADER;
      const checkHeight = section === 0 && !checked ? checkLines.length * LINE + GAP : 0;
      const rowBottom = BOTTOM - GAP - 2 * BOX_Y_INSET - LINE - checkHeight;
      while (cursors[section]! < stream.length && y + stream[cursors[section]!]!.height <= rowBottom) {
        const entry = stream[cursors[section]!]!;
        entries.push(entry); y += entry.height; cursors[section]!++;
      }
      if (!stream.length && !pages.length) {
        const empty = { kind: "row" as const, cells: [
          `No ${section ? "procurement items" : "design submittals"} recorded.`,
          ...Array(section ? 1 : 2).fill("-"),
        ], height: HEADER };
        entries.push(empty); y += empty.height;
      }
      if (section === 0 && !checked && cursors[section] === stream.length) {
        y += GAP;
        for (const text of checkLines) entries.push({ kind: "note", role: "check", text, height: LINE });
        y += checkLines.length * LINE; checked = true;
      }
      commentY = Math.max(commentY, y + GAP);
      page.push({ section, column: section, y: TOP, continued: pages.length > 0, header: true,
        commentY: 0, commentHeight: 0, entries });
    }
    const capacity = Math.floor((BOTTOM - commentY - 2 * BOX_Y_INSET) / LINE);
    if (capacity < 1) throw new Error("Design/procurement comment box cannot fit within the slide");
    for (const fragment of page) {
      const section = fragment.section;
      fragment.commentY = commentY; fragment.commentHeight = BOTTOM - commentY;
      if (cursors[section]! < rowStreams[section]!.length) continue;
      for (const text of commentStreams[section]!.slice(commentCursors[section], commentCursors[section]! + capacity))
        fragment.entries.push({ kind: "note", role: "comment", text, height: LINE });
      commentCursors[section] = Math.min(commentStreams[section]!.length, commentCursors[section]! + capacity);
    }
    pages.push(page);
  }
  return pages;
}

function format(node: Element) {
  const doc = node.ownerDocument!;
  for (const body of nodes(node, A, "bodyPr")) {
    for (const child of Array.from(body.childNodes)) if (child.nodeType === 1 && ["noAutofit", "normAutofit", "spAutoFit"].includes((child as Element).localName ?? "")) body.removeChild(child);
    for (const side of ["lIns", "rIns", "tIns", "bIns"]) body.setAttribute(side, "0");
    body.setAttribute("wrap", "none"); body.appendChild(doc.createElementNS(A, "a:noAutofit"));
  }
  for (const paragraph of nodes(node, A, "p")) {
    let props = nodes(paragraph, A, "pPr")[0];
    if (!props) { props = doc.createElementNS(A, "a:pPr"); paragraph.insertBefore(props, paragraph.firstChild); }
    props.setAttribute("marL", "0"); props.setAttribute("indent", "0");
    for (const tag of ["lnSpc", "spcBef", "spcAft"]) for (const old of nodes(props, A, tag)) props.removeChild(old);
    for (const tag of ["spcAft", "spcBef", "lnSpc"]) {
      const spacing = doc.createElementNS(A, `a:${tag}`), value = doc.createElementNS(A, "a:spcPts");
      value.setAttribute("val", tag === "lnSpc" ? "1400" : "0"); spacing.appendChild(value); props.insertBefore(spacing, props.firstChild);
    }
    for (const tag of ["rPr", "endParaRPr"]) for (const run of nodes(paragraph, A, tag)) run.setAttribute("sz", "1100");
  }
  for (const props of nodes(node, A, "tcPr")) {
    for (const side of ["marL", "marR", "marT", "marB"]) props.setAttribute(side, String(PAD));
    props.setAttribute("anchor", "t");
  }
}

export function renderDesignProcurementPage(doc: Document, page: DesignProcurementPage,
  setText: (node: Element, value: string) => void) {
  const shapes = nodes(doc, P, "sp"), frames = nodes(doc, P, "graphicFrame");
  const shape = (id: number) => shapes.find(node => nodes(node, P, "cNvPr")[0]?.getAttribute("id") === String(id))!;
  const titles = [shape(8), shape(13)], notes = [shape(12), shape(16)];
  const boxes = [shape(9), shape(15)], check = shape(10);
  const tree = titles[0]!.parentNode!;
  for (const node of [...shapes.filter(node => [8, 10, 9, 12, 13, 15, 16].includes(Number(nodes(node, P, "cNvPr")[0]?.getAttribute("id")))), ...frames]) node.parentNode!.removeChild(node);
  let nextId = Math.max(...nodes(doc, P, "cNvPr").map(node => Number(node.getAttribute("id")))) + 1;
  const place = (node: Element, x: number, y: number, height: number, width = WIDTH) => {
    nodes(node, P, "cNvPr")[0]!.setAttribute("id", String(nextId++));
    const transform = node.localName === "graphicFrame" ? nodes(node, P, "xfrm")[0]! : nodes(node, A, "xfrm")[0]!;
    const off = nodes(transform, A, "off")[0]!, ext = nodes(transform, A, "ext")[0]!;
    off.setAttribute("x", String(x)); off.setAttribute("y", String(y));
    ext.setAttribute("cx", String(width)); ext.setAttribute("cy", String(height));
    tree.appendChild(node);
  };
  for (const fragment of page) {
    const x = X[fragment.column]!, title = titles[fragment.section]!.cloneNode(true) as Element;
    setText(title, LABELS[fragment.section]! + (fragment.continued ? " — continued" : ""));
    place(title, x, fragment.y, TITLE);
    let y = fragment.y + TITLE + GAP;
    const entries = fragment.entries.filter((entry): entry is Extract<Entry, {kind: "row"}> => entry.kind === "row");
    if (fragment.header) {
      const frame = frames[fragment.section]!.cloneNode(true) as Element;
      const table = nodes(frame, A, "tbl")[0]!, rows = nodes(table, A, "tr"), prototype = rows[1]!;
      for (const row of rows.slice(1)) table.removeChild(row);
      rows[0]!.setAttribute("h", String(HEADER));
      for (const entry of entries) {
        const row = prototype.cloneNode(true) as Element; row.setAttribute("h", String(entry.height));
        nodes(row, A, "tc").forEach((cell, col) => setText(cell, entry.cells[col]!)); table.appendChild(row);
      }
      format(table);
      const height = HEADER + entries.reduce((sum, entry) => sum + entry.height, 0);
      place(frame, x, y, height); y += height;
    }
    const checks = fragment.entries.filter(entry => entry.kind === "note" && entry.role === "check");
    if (checks.length) {
      const note = check.cloneNode(true) as Element;
      setText(note, checks.map(entry => entry.kind === "note" ? entry.text : "").join("\n"));
      format(note); place(note, x, y + GAP, checks.length * LINE);
    }
    // Clone the template's rounded white box, not just its text. Both panels'
    // comment boxes share the same top and bottom even with unequal row counts.
    place(boxes[fragment.section]!.cloneNode(true) as Element, x, fragment.commentY, fragment.commentHeight);
    let noteY = fragment.commentY + BOX_Y_INSET;
    for (const entry of fragment.entries) if (entry.kind === "note" && entry.role === "comment") {
      const note = notes[fragment.section]!.cloneNode(true) as Element;
      setText(note, entry.text); format(note);
      place(note, x + BOX_X_INSET, noteY, entry.height, WIDTH - 2 * BOX_X_INSET);
      noteY += entry.height;
    }
  }
}
