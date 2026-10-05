import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ReportSectionData } from "./audit-consolidated-report";
import { auditPptxMappings, mappedText, PPTX_UNMAPPED } from "./audit-pptx-mapping";

export const AUDIT_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const elements = (node: Element | Document, ns: string, tag: string): Element[] => Array.from(node.getElementsByTagNameNS(ns, tag));
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const xml = (node: Document) => strToU8(new XMLSerializer().serializeToString(node));
const shapeId = (shape: Element) => Number(elements(shape, P, "cNvPr")[0]?.getAttribute("id"));
const shape = (doc: Document, id: number) => elements(doc, P, "sp").find(s => shapeId(s) === id);
const chunks = <T>(items: T[], size: number): T[][] => items.length
  ? Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size)) : [[]];

/** Keep run/paragraph formatting, but remove old field text so PowerPoint cannot restore it. */
function setText(container: Element, value: string) {
  const doc = container.ownerDocument!;
  const paragraphs = elements(container, A, "p");
  const original = paragraphs[0];
  if (!original) throw new Error("Template text container has no paragraph");
  const parent = original.parentNode!;
  const prototype = original.cloneNode(true) as Element;
  for (const paragraph of paragraphs) parent.removeChild(paragraph);
  for (const line of value.split(/\r?\n/)) {
    const paragraph = prototype.cloneNode(true) as Element;
    for (const field of elements(paragraph, A, "fld")) {
      const run = doc.createElementNS(A, "a:r");
      for (const child of Array.from(field.childNodes)) run.appendChild(child.cloneNode(true));
      field.parentNode!.replaceChild(run, field);
    }
    let texts = elements(paragraph, A, "t");
    if (!texts.length) {
      const run = doc.createElementNS(A, "a:r");
      const props = elements(paragraph, A, "endParaRPr")[0];
      if (props) {
        const rp = doc.createElementNS(A, "a:rPr");
        for (const attr of Array.from(props.attributes)) rp.setAttribute(attr.name, attr.value);
        run.appendChild(rp);
      }
      run.appendChild(doc.createElementNS(A, "a:t"));
      paragraph.appendChild(run);
      texts = elements(paragraph, A, "t");
    }
    texts.forEach((t, i) => { t.textContent = i === 0 ? line : ""; });
    parent.appendChild(paragraph);
  }
  const body = elements(container, A, "bodyPr")[0];
  if (body) {
    for (const tag of ["noAutofit", "spAutoFit", "normAutofit"]) {
      for (const child of elements(body, A, tag)) body.removeChild(child);
    }
    body.appendChild(doc.createElementNS(A, "a:normAutofit"));
  }
}

function setShape(doc: Document, id: number, text: string) {
  const node = shape(doc, id);
  if (!node) throw new Error(`PowerPoint template is missing shape ${id}`);
  setText(node, text);
}
function setTable(table: Element, rows: string[][], start: number, capacity: number) {
  const templateRows = elements(table, A, "tr").slice(start, start + capacity);
  templateRows.forEach((row, index) => {
    elements(row, A, "tc").forEach((cell, col) => setText(cell, mappedText(rows[index]?.[col])));
  });
}

async function template() {
  try { return await readFile(new URL("./audit-report-template.pptx", import.meta.url)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFile(new URL("../assets/audit-report-template.pptx", import.meta.url));
  }
}

/** Edit only slide data in the original package; retain masters, branding and geometry. */
export async function renderConsolidatedAuditPptx(input: {
  sections: ReportSectionData[]; photos?: Map<string, Uint8Array>;
}): Promise<Buffer> {
  const files = unzipSync(await template());
  const mappings = auditPptxMappings(input.sections);
  const presentation = parse(files["ppt/presentation.xml"]!);
  const presentationRels = parse(files["ppt/_rels/presentation.xml.rels"]!);
  const contentTypes = parse(files["[Content_Types].xml"]!);
  const slideList = elements(presentation, P, "sldIdLst")[0]!;
  const originals = elements(slideList, P, "sldId");
  const outputSlides: Element[] = [];
  let nextSlide = 19;
  let nextId = Math.max(...originals.map(s => Number(s.getAttribute("id")))) + 1;
  const relationshipIds = new Set(elements(presentationRels, REL, "Relationship").map(r => r.getAttribute("Id")));
  const uniqueRel = () => {
    let i = relationshipIds.size + 1;
    while (relationshipIds.has(`rId${i}`)) i++;
    relationshipIds.add(`rId${i}`); return `rId${i}`;
  };
  // Table continuations use the same geometry and styling rather than dropping rows.
  const tableStarts: Record<number, number> = { 11: 2, 12: 2 };
  const section = (key: string) => input.sections.find(s => s.key === key);
  for (let slideNumber = 1; slideNumber <= 18; slideNumber++) {
    const path = `ppt/slides/slide${slideNumber}.xml`;
    const base = parse(files[path]!);
    const tables = elements(base, A, "tbl");
    const mapping = mappings.get(slideNumber);
    const pages = mapping?.tables.map((rows, i) => {
      const start = tableStarts[slideNumber] ?? 1;
      const capacity = elements(tables[i]!, A, "tr").length - start;
      if (capacity < 1) throw new Error("PowerPoint template has no table data rows");
      // Long cells are continued without truncation, within the existing row geometry.
      const expanded = rows.flatMap(row => {
        const maxLength = slideNumber === 15 ? 110 : 160;
        const count = Math.max(1, ...row.map(cell => Math.ceil(cell.length / maxLength)));
        return Array.from({ length: count }, (_, part) => row.map((cell, col) =>
          col === 0 ? (part ? `${cell} (continued)` : cell) : cell.slice(part * maxLength, (part + 1) * maxLength) || (part ? "" : cell)));
      });
      return chunks(expanded, capacity);
    }) ?? [];
    const activityRows = [...(section("programme")?.tables[0]?.rows ?? [])];
    const programmeField = (label: string) => mappedText(section("programme")?.fields.find(f => f.label === label)?.value);
    for (const meeting of ["Opening", "Closing"]) {
      const held = programmeField(`${meeting} meeting`);
      const minutes = programmeField(`${meeting} minutes`);
      if (held !== PPTX_UNMAPPED || minutes !== PPTX_UNMAPPED) activityRows.push([
        held, PPTX_UNMAPPED, `${meeting} meeting (recorded)`, minutes, programmeField("Auditees present"),
      ]);
    }
    const activities = chunks(activityRows, 5);
    const photos = chunks(section("photographs")?.photos ?? [], 2);
    const themeRows = section("findings-summary")?.tables[1]?.rows ?? [];
    const themes = chunks(themeRows, 3);
    const count = Math.max(1, ...pages.map(p => p.length), slideNumber === 5 ? activities.length : 1,
      slideNumber === 13 ? photos.length : 1, slideNumber === 7 ? themes.length : 1);
    for (let page = 0; page < count; page++) {
      const doc = parse(files[path]!);
      // Clean template instructions before inserting record data; brackets in
      // actual audit text are valid content and must never be mistaken for prompts.
      for (const s of elements(doc, P, "sp")) {
        const text = elements(s, A, "t").map(t => t.textContent ?? "").join("");
        if (/\[[^\]]*\]|Engr\. \(Name|E\.g\. Project Manager/.test(text)) setText(s, PPTX_UNMAPPED);
      }
      const slideTables = elements(doc, A, "tbl");
      for (const [id, text] of Object.entries(mapping?.shapes ?? {})) setShape(doc, Number(id), text);
      mapping?.tables.forEach((_, i) => setTable(slideTables[i]!, pages[i]?.[page] ?? [], tableStarts[slideNumber] ?? 1,
        elements(slideTables[i]!, A, "tr").length - (tableStarts[slideNumber] ?? 1)));
      if ([11, 12].includes(slideNumber)) {
        const group = elements(slideTables[0]!, A, "tr")[1]!;
        const cells = elements(group, A, "tc");
        cells.forEach((cell, col) => setText(cell, col === 0 ? (slideNumber === 11 ? "Non-conformities" : "Opportunities for improvement") : ""));
      }
      if (slideNumber === 5) {
        for (let i = 0; i < 5; i++) {
          const row = activities[page]?.[i];
          setShape(doc, 10 + i * 3, row ? `${mappedText(row[0])}\n${mappedText(row[1])}` : PPTX_UNMAPPED);
          setShape(doc, 11 + i * 3, row ? row.slice(2).map(mappedText).join("\n") : PPTX_UNMAPPED);
        }
      }
      if (slideNumber === 7) {
        for (let i = 0; i < 3; i++) {
          const row = themes[page]?.[i];
          setShape(doc, 10 + i * 4, mappedText(row?.[0]));
          setShape(doc, 11 + i * 4, mappedText(row?.slice(1).join(" · ")));
        }
      }
      const target = page ? nextSlide++ : slideNumber;
      const targetPath = `ppt/slides/slide${target}.xml`;
      const sourceRels = files[`ppt/slides/_rels/slide${slideNumber}.xml.rels`]!;
      let slideRels = parse(sourceRels);
      if (page) {
        // A notes slide belongs to exactly one presentation slide.
        for (const rel of elements(slideRels, REL, "Relationship")) {
          if (rel.getAttribute("Type")?.endsWith("/notesSlide")) rel.parentNode!.removeChild(rel);
        }
      }
      if (slideNumber === 13) {
        for (let slot = 0; slot < 2; slot++) {
          const photo = photos[page]?.[slot];
          const offset = slot * 8;
          setShape(doc, 6 + offset, photo ? "" : PPTX_UNMAPPED);
          setShape(doc, 7 + offset, photo ? photo.fileName : PPTX_UNMAPPED);
          const description = photo?.description ?? "";
          const labels = [...description.matchAll(/^(Grade|Date captured|Date uploaded|Location|Description|Requirement): /gm)];
          const caption = new Map(labels.map((match, i) => [
            match[1]!, description.slice(match.index! + match[0].length, labels[i + 1]?.index ?? description.length).trim(),
          ]));
          setShape(doc, 8 + offset, `Ref: ${mappedText(photo?.reference)}   Grade: ${mappedText(caption.get("Grade"))}   Date: ${mappedText(caption.get("Date captured"))}`);
          for (const [id, key] of [[9, "Location"], [10, "Description"], [11, "Requirement"]] as const) {
            setShape(doc, id + offset, `${key}: ${mappedText(caption.get(key))}`);
          }
          if (photo) {
            const bytes = input.photos?.get(photo.id);
            if (!bytes) throw new Error(`Photograph could not be loaded: ${photo.fileName}`);
            const media = `audit-photo-${target}-${slot}.png`;
            files[`ppt/media/${media}`] = new Uint8Array(bytes);
            const rid = `rIdAuditPhoto${slot}`;
            const rel = slideRels.createElementNS(REL, "Relationship");
            rel.setAttribute("Id", rid); rel.setAttribute("Type", `${R}/image`); rel.setAttribute("Target", `../media/${media}`);
            slideRels.documentElement!.appendChild(rel);
            const box = shape(doc, 4 + offset)!;
            // Reuse the actual template picture placeholder and its aspect-preserving geometry.
            const picture = elements(doc, P, "pic").find(pic => shapeId(pic) === 5 + offset)!;
            const blip = elements(picture, A, "blip")[0]!;
            blip.setAttributeNS(R, "r:embed", rid);
            const xfrm = elements(picture, A, "xfrm")[0]!;
            const boxXfrm = elements(box, A, "xfrm")[0]!;
            xfrm.parentNode!.replaceChild(boxXfrm.cloneNode(true), xfrm);
            // The image is fitted to the template's original photo rectangle.
            const fill = elements(picture, P, "blipFill")[0]!;
            for (const crop of elements(fill, A, "srcRect")) fill.removeChild(crop);
          }
        }
      }
      files[targetPath] = xml(doc);
      files[`ppt/slides/_rels/slide${target}.xml.rels`] = xml(slideRels);
      if (!page) outputSlides.push(originals[slideNumber - 1]!);
      else {
        const id = uniqueRel();
        const rel = presentationRels.createElementNS(REL, "Relationship");
        rel.setAttribute("Id", id); rel.setAttribute("Type", `${R}/slide`); rel.setAttribute("Target", `slides/slide${target}.xml`);
        presentationRels.documentElement!.appendChild(rel);
        const entry = presentation.createElementNS(P, "p:sldId");
        entry.setAttribute("id", String(nextId++)); entry.setAttributeNS(R, "r:id", id); outputSlides.push(entry);
        const override = contentTypes.createElementNS(CT, "Override");
        override.setAttribute("PartName", `/${targetPath}`);
        override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
        contentTypes.documentElement!.appendChild(override);
      }
    }
  }
  for (const slide of originals) slideList.removeChild(slide);
  outputSlides.forEach((slide, i) => {
    slideList.appendChild(slide);
    const rid = slide.getAttributeNS(R, "id");
    const target = elements(presentationRels, REL, "Relationship").find(r => r.getAttribute("Id") === rid)!.getAttribute("Target")!;
    const path = `ppt/${target}`;
    const doc = parse(files[path]!);
    for (const s of elements(doc, P, "sp")) {
      const info = elements(s, P, "cNvPr")[0];
      if (info?.getAttribute("name")?.startsWith("Slide Number Placeholder")) setText(s, String(i + 1));
    }
    // Template slide 5 has a non-placeholder page-number shape.
    if (target === "slides/slide5.xml") setShape(doc, 6, String(i + 1));
    files[path] = xml(doc);
  });
  files["ppt/presentation.xml"] = xml(presentation);
  files["ppt/_rels/presentation.xml.rels"] = xml(presentationRels);
  files["[Content_Types].xml"] = xml(contentTypes);
  if (files["docProps/app.xml"]) {
    const props = parse(files["docProps/app.xml"]);
    const slideCount = props.getElementsByTagName("Slides")[0];
    if (slideCount) slideCount.textContent = String(outputSlides.length);
    files["docProps/app.xml"] = xml(props);
  }
  // Template notes contain instructions/sample values, not audit record information.
  for (const name of Object.keys(files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))) {
    const doc = parse(files[name]!);
    for (const t of elements(doc, A, "t")) t.textContent = "";
    files[name] = xml(doc);
  }
  return Buffer.from(zipSync(files));
}
