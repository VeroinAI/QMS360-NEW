import { type Document, type Element } from "@xmldom/xmldom";
import sharp from "sharp";
import type { ReportSectionData } from "./audit-consolidated-report";
import { mappedText } from "./audit-pptx-mapping";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const nodes = (node: Document | Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
type Photo = ReportSectionData["photos"][number];
type Rect = { x: number; y: number; w: number; h: number };
type Card = { photo: Photo; image: Rect; caption: Rect; lines: string[]; font: number };
export type PhotoPage = { finding: Photo; cards: Card[]; continuation?: string[] };
const inch = (n: number) => Math.round(n * 914400);
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: inch(x), y: inch(y), w: inch(w), h: inch(h) });

/** Conservative explicit line wrapping; preserve every character, including
 * line breaks and long unbroken values, rather than trusting viewer autofit. */
export function photoCaptionLines(text: string, width: number, font: number): string[] {
  const capacity = width / 12700 / font;
  return text.split(/\r?\n/).flatMap(paragraph => {
    const lines: string[] = [];
    let line = "", used = 0;
    const widthOf = (char: string) => /[^\u0000-\u024f]/u.test(char) ? 1.05 : /[MW@%]/.test(char) ? 0.95 : 0.65;
    for (const char of paragraph) {
      const units = widthOf(char);
      if (used + units > capacity && line) {
        const space = line.lastIndexOf(" ");
        if (space > line.length / 2) {
          lines.push(line.slice(0, space + 1)); line = line.slice(space + 1);
          used = Array.from(line).reduce((n, c) => n + widthOf(c), 0);
        } else { lines.push(line); line = ""; used = 0; }
      }
      line += char; used += units;
    }
    lines.push(line);
    return lines;
  });
}

// Compatibility for older internal callers; actual exports supply structured
// fields so user text containing "Description:" etc. is never parsed as metadata.
function captionField(photo: Photo, label: string) {
  const matches = [...photo.description.matchAll(/^(Grade|Date captured|Date uploaded|Location|Description|Requirement): /gm)];
  const index = matches.findIndex(match => match[1] === label);
  if (index < 0) return undefined;
  return photo.description.slice(matches[index]!.index! + matches[index]![0].length, matches[index + 1]?.index ?? photo.description.length).trim();
}

export function photographicPages(photos: Photo[]): PhotoPage[] {
  const groups = new Map<string, Photo[]>();
  for (const photo of photos) {
    // Display numbers can be missing or duplicated across finding types.
    // A caller without stable identity cannot safely merge two photographs.
    const key = photo.findingId || `evidence:${photo.id}`;
    const group = groups.get(key) ?? [];
    group.push(photo); groups.set(key, group);
  }
  const pages: PhotoPage[] = [];
  for (const group of groups.values()) for (let start = 0; start < group.length; start += 5) {
    const batch = group.slice(start, start + 5);
    const overflows: string[][] = [];
    const cards = batch.map((photo, i): Card => {
      const count = batch.length;
      const columns = count <= 3 ? count : count === 4 ? 2 : 3;
      const row = Math.floor(i / columns);
      const rowCount = count <= 3 ? count : row === 0 ? columns : count - columns;
      const gap = 0.22, width = (12.13 - (columns - 1) * gap) / columns;
      // Center the final row without creating unused placeholder slots.
      const x = 0.6 + (12.13 - (rowCount * width + (rowCount - 1) * gap)) / 2 + (i % columns) * (width + gap);
      const image = count === 1 ? rect(0.6, 2.2, 8.1, 4.4)
        : rect(x, 2.2 + row * 2.25, width, count <= 3 ? 2.95 : 1.28);
      const caption = count === 1 ? rect(8.95, 2.2, 3.78, 4.4)
        : rect(x, count <= 3 ? 5.25 : 3.55 + row * 2.25, width, count <= 3 ? 1.38 : 0.8);
      const font = count === 1 ? 12 : count <= 3 ? 11 : 10;
      const body = `${photo.fileName}\nLocation: ${mappedText(photo.location ?? captionField(photo, "Location"))}\nDescription: ${mappedText(photo.captionDescription ?? captionField(photo, "Description"))}`;
      const lines = photoCaptionLines(body, caption.w, font);
      const capacity = Math.floor(caption.h / 12700 / (font * 1.2));
      if (lines.length > capacity) {
        const first = lines.splice(0, capacity - 1);
        // Repeat the complete caption on a full-width continuation. This keeps
        // original paragraph boundaries intact and supplies context independently
        // of where a long filename/location happened to wrap on the image page.
        const continued = photoCaptionLines(`Photograph ${start + i + 1} caption (continued)\n${body}`, inch(12.13), 12);
        overflows.push(continued);
        return { photo, image, caption, font, lines: [...first, "(Caption continues on following slide)"] };
      }
      return { photo, image, caption, font, lines };
    });
    pages.push({ finding: batch[0]!, cards });
    for (const lines of overflows) for (let at = 0; at < lines.length; at += 21) {
      pages.push({ finding: batch[0]!, cards: [], continuation: lines.slice(at, at + 21) });
    }
  }
  return pages;
}

/** Keep title, footer, masters and branded text styles from the pristine slide.
 * Remove both original slots, including their Requirement and empty captions. */
export async function renderPhotographicPage(input: {
  doc: Document; rels: Document; page?: PhotoPage; target: number;
  files: Record<string, Uint8Array>; photos?: Map<string, Uint8Array>;
  setText: (shape: Element, value: string) => void;
}) {
  const { doc, rels, page, target, files, photos, setText } = input;
  const shapes = nodes(doc, P, "sp");
  const id = (node: Element) => Number(nodes(node, P, "cNvPr")[0]?.getAttribute("id"));
  const textPrototype = shapes.find(node => id(node) === 8)!.cloneNode(true) as Element;
  const picturePrototype = nodes(doc, P, "pic").find(node => id(node) === 5)!.cloneNode(true) as Element;
  const tree = nodes(doc, P, "spTree")[0]!;
  for (const node of [...shapes, ...nodes(doc, P, "pic")]) if (id(node) >= 4 && id(node) <= 19) node.parentNode!.removeChild(node);
  let nextId = Math.max(...nodes(doc, P, "cNvPr").map(n => Number(n.getAttribute("id")))) + 1;
  const place = (node: Element, box: Rect) => {
    const xfrm = nodes(node, A, "xfrm")[0]!;
    const off = nodes(xfrm, A, "off")[0]!, ext = nodes(xfrm, A, "ext")[0]!;
    off.setAttribute("x", String(box.x)); off.setAttribute("y", String(box.y));
    ext.setAttribute("cx", String(box.w)); ext.setAttribute("cy", String(box.h));
    const info = nodes(node, P, "cNvPr")[0]!;
    info.setAttribute("id", String(nextId++)); info.setAttribute("name", `Audit photographic evidence ${nextId}`);
    // extLst, if supplied by a future template, must remain the final child.
    tree.insertBefore(node, Array.from(tree.childNodes).find(n => n.localName === "extLst") ?? null);
  };
  const text = (value: string, box: Rect, font: number) => {
    const node = textPrototype.cloneNode(true) as Element;
    setText(node, value); place(node, box);
    const body = nodes(node, A, "bodyPr")[0]!;
    for (const attr of ["lIns", "rIns", "tIns", "bIns"]) body.setAttribute(attr, "0");
    body.setAttribute("wrap", "none");
    body.setAttribute("anchor", "t");
    for (const fit of nodes(body, A, "normAutofit")) body.removeChild(fit);
    body.appendChild(doc.createElementNS(A, "a:noAutofit"));
    for (const p of nodes(node, A, "p")) {
      let props = nodes(p, A, "pPr")[0];
      if (!props) { props = doc.createElementNS(A, "a:pPr"); p.insertBefore(props, p.firstChild); }
      for (const tag of ["lnSpc", "spcBef", "spcAft"]) for (const old of nodes(props, A, tag)) props.removeChild(old);
      const following = props.firstChild;
      for (const tag of ["lnSpc", "spcBef", "spcAft"]) {
        const spacing = doc.createElementNS(A, `a:${tag}`), pts = doc.createElementNS(A, "a:spcPts");
        pts.setAttribute("val", String(tag === "lnSpc" ? font * 120 : 0)); spacing.appendChild(pts);
        // CT_TextParagraphProperties puts spacing before bullet properties.
        props.insertBefore(spacing, following);
      }
      for (const tag of ["rPr", "endParaRPr"]) for (const r of nodes(p, A, tag)) r.setAttribute("sz", String(font * 100));
    }
  };
  if (!page) { text("No photographic evidence recorded", rect(0.6, 2.2, 12.13, 0.5), 14); return; }
  const finding = page.finding;
  const header = `Reference: ${mappedText(finding.reference)}\nGrade: ${mappedText(finding.grade ?? captionField(finding, "Grade"))}    Date: ${mappedText(finding.findingCreatedDate)}`;
  // Long issued numbers continue as bounded text instead of overlapping photos.
  const headerLines = photoCaptionLines(header, inch(12.13), 12);
  text(headerLines.slice(0, 2).join("\n"), rect(0.6, 1.55, 12.13, 0.55), 12);
  if (headerLines.length > 2) throw new Error("Finding reference is too long for the photographic slide header");
  if (page.continuation) text(page.continuation.join("\n"), rect(0.6, 2.2, 12.13, 4.4), 12);
  for (let slot = 0; slot < page.cards.length; slot++) {
    const card = page.cards[slot]!;
    const bytes = photos?.get(card.photo.id);
    if (!bytes) throw new Error(`Photograph could not be loaded: ${card.photo.fileName}`);
    const dimensions = await sharp(bytes).metadata();
    if (!dimensions.width || !dimensions.height) throw new Error(`Invalid photograph: ${card.photo.fileName}`);
    const scale = Math.min(card.image.w / dimensions.width, card.image.h / dimensions.height);
    const w = Math.round(dimensions.width * scale), h = Math.round(dimensions.height * scale);
    const media = `audit-photo-${target}-${slot}.png`;
    files[`ppt/media/${media}`] = new Uint8Array(bytes);
    const ids = new Set(nodes(rels, REL, "Relationship").map(r => r.getAttribute("Id")));
    let rid = `rIdAuditPhoto${slot}`;
    while (ids.has(rid)) rid += "_";
    const rel = rels.createElementNS(REL, "Relationship");
    rel.setAttribute("Id", rid); rel.setAttribute("Type", `${R}/image`); rel.setAttribute("Target", `../media/${media}`);
    rels.documentElement!.appendChild(rel);
    const picture = picturePrototype.cloneNode(true) as Element;
    nodes(picture, A, "blip")[0]!.setAttributeNS(R, "r:embed", rid);
    const fill = nodes(picture, P, "blipFill")[0]!;
    for (const crop of nodes(fill, A, "srcRect")) fill.removeChild(crop);
    place(picture, { x: card.image.x + Math.round((card.image.w - w) / 2), y: card.image.y + Math.round((card.image.h - h) / 2), w, h });
    text(card.lines.join("\n"), card.caption, card.font);
  }
}
