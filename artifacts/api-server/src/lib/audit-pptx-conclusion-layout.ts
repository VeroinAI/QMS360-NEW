import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import type { ReportSectionData } from "./audit-consolidated-report";
import { mappedText } from "./audit-pptx-mapping";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const nodes = (node: Document | Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const inch = (n: number) => String(Math.round(n * 914400));

/** Keep the reference branding and lines, but place values in real, nonzero-height text boxes. */
export function renderConclusionSignoff(doc: Document, rels: Document, files: Record<string, Uint8Array>,
  contentTypes: Document, section: ReportSectionData | undefined,
  signatures: Map<string, Uint8Array[]> | undefined, setText: (node: Element, value: string) => void) {
  const shape = (id: number) => nodes(doc, P, "sp").find(node => nodes(node, P, "cNvPr")[0]?.getAttribute("id") === String(id))!;
  const tree = nodes(doc, P, "spTree")[0]!;
  const prototype = shape(11).cloneNode(true) as Element;
  let nextId = Math.max(...nodes(doc, P, "cNvPr").map(node => Number(node.getAttribute("id")))) + 1;
  const move = (node: Element, y: number, h?: number) => {
    const xfrm = nodes(node, A, "xfrm")[0]!;
    nodes(xfrm, A, "off")[0]!.setAttribute("y", inch(y));
    if (h !== undefined) nodes(xfrm, A, "ext")[0]!.setAttribute("cy", inch(h));
  };
  const box = (x: number, y: number, w: number, h: number, value: string) => {
    const node = prototype.cloneNode(true) as Element;
    const props = nodes(node, P, "cNvPr")[0]!;
    props.setAttribute("id", String(nextId++)); props.setAttribute("name", "Audit report sign-off");
    const xfrm = nodes(node, A, "xfrm")[0]!;
    nodes(xfrm, A, "off")[0]!.setAttribute("x", inch(x));
    nodes(xfrm, A, "ext")[0]!.setAttribute("cx", inch(w));
    move(node, y, h); setText(node, value);
    tree.appendChild(node);
  };
  for (const id of [8, 28, 29, 30, 31, 32, 33]) {
    const node = shape(id); node?.parentNode?.removeChild(node);
  }
  move(shape(7), 6.42, .35);
  const rows = section?.tables[0]?.rows ?? [];
  for (const [index, role] of ["Prepared by", "Reviewed by", "Approved by"].entries()) {
    const y = 1.95 + index * 1.5, heading = 10 + index * 6, line = 12 + index * 6;
    move(shape(heading), y, .28); move(shape(heading + 1), y + .30, .52);
    for (const id of [line, line + 1]) { setText(shape(id), ""); move(shape(id), y + 1.03); }
    for (const id of [line + 2, line + 3]) move(shape(id), y + 1.07);
    const row = rows.find(row => row[0]?.toLowerCase() === role.toLowerCase());
    box(11, y + .70, 1.7, .30, mappedText(row?.[3]));
    const images = signatures?.get(role) ?? [];
    if (!images.length) { box(7.4, y + .70, 3.2, .30, mappedText(row?.[2])); continue; }
    images.forEach((bytes, imageIndex) => {
      const name = `audit-report-signature-${index}-${imageIndex}.png`;
      files[`ppt/media/${name}`] = bytes;
      let rid = `auditReportSignature${index}_${imageIndex}`;
      while (nodes(rels, REL, "Relationship").some(node => node.getAttribute("Id") === rid)) rid += "_";
      const relation = rels.createElementNS(REL, "Relationship");
      relation.setAttribute("Id", rid); relation.setAttribute("Type", `${R}/image`); relation.setAttribute("Target", `../media/${name}`);
      rels.documentElement!.appendChild(relation);
      const buffer = Buffer.from(bytes), ratio = buffer.readUInt32BE(16) / buffer.readUInt32BE(20);
      const slot = 3.2 / images.length, w = Math.min(slot - .06, .43 * ratio), h = w / ratio;
      const fragment = new DOMParser().parseFromString(
        `<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:nvPicPr><p:cNvPr id="${nextId++}" name="Audit report ${role} signature"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${inch(7.4 + imageIndex * slot + (slot - w) / 2)}" y="${inch(y + 1.00 - h)}"/><a:ext cx="${inch(w)}" cy="${inch(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`, "application/xml");
      tree.appendChild(doc.importNode(fragment.documentElement!, true));
    });
  }
  if (signatures?.size && !nodes(contentTypes, CT, "Default").some(node => node.getAttribute("Extension") === "png")) {
    const entry = contentTypes.createElementNS(CT, "Default");
    entry.setAttribute("Extension", "png"); entry.setAttribute("ContentType", "image/png");
    contentTypes.documentElement!.appendChild(entry);
  }
}
