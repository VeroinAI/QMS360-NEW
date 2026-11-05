import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { programmeLines } from "./audit-programme-pptx-layout";
import type { ReportSectionData } from "./audit-consolidated-report";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const nodes = (node: Document | Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const X = 5577840, LINE = 152400, PAD = 45720, HEADER = 365760;
const WIDTHS = [[1280160, 2286000, 1536192, 960120], [1280160, 2960640, 1821672]];
type Row = { cells: string[]; height: number; continued: boolean; role: string };
export type DocumentControlPage = { approvals: Row[]; history: Row[] };

function paginate(rows: string[][], widths: number[], available: number, minimum: number): Row[][] {
  const pages: Row[][] = [[]];
  let used = 0;
  for (const row of rows) {
    const cells = row.map((value, col) => programmeLines(value || "-", (widths[col]! - PAD * 2) / 114300 * .94));
    const parts = Math.max(...cells.map(lines => Math.ceil(lines.length / 5)), 1);
    for (let part = 0; part < parts; part++) {
      const values = cells.map(lines => lines.slice(part * 5, (part + 1) * 5).join("\n") || "");
      const height = Math.max(minimum, Math.max(...values.map(value => value.split("\n").length)) * LINE + PAD * 2);
      if (used + height > available) { pages.push([]); used = 0; }
      pages.at(-1)!.push({ cells: values, height, continued: part > 0, role: row[0] ?? "" });
      used += height;
    }
  }
  return pages;
}

/** Approval data and history paginate independently inside the two original tables. */
export function documentControlPages(section?: ReportSectionData): DocumentControlPage[] {
  const approvals = section?.tables.find(table => table.title === "Approval" || table.title === "Sign-off")?.rows
    ?? [["Prepared by", "-", "-", "-"], ["Reviewed by", "-", "-", "-"], ["Approved by", "-", "-", "-"]];
  const history = section?.tables.find(table => table.title === "Approval History")?.rows ?? [];
  const top = paginate(approvals, WIDTHS[0]!, 2350000 - HEADER, 566928);
  const bottom = paginate(history.length ? history : [["-", "No approval decisions recorded.", "-"]],
    WIDTHS[1]!, 1737360 - HEADER, 457200);
  return Array.from({ length: Math.max(top.length, bottom.length) }, (_, i) => ({
    approvals: top[i] ?? top[0]!, history: bottom[i] ?? [],
  }));
}

function style(cell: Element) {
  const doc = cell.ownerDocument!;
  for (const body of nodes(cell, A, "bodyPr")) {
    for (const side of ["lIns", "rIns", "tIns", "bIns"]) body.setAttribute(side, "0");
    for (const tag of ["noAutofit", "normAutofit", "spAutoFit"])
      for (const child of nodes(body, A, tag)) body.removeChild(child);
    body.setAttribute("wrap", "none"); body.appendChild(doc.createElementNS(A, "a:noAutofit"));
  }
  for (const props of nodes(cell, A, "tcPr")) {
    for (const side of ["marL", "marR", "marT", "marB"]) props.setAttribute(side, String(PAD));
    props.setAttribute("anchor", "ctr");
  }
  for (const paragraph of nodes(cell, A, "p")) {
    let props = nodes(paragraph, A, "pPr")[0];
    if (!props) { props = doc.createElementNS(A, "a:pPr"); paragraph.insertBefore(props, paragraph.firstChild); }
    for (const tag of ["lnSpc", "spcBef", "spcAft"]) for (const old of nodes(props, A, tag)) props.removeChild(old);
    for (const tag of ["spcAft", "spcBef", "lnSpc"]) {
      const spacing = doc.createElementNS(A, `a:${tag}`), value = doc.createElementNS(A, "a:spcPts");
      value.setAttribute("val", tag === "lnSpc" ? "1200" : "0"); spacing.appendChild(value); props.insertBefore(spacing, props.firstChild);
    }
    for (const tag of ["rPr", "endParaRPr"]) for (const run of nodes(paragraph, A, tag)) run.setAttribute("sz", "900");
  }
}

export function renderDocumentControlPage(doc: Document, rels: Document, files: Record<string, Uint8Array>,
  contentTypes: Document, page: DocumentControlPage, pageIndex: number,
  signatures: Map<string, Uint8Array[]> | undefined, setText: (node: Element, value: string) => void) {
  const title = nodes(doc, P, "sp").find(shape => nodes(shape, P, "cNvPr")[0]?.getAttribute("id") === "22")!;
  setText(title, "Approval History" + (pageIndex ? " — continued" : ""));
  const frames = nodes(doc, P, "graphicFrame"), tree = nodes(doc, P, "spTree")[0]!;
  let nextId = Math.max(...nodes(doc, P, "cNvPr").map(node => Number(node.getAttribute("id")))) + 1;
  for (let index = 0; index < 2; index++) {
    const frame = frames[index]!, table = nodes(frame, A, "tbl")[0]!, sourceRows = nodes(table, A, "tr");
    const header = sourceRows[0]!, prototype = sourceRows[1]!.cloneNode(true) as Element;
    for (const row of sourceRows.slice(1)) table.removeChild(row);
    const widths = WIDTHS[index]!;
    const grid = nodes(table, A, "tblGrid")[0]!;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    for (const width of widths) {
      const col = doc.createElementNS(A, "a:gridCol"); col.setAttribute("w", String(width)); grid.appendChild(col);
    }
    const headers = index ? ["Date", "Approval details", "By"] : ["Role", "Name and title", "Signature", "Date"];
    const headerCells = nodes(header, A, "tc");
    if (index) header.removeChild(headerCells[0]!);
    nodes(header, A, "tc").forEach((cell, col) => { setText(cell, headers[col]!); style(cell); });
    const rows = index ? page.history : page.approvals;
    let y = (index ? 4434840 : 1783080) + HEADER;
    for (const [rowIndex, entry] of rows.entries()) {
      const row = prototype.cloneNode(true) as Element;
      if (index) row.removeChild(nodes(row, A, "tc")[0]!);
      row.setAttribute("h", String(entry.height));
      nodes(row, A, "tc").forEach((cell, col) => { setText(cell, entry.cells[col] || (entry.continued ? "" : "-")); style(cell); });
      table.appendChild(row);
      const images = !index && !entry.continued ? signatures?.get(entry.role) ?? [] : [];
      if (images.length) {
        setText(nodes(row, A, "tc")[2]!, "");
        for (const [imageIndex, bytes] of images.entries()) {
          const name = `audit-control-signature-${pageIndex}-${rowIndex}-${imageIndex}.png`;
          files[`ppt/media/${name}`] = bytes;
          let rid = `auditControlSignature${rowIndex}_${imageIndex}`;
          while (nodes(rels, REL, "Relationship").some(node => node.getAttribute("Id") === rid)) rid += "_";
          const link = rels.createElementNS(REL, "Relationship");
          link.setAttribute("Id", rid); link.setAttribute("Type", `${R}/image`); link.setAttribute("Target", `../media/${name}`);
          rels.documentElement!.appendChild(link);
          const buffer = Buffer.from(bytes), ratio = buffer.readUInt32BE(16) / buffer.readUInt32BE(20);
          const columns = Math.min(3, images.length), imageRows = Math.ceil(images.length / columns);
          const slot = WIDTHS[0]![2]! / columns, slotHeight = entry.height / imageRows;
          const w = Math.min(slot - 2 * PAD, Math.max(1, slotHeight - PAD) * ratio), h = w / ratio;
          const picture = new DOMParser().parseFromString(
            `<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:nvPicPr><p:cNvPr id="${nextId++}" name="Audit document control signature"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round(X + WIDTHS[0]![0]! + WIDTHS[0]![1]! + (imageIndex % columns) * slot + (slot - w) / 2)}" y="${Math.round(y + Math.floor(imageIndex / columns) * slotHeight + (slotHeight - h) / 2)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`, "application/xml");
          tree.appendChild(doc.importNode(picture.documentElement!, true));
        }
      }
      y += entry.height;
    }
    nodes(nodes(frame, P, "xfrm")[0]!, A, "ext")[0]!.setAttribute("cy", String(HEADER + rows.reduce((sum, row) => sum + row.height, 0)));
  }
  if (signatures?.size && !nodes(contentTypes, CT, "Default").some(node => node.getAttribute("Extension") === "png")) {
    const entry = contentTypes.createElementNS(CT, "Default");
    entry.setAttribute("Extension", "png"); entry.setAttribute("ContentType", "image/png"); contentTypes.documentElement!.appendChild(entry);
  }
}
