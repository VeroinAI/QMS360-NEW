import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ReportSectionData } from "./audit-consolidated-report";
import { auditPptxMappings, mappedText, PPTX_EMPTY, PPTX_UNMAPPED } from "./audit-pptx-mapping";
import { programmePages, programmeLines } from "./audit-programme-pptx-layout";
import { photographicPages, renderPhotographicPage } from "./audit-pptx-photo-layout";
import { ofiPages, renderOfiPage } from "./audit-pptx-ofi-layout";
import { summaryPages, renderSummaryPage } from "./audit-pptx-summary-layout";

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
      // DrawingML requires pPr?, then runs/fields/breaks, then endParaRPr?.
      // Empty template cells often contain only endParaRPr; appending a run
      // after it produces well-formed XML that PowerPoint cannot safely open.
      paragraph.insertBefore(run, props ?? null);
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
function removeShape(doc: Document, id: number) {
  const node = shape(doc, id);
  node?.parentNode?.removeChild(node);
}
function removeProgressTotal(doc: Document) {
  const table = elements(doc, A, "tbl")[0];
  if (!table) return;
  for (const row of elements(table, A, "tr").slice(1)) {
    const first = elements(row, A, "tc")[0];
    if (/^(overall|total)$/i.test(elements(first!, A, "t").map(t => t.textContent).join("").trim())) table.removeChild(row);
  }
}
/** Explicit wrapping and pagination prevent Office-dependent fitting or clipped scope sentences. */
function scopeBox(doc: Document, id: number, text: string) {
  programmeBox(doc, id, text, 1100, 1250);
  plainParagraphs(doc, id);
}
function plainParagraphs(doc: Document, id: number) {
  for (const props of elements(shape(doc, id)!, A, "pPr")) {
    props.setAttribute("marL", "0"); props.setAttribute("indent", "0");
    for (const child of Array.from(props.childNodes)) {
      if (child.nodeType === 1 && (child as Element).localName?.startsWith("bu")) props.removeChild(child);
    }
    const before = Array.from(props.childNodes).find(child => child.nodeType === 1
      && ["tabLst", "defRPr", "extLst"].includes((child as Element).localName ?? ""));
    props.insertBefore(doc.createElementNS(A, "a:buNone"), before ?? null);
  }
}
/** Programme rows use bounded lines and explicit fonts, not viewer-dependent autofit. */
function programmeBox(doc: Document, id: number, text: string, size: number, lineHeight: number, rect?: { y: number; width: number; height: number }) {
  setShape(doc, id, text);
  const node = shape(doc, id)!;
  if (rect) {
    const transform = elements(node, A, "xfrm")[0]!;
    elements(transform, A, "off")[0]!.setAttribute("y", String(rect.y));
    const ext = elements(transform, A, "ext")[0]!;
    ext.setAttribute("cx", String(rect.width)); ext.setAttribute("cy", String(rect.height));
  }
  const body = elements(node, A, "bodyPr")[0]!;
  for (const attr of ["lIns", "rIns", "tIns", "bIns"]) body.setAttribute(attr, "0");
  body.setAttribute("wrap", "none"); body.setAttribute("vertOverflow", "clip"); body.setAttribute("horzOverflow", "clip");
  for (const fit of elements(body, A, "normAutofit")) body.removeChild(fit);
  body.appendChild(doc.createElementNS(A, "a:noAutofit"));
  for (const p of elements(node, A, "p")) {
    let props = elements(p, A, "pPr")[0];
    if (!props) { props = doc.createElementNS(A, "a:pPr"); p.insertBefore(props, p.firstChild); }
    for (const tag of ["spcAft", "spcBef", "lnSpc"]) {
      for (const existing of elements(props, A, tag)) props.removeChild(existing);
      const spacing = doc.createElementNS(A, `a:${tag}`);
      const points = doc.createElementNS(A, "a:spcPts");
      points.setAttribute("val", String(tag === "lnSpc" ? lineHeight : 0));
      spacing.appendChild(points); props.insertBefore(spacing, props.firstChild);
    }
    for (const tag of ["rPr", "endParaRPr"]) for (const r of elements(p, A, tag)) r.setAttribute("sz", String(size));
  }
}
function setTable(table: Element, rows: string[][], start: number, capacity: number, trimUnused = false, emptyRow?: string[]) {
  const templateRows = elements(table, A, "tr").slice(start, start + capacity);
  if (trimUnused && !rows.length && emptyRow) rows = [emptyRow];
  templateRows.forEach((row, index) => {
    if (trimUnused && index >= rows.length) { table.removeChild(row); return; }
    elements(row, A, "tc").forEach((cell, col) => setText(cell, mappedText(rows[index]?.[col])));
  });
  if (trimUnused) {
    let frame: Node | null = table.parentNode;
    while (frame && frame.nodeName !== "p:graphicFrame") frame = frame.parentNode;
    const extent = frame ? elements(frame as Element, A, "ext")[0] : undefined;
    if (extent) extent.setAttribute("cy", String(elements(table, A, "tr").reduce((sum, row) => sum + Number(row.getAttribute("h") || 0), 0)));
  }
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
  skipPriorityActions?: boolean;
}): Promise<Buffer> {
  const files = unzipSync(await template());
  const cover = input.sections.find(section => section.key === "cover");
  const reportNumber = cover?.fields.find(field => field.label === "Audit Report Number")?.value;
  {
    // The supplied template inherits this footer from its layout. Preserve
    // branding and the separate Audit reference; only add the issued report ID.
    const auditReference = mappedText(cover?.fields.find(field => field.label === "Audit reference")?.value);
    for (const [layoutPath, bytes] of Object.entries(files)) {
      if (!/^ppt\/slideLayouts\/.*\.xml$/.test(layoutPath)) continue;
      const layout = parse(bytes);
      let changed = false;
      for (const container of elements(layout, P, "sp")) {
        const text = elements(container, A, "t").map(run => run.textContent ?? "").join("");
        if (text.includes("Quality Internal Audit Report") && text.includes("[Audit Ref]")) {
          setText(container, `Report No: ${mappedText(reportNumber)}  |  Audit Ref: ${auditReference}`);
          changed = true;
        }
      }
      if (changed) files[layoutPath] = xml(layout);
    }
  }
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
  // Stable finding identities, never display references, determine pagination.
  const photos = photographicPages(section("photographs")?.photos ?? []);
  for (let slideNumber = 1; slideNumber <= 18; slideNumber++) {
    if (slideNumber === 16 && input.skipPriorityActions) continue;
    const path = `ppt/slides/slide${slideNumber}.xml`;
    // Capture pristine source parts before writing page zero back to files.
    // Otherwise photo continuations inherit its image relationships and append
    // the same relationship IDs again, producing an invalid PowerPoint package.
    const sourceSlide = files[path]!;
    const sourceRels = files[`ppt/slides/_rels/slide${slideNumber}.xml.rels`]!;
    const base = parse(sourceSlide);
    if (slideNumber === 8) removeProgressTotal(base);
    const tables = elements(base, A, "tbl");
    const mapping = mappings.get(slideNumber);
    const ofi = slideNumber === 12 ? ofiPages(tables[0]!, mapping?.tables[0] ?? []) : undefined;
    const summary = slideNumber === 7 ? summaryPages(tables[0]!, mapping?.tables[0] ?? []) : undefined;
    const pages = mapping?.tables.map((rows, i) => {
      if (slideNumber === 12 || slideNumber === 7) return [];
      const start = tableStarts[slideNumber] ?? 1;
      const capacity = elements(tables[i]!, A, "tr").length - start;
      if (capacity < 1) throw new Error("PowerPoint template has no table data rows");
      // Long cells are continued without truncation, within the existing row geometry.
      const expanded = rows.flatMap(row => {
        const maxLength = slideNumber === 15 ? 110 : 160;
        const count = Math.max(1, ...row.map(cell => Math.ceil(cell.length / maxLength)));
        return Array.from({ length: count }, (_, part) => row.map((cell, col) =>
          col === 0 ? (part ? `${cell} (continued)` : cell)
            : slideNumber === 11 && col === 2 && cell === "-" ? "-"
            : cell.slice(part * maxLength, (part + 1) * maxLength) || (part ? "" : cell)));
      });
      return chunks(expanded, capacity);
    }) ?? [];
    const activityRows = [...(section("programme")?.tables[0]?.rows ?? [])]
      .filter(row => row.some(cell => ![PPTX_EMPTY, PPTX_UNMAPPED].includes(mappedText(cell))));
    const programmeField = (label: string) => mappedText(section("programme")?.fields.find(f => f.label === label)?.value);
    for (const meeting of ["Opening", "Closing"]) {
      const held = programmeField(`${meeting} meeting`);
      const minutes = programmeField(`${meeting} minutes`);
      if (![PPTX_EMPTY, PPTX_UNMAPPED].includes(held) || ![PPTX_EMPTY, PPTX_UNMAPPED].includes(minutes)) activityRows.push([
        held, PPTX_EMPTY, `${meeting} meeting (recorded)`, minutes, programmeField("Auditees present"),
      ]);
    }
    const activities = programmePages(activityRows);
    const participation = [28, 33, 38].map(id => chunks(programmeLines(mapping?.shapes[id] ?? PPTX_EMPTY, 26), id === 33 ? 5 : 4));
    const themeRows = (section("findings-summary")?.tables[1]?.rows ?? [])
      .filter(row => row.some(cell => ![PPTX_EMPTY, PPTX_UNMAPPED].includes(mappedText(cell))));
    const themes = chunks(themeRows, 3);
    const scopeText = [6, 11, 16, 21].map(id => chunks(
      programmeLines(mapping?.shapes[id] ?? PPTX_EMPTY, id === 6 ? 78 : 21), id === 6 ? 2 : 16));
    const count = Math.max(1, ...pages.map(p => p.length), slideNumber === 5 ? activities.length : 1,
      ofi?.length ?? 1,
      summary?.length ?? 1,
      slideNumber === 13 ? photos.length : 1, slideNumber === 7 ? themes.length : 1,
      ...(slideNumber === 4 ? scopeText.map(pages => pages.length) : [1]),
      ...(slideNumber === 5 ? participation.map(p => p.length) : [1]));
    for (let page = 0; page < count; page++) {
      const doc = parse(sourceSlide);
      // Clean template instructions before inserting record data; brackets in
      // actual audit text are valid content and must never be mistaken for prompts.
      for (const s of elements(doc, P, "sp")) {
        const text = elements(s, A, "t").map(t => t.textContent ?? "").join("");
        if (/\[[^\]]*\]|Engr\. \(Name|E\.g\. Project Manager/.test(text)) setText(s, PPTX_UNMAPPED);
      }
      const slideTables = elements(doc, A, "tbl");
      if (slideNumber === 8) removeProgressTotal(doc);
      for (const [id, text] of Object.entries(mapping?.shapes ?? {})) setShape(doc, Number(id), text);
      if (summary) renderSummaryPage(slideTables[0]!, summary[page], setText);
      else if (ofi) renderOfiPage(doc, slideTables[0]!, ofi[page]!, setText);
      else mapping?.tables.forEach((_, i) => setTable(slideTables[i]!, pages[i]?.[page] ?? [], tableStarts[slideNumber] ?? 1,
        elements(slideTables[i]!, A, "tr").length - (tableStarts[slideNumber] ?? 1), [8, 10, 15].includes(slideNumber),
        slideNumber === 15 ? ["No CAR responses recorded", "—", "—", "—", "—", "—", "—", "—"] : undefined));
      if ([11, 12].includes(slideNumber)) {
        const group = elements(slideTables[0]!, A, "tr")[1]!;
        const cells = elements(group, A, "tc");
        cells.forEach((cell, col) => setText(cell, col === 0 ? (slideNumber === 11 ? "Non-conformities" : "Opportunities for improvement") : ""));
      }
      if (slideNumber === 5) {
        programmeBox(doc, 37, "Not represented in\nClosing meeting", 1100, 1250,
          { y: 5010912, width: 4206240, height: 381000 });
        const markerCenters: number[] = [];
        const remove = (id: number) => { const node = shape(doc, id); node?.parentNode?.removeChild(node); };
        for (let i = 0; i < 5; i++) {
          const row = activities[page]?.[i];
          const markerId = 9 + i * 3, timeId = 10 + i * 3, detailsId = 11 + i * 3;
          if (!row) {
            remove(markerId); remove(timeId); remove(detailsId);
            continue;
          }
          if (row.continued) remove(markerId);
          else {
            const marker = shape(doc, markerId)!;
            elements(marker, A, "off")[0]!.setAttribute("y", String(row.top + 164592));
            markerCenters.push(row.top + 310896);
          }
          programmeBox(doc, timeId, row.times, 1100, 1200, { y: row.top, width: 4480560, height: 330200 });
          programmeBox(doc, detailsId, row.details, 1050, 1150, { y: row.detailsTop, width: 4480560, height: row.detailsHeight });
          plainParagraphs(doc, detailsId);
        }
        if (markerCenters.length < 2) remove(8);
        else {
          const connector = shape(doc, 8)!;
          elements(connector, A, "off")[0]!.setAttribute("y", String(markerCenters[0]));
          elements(connector, A, "ext")[0]!.setAttribute("cy", String(markerCenters.at(-1)! - markerCenters[0]!));
        }
        [28, 33, 38].forEach((id, i) => programmeBox(doc, id, participation[i]?.[page]?.join("\n") ?? PPTX_EMPTY, 1100, 1250,
          id === 38 ? { y: 5437512, width: 4206240, height: 685800 } : undefined));
        setShape(doc, 6, String(outputSlides.length + 1));
      }
      if (slideNumber === 4) [6, 11, 16, 21].forEach((id, i) => scopeBox(doc, id, scopeText[i]?.[page]?.join("\n") ?? ""));
      if (slideNumber === 7) {
        for (let i = 0; i < 3; i++) {
          const row = themes[page]?.[i];
          if (row) {
            setShape(doc, [4, 13, 17][i]!, String(page * 3 + i + 1));
            setShape(doc, 10 + i * 4, mappedText(row[0]));
            setShape(doc, 11 + i * 4, mappedText(row.slice(1).join(" · ")));
          } else {
            for (const id of [[8, 4], [12, 13], [16, 17]][i]!) removeShape(doc, id);
            if (i === 0 && !themeRows.length) setShape(doc, 10, "None");
            else removeShape(doc, 10 + i * 4);
            removeShape(doc, 11 + i * 4);
          }
        }
      }
      if (slideNumber === 10) {
        for (const id of [5, 6, 8, 9]) removeShape(doc, id);
        setShape(doc, 3, "Areas verified as conforming");
      }
      const target = page ? nextSlide++ : slideNumber;
      const targetPath = `ppt/slides/slide${target}.xml`;
      let slideRels = parse(sourceRels);
      if (page) {
        // A notes slide belongs to exactly one presentation slide.
        for (const rel of elements(slideRels, REL, "Relationship")) {
          if (rel.getAttribute("Type")?.endsWith("/notesSlide")) rel.parentNode!.removeChild(rel);
        }
      }
      if (slideNumber === 13) {
        await renderPhotographicPage({ doc, rels: slideRels, page: photos[page], target, files, photos: input.photos, setText });
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
