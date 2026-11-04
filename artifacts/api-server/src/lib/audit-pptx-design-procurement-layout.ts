import type { Document, Element } from "@xmldom/xmldom";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const TOP = 1600200, BOTTOM = 6035040, WIDTH = 4983480;
const TITLE = 274320, GAP = 91440, HEADER = 283464, LINE = 177800, PAD = 36576;
const X = [777240, 6428232];
const WIDTHS = [[2743200, 1097280, 1143000], [3840480, 1143000]];
const LABELS = ["Design submittals (DTS)", "Procurement"];
const nodes = (node: Element | Document, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
type Entry = { kind: "row"; cells: string[]; height: number } | { kind: "note"; text: string; height: number };
type Fragment = { section: number; column: number; y: number; continued: boolean; header: boolean; entries: Entry[] };
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
  const streams: Entry[][] = [0, 1].map(section => [
    ...(rows[section] ?? []).flatMap(row => {
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
    }),
    ...(!(rows[section]?.length) ? [`No ${section ? "procurement items" : "design submittals"} recorded.`] : []),
    ...(section === 0 && check ? [check] : []), comments[section] || "Comment: -",
  ].flatMap((entry): Entry[] => typeof entry === "string"
    ? wrap(entry, WIDTH).map(text => ({ kind: "note", text, height: LINE }))
    : [entry]));
  const cursors = [0, 0], pages: DesignProcurementPage[] = [];
  while (streams.some((stream, i) => cursors[i]! < stream.length)) {
    const page: DesignProcurementPage = [], bottoms = [TOP, TOP];
    const fill = (section: number, column: number) => {
      const cursor = cursors[section]!, stream = streams[section]!;
      if (cursor >= stream.length) return;
      const header = cursor === 0 || stream[cursor]?.kind === "row";
      let y = bottoms[column]! + TITLE + GAP + (header ? HEADER : 0);
      const entries: Entry[] = [];
      while (cursors[section]! < stream.length && y + stream[cursors[section]!]!.height <= BOTTOM) {
        const entry = stream[cursors[section]!]!;
        entries.push(entry); y += entry.height; cursors[section]!++;
      }
      if (!entries.length) return;
      page.push({ section, column, y: bottoms[column]!, continued: cursor > 0, header, entries });
      bottoms[column] = y + GAP;
    };
    fill(0, 0); fill(1, 1);
    // Borrow the unused end of either column before creating another slide.
    for (let column = 0; column < 2; column++) for (let section = 0; section < 2; section++) fill(section, column);
    if (!page.length) throw new Error("Design/procurement content cannot fit within the slide");
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
  const tree = titles[0]!.parentNode!;
  for (const node of [...shapes.filter(node => [8, 10, 9, 12, 13, 15, 16].includes(Number(nodes(node, P, "cNvPr")[0]?.getAttribute("id")))), ...frames]) node.parentNode!.removeChild(node);
  let nextId = Math.max(...nodes(doc, P, "cNvPr").map(node => Number(node.getAttribute("id")))) + 1;
  const place = (node: Element, x: number, y: number, height: number) => {
    nodes(node, P, "cNvPr")[0]!.setAttribute("id", String(nextId++));
    const transform = node.localName === "graphicFrame" ? nodes(node, P, "xfrm")[0]! : nodes(node, A, "xfrm")[0]!;
    const off = nodes(transform, A, "off")[0]!, ext = nodes(transform, A, "ext")[0]!;
    off.setAttribute("x", String(x)); off.setAttribute("y", String(y));
    ext.setAttribute("cx", String(WIDTH)); ext.setAttribute("cy", String(height));
    tree.appendChild(node);
  };
  for (const fragment of page) {
    const x = X[fragment.column]!, title = titles[fragment.section]!.cloneNode(true) as Element;
    setText(title, LABELS[fragment.section]! + (fragment.continued ? " — continued" : ""));
    format(title); place(title, x, fragment.y, TITLE);
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
    for (const entry of fragment.entries) if (entry.kind === "note") {
      const note = notes[fragment.section]!.cloneNode(true) as Element;
      setText(note, entry.text); format(note); place(note, x, y, entry.height); y += entry.height;
    }
  }
}
