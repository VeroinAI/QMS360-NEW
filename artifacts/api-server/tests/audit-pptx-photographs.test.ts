import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { formatDateInTimeZone, setDateFormatResolver } from "@workspace/spreadsheet-dates";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { buildConsolidatedAuditReport, type ReportSectionData } from "../src/lib/audit-consolidated-report";
import { photographicPages } from "../src/lib/audit-pptx-photo-layout";
import { findingCreationDates } from "../src/lib/audit-photo-finding-metadata";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (doc: ReturnType<typeof parse>) => Array.from(doc.getElementsByTagNameNS(A, "t")).map(n => n.textContent).join("\n");
const section = (photos: ReportSectionData["photos"]): ReportSectionData => ({ key: "photographs", title: "Photographic evidence", fields: [], tables: [], notes: [], photos });
const photo = (i: number, findingId = "finding-one") => ({
  id: `photo-${i}`, findingId, fileName: `photo-${i}.png`, reference: "FN-001",
  findingCreatedDate: "01/10/2026", grade: "Major", location: "Actual site", captionDescription: `Recorded image ${i}`,
  description: "Grade: Major\nDate captured: 02/10/2026\nDate uploaded: 03/10/2026\nRequirement: saved clause",
});
const photoDocs = (files: Record<string, Uint8Array>) => Object.entries(files)
  .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  .map(([name, bytes]) => ({ name, doc: parse(bytes) }))
  .filter(({ doc }) => Array.from(doc.getElementsByTagNameNS(P, "sp")).some(n =>
    n.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === "3"
    && Array.from(n.getElementsByTagNameNS(A, "t")).some(t => t.textContent === "Photographic evidence")));

function checkPackage(files: Record<string, Uint8Array>) {
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith(".rels")) {
      const rels = Array.from(parse(bytes).getElementsByTagName("Relationship"));
      expect(new Set(rels.map(n => n.getAttribute("Id"))).size, name).toBe(rels.length);
      for (const rel of rels) {
        if (rel.getAttribute("TargetMode") === "External") continue;
        const directory = name === "_rels/.rels" ? "" : path.posix.dirname(path.posix.dirname(name));
        const target = rel.getAttribute("Target")!;
        const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(directory, target));
        expect(files[resolved], `${name}: ${resolved}`).toBeTruthy();
      }
    }
    if (!name.endsWith(".xml")) continue;
    const doc = parse(bytes);
    for (const p of Array.from(doc.getElementsByTagNameNS(A, "p"))) {
      const children = Array.from(p.childNodes).filter(n => n.nodeType === 1);
      if (children.some(n => n.localName === "pPr")) expect(children[0]!.localName).toBe("pPr");
      if (children.some(n => n.localName === "endParaRPr")) expect(children.at(-1)!.localName).toBe("endParaRPr");
    }
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const ids = Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).map(n => n.getAttribute("id"));
    expect(new Set(ids).size, name).toBe(ids.length);
    const rels = parse(files[name.replace("/slides/", "/slides/_rels/") + ".rels"]!);
    const available = new Set(Array.from(rels.getElementsByTagName("Relationship")).map(n => n.getAttribute("Id")));
    for (const blip of Array.from(doc.getElementsByTagNameNS(A, "blip"))) expect(available.has(blip.getAttributeNS(R, "embed"))).toBe(true);
  }
}

describe("Dynamic photographic evidence layouts", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 11])("keeps all %i photographs, bounded geometry, native aspect ratios and no empty slots", async count => {
    const photos = Array.from({ length: count }, (_, i) => photo(i));
    const images = new Map(await Promise.all(photos.map(async (p, i) => [p.id, await sharp({ create: {
      width: i % 2 ? 160 : 240, height: i % 2 ? 240 : 120, channels: 3, background: i % 2 ? "#2277bb" : "#bb7733",
    } }).png().toBuffer()] as const)));
    const bytes = await renderConsolidatedAuditPptx({ sections: [section(photos)], photos: images });
    const files = unzipSync(bytes), docs = photoDocs(files);
    expect(docs).toHaveLength(Math.max(1, Math.ceil(count / 5)));
    expect(docs.reduce((sum, { doc }) => sum + doc.getElementsByTagNameNS(P, "pic").length, 0)).toBe(count);
    expect(Object.keys(files).filter(n => n.startsWith("ppt/media/audit-photo-"))).toHaveLength(count);
    for (const { doc } of docs) {
      expect(text(doc)).not.toMatch(/Requirement:|Insert photo|Circle or arrow|Date: 02\/10|Date: 03\/10/);
      if (count) expect(text(doc)).toContain("Date: 01/10/2026");
      const boxes = [...Array.from(doc.getElementsByTagNameNS(P, "pic")), ...Array.from(doc.getElementsByTagNameNS(P, "sp"))
        .filter(n => n.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name")?.startsWith("Audit photographic"))]
        .map(n => {
          const transform = n.getElementsByTagNameNS(A, "xfrm")[0]!;
          const off = transform.getElementsByTagNameNS(A, "off")[0]!, ext = transform.getElementsByTagNameNS(A, "ext")[0]!;
          return { x: Number(off.getAttribute("x")), y: Number(off.getAttribute("y")), w: Number(ext.getAttribute("cx")), h: Number(ext.getAttribute("cy")), node: n };
        });
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(12192000);
        expect(box.y + box.h).toBeLessThan(6200000);
        if (box.node.localName === "pic") expect([2, 2 / 3].some(ratio => Math.abs(box.w / box.h - ratio) < 0.00001)).toBe(true);
        for (const p of Array.from(box.node.getElementsByTagNameNS(A, "pPr"))) {
          const children = Array.from(p.childNodes).filter(n => n.nodeType === 1).map(n => n.localName);
          expect(children.slice(0, 3)).toEqual(["lnSpc", "spcBef", "spcAft"]);
        }
      }
      for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) {
        const a = boxes[i]!;
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    }
    checkPackage(files);
    if (process.env.QMS_PHOTO_VISUAL === "1" && [1, 5].includes(count)) {
      await mkdir("../../generated-artifacts/audit-photos", { recursive: true });
      await writeFile(`../../generated-artifacts/audit-photos/${count}-images.pptx`, bytes);
    }
  });
  it("never groups findings by missing or duplicate display references, including shared evidence", () => {
    const photos = [photo(0, "a"), photo(1, "b"), photo(2, "a"), photo(0, "c")].map(p => ({ ...p, reference: "Not recorded", findingCreatedDate: undefined }));
    const pages = photographicPages(photos);
    expect(pages.map(p => p.cards.length)).toEqual([2, 1, 1]);
    expect(pages.map(p => p.finding.findingId)).toEqual(["a", "b", "c"]);
  });
  it("keeps complete long captions, including embedded label-like text, on legible continuations", async () => {
    const description = "Saved long caption with important words and no omitted text. ".repeat(80) + "\nRequirement: this is actual description text, not a heading to remove.\nDescription: final saved line.";
    const photos = Array.from({ length: 5 }, (_, i) => ({ ...photo(i), ...(i === 0 ? { captionDescription: description } : {}) }));
    const png = await sharp({ create: { width: 240, height: 120, channels: 3, background: "#336699" } }).png().toBuffer();
    const bytes = await renderConsolidatedAuditPptx({ sections: [section(photos)], photos: new Map(photos.map(p => [p.id, png])) });
    const files = unzipSync(bytes), docs = photoDocs(files);
    expect(docs[0]!.doc.getElementsByTagNameNS(P, "pic").length).toBe(5);
    expect(docs.slice(1).every(({ doc }) => doc.getElementsByTagNameNS(P, "pic").length === 0)).toBe(true);
    const normalized = docs.slice(1).flatMap(({ doc }) => Array.from(doc.getElementsByTagNameNS(P, "sp"))
      .filter(n => n.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name")?.startsWith("Audit photographic"))
      .slice(1).map(n => Array.from(n.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n")))
      .join("\n").replace(/\s/g, "");
    expect(normalized).toContain(description.replace(/\s/g, ""));
    expect(normalized).not.toContain("savedclause");
    checkPackage(files);
    if (process.env.QMS_PHOTO_VISUAL === "1") await writeFile("../../generated-artifacts/audit-photos/long-captions.pptx", bytes);
  });
});

describe("Factual finding metadata, exclusively for PPTX", () => {
  it.each(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const)("uses canonical number and original creation date with organization preference %s", format => {
    setDateFormatResolver(() => format);
    try {
      const createdAt = "2026-10-01T23:30:00Z";
      const input = {
        audit: { title: "Audit", checklist: [
          { id: "a", findingNumber: "FN-SAVED-009", clientReference: "client-idempotency-key", findingCreatedAt: createdAt, auditFinding: "Major NC", evidenceIds: ["shared", "one"] },
          { id: "b", auditFinding: "Minor NC", evidenceIds: ["shared"] },
        ], reportDetails: { values: {}, rows: { photographs: [{ fileName: "one.png", reference: "fabricated", date: "2026-09-20", requirement: "Stored Requirement", description: "Saved caption" }] } } },
        evidence: ["shared", "one", "legacy", "unlinked"].map(id => ({ id, fileName: `${id}.png`, mimeType: "image/png", createdAt: "2026-10-15" })),
        legacyFindings: [{ id: "legacy-finding", classification: "Minor NC", evidenceIds: ["legacy"], createdAt: "2026-08-15T10:00:00Z", raisedAt: "2026-09-01", updatedAt: "2026-10-20" }],
        cars: [], names: new Map(), roleNames: new Map(),
      };
      const before = JSON.stringify(input);
      const normal = buildConsolidatedAuditReport(input);
      const photos = buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true }).find(s => s.key === "photographs")!.photos;
      expect(photos).toHaveLength(4);
      const a = photos.find(p => p.findingId === "checklist:a")!;
      expect(a.reference).toBe("FN-SAVED-009");
      expect(a.findingCreatedDate).toBe(formatDateInTimeZone(createdAt, "Asia/Riyadh"));
      const b = photos.find(p => p.findingId === "checklist:b")!;
      expect(b.reference).toBe("Not recorded"); expect(b.findingCreatedDate).toBe("Not recorded");
      const legacy = photos.find(p => p.findingId === "legacy:legacy-finding")!;
      expect(legacy.findingCreatedDate).toBe(formatDateInTimeZone("2026-08-15T10:00:00Z", "Asia/Riyadh"));
      expect(legacy.reference).toBe("Not recorded");
      expect(normal.find(s => s.key === "photographs")!.photos).toHaveLength(4);
      expect(normal.find(s => s.key === "photographs")!.photos.find(p => p.id === "one")!.description).toContain("Requirement: Stored Requirement");
      expect(normal.find(s => s.key === "photographs")!.photos[0]).not.toHaveProperty("findingId");
      expect(buildConsolidatedAuditReport(input)).toEqual(normal);
      expect(JSON.stringify(input)).toBe(before);
    } finally { setDateFormatResolver(() => "DD/MM/YYYY"); }
  });
  it("recovers the first retained transition into a finding, not later edit, checklist insertion or CAR dates", () => {
    const item = { id: "a", auditFinding: "Major NC" };
    const events = [
      { createdAt: "2026-10-20", before: { checklistState: [item] }, after: { checklistState: [{ ...item, description: "Edited" }] } },
      { createdAt: "2026-10-10", before: { checklistState: [{ id: "a" }] }, after: { checklistState: [item] } },
      { createdAt: "2026-10-01", before: { checklistState: [] }, after: { checklistState: [{ id: "a" }] } },
      { createdAt: "2026-10-15", after: { checklistState: [{ id: "unknown", auditFinding: "Minor NC" }] } },
    ];
    expect([...findingCreationDates(events)]).toEqual([["a", "2026-10-10"]]);
  });
});
