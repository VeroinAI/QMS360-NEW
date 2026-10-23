import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { auditPptxMappings } from "../src/lib/audit-pptx-mapping";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (doc: Document | Element) => Array.from(doc.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
const input = (count: number, description = "Actual suggested improvement") => ({
  audit: { title: "OFI export regression", checklist: Array.from({ length: count }, (_, i) => ({
    id: `ofi-${i}`, auditFinding: "OFI", auditArea: "Design", findingNumber: `AF-CTR-OFI-26-${String(i + 1).padStart(4, "0")}`,
    clientReference: `DO-NOT-USE-${i}`, description, clause: "7.5", notes: "", evidenceIds: [] as string[],
  })) },
  legacyFindings: [] as Record<string, any>[], cars: [] as Record<string, any>[],
  evidence: [] as Record<string, any>[], names: new Map<string, string>(), roleNames: new Map<string, string>(),
});
const build = (data: ReturnType<typeof input>) => buildConsolidatedAuditReport({ ...data, pptxWorkbookMappings: true });
const ofiSlides = (files: Record<string, Uint8Array>) => {
  const rels = Array.from(parse(files["ppt/_rels/presentation.xml.rels"]!).getElementsByTagName("Relationship"));
  return Array.from(parse(files["ppt/presentation.xml"]!).getElementsByTagNameNS(P, "sldId"))
    .map(id => rels.find(rel => rel.getAttribute("Id") === id.getAttributeNS(R, "id"))!)
    .map(rel => parse(files[`ppt/${rel.getAttribute("Target")}`]!))
    .filter(doc => text(doc).includes("OPPORTUNITIES FOR IMPROVEMENT"));
};

describe("OFI report mapping and actual-row layout", () => {
  it("uses only issued references, preserves evidence and notes, deduplicates linked legacy findings and leaves other exports unchanged", () => {
    const data = input(5);
    Object.assign(data.audit.checklist[1]!, { findingNumber: "", notes: "Recorded interview with auditee" });
    Object.assign(data.audit.checklist[2]!, { findingNumber: " ", evidenceIds: ["doc"] });
    Object.assign(data.audit.checklist[3]!, { notes: "  ", evidenceIds: ["unavailable"] });
    Object.assign(data.audit.checklist[4]!, { evidenceIds: ["doc"], notes: "Additional factual evidence" });
    Object.assign(data.audit.checklist[0]!, { findingId: "linked" });
    data.legacyFindings = [
      { id: "linked", classification: "OFI", description: "Must not duplicate" },
      { id: "legacy", classification: "Observation", description: "Legacy improvement", notes: "Legacy recorded evidence", clientReference: "BAD-LEGACY-KEY" },
    ];
    data.cars = [{ findingId: "ofi-1", carNumber: "CAR-NOT-A-FINDING" }];
    data.evidence = [{ id: "doc", fileName: "Actual record.pdf", mimeType: "application/pdf" }];
    const before = JSON.stringify(data);
    const baseline = buildConsolidatedAuditReport(data);
    const sections = build(data), rows = auditPptxMappings(sections).get(12)!.tables[0]!;
    expect(rows).toHaveLength(6);
    expect(rows.map(r => r[0])).toEqual([
      "AF-CTR-OFI-26-0001", "To be mapped", "To be mapped", "AF-CTR-OFI-26-0004", "AF-CTR-OFI-26-0005", "To be mapped",
    ]);
    expect(rows.map(r => r[2])).toEqual(["-", "Recorded interview with auditee", "Actual record.pdf",
      "File unavailable (unavailable)", "Actual record.pdf\nAdditional factual evidence", "Legacy recorded evidence"]);
    expect(JSON.stringify(rows)).not.toMatch(/B\.1\.|DO-NOT-USE|BAD-LEGACY|CAR-NOT|Must not duplicate/);
    expect(buildConsolidatedAuditReport(data)).toEqual(baseline);
    expect(baseline.find(s => s.key === "ofi")!.tables[0]!.rows[0]![0]).toBe("DO-NOT-USE-0");
    expect(baseline.find(s => s.key === "ofi")!.tables[0]!.rows[0]![3]).toBe("Not recorded");
    expect(JSON.stringify(data)).toBe(before);
    // NCR also uses issued numbers, but unlike OFI it excludes notes from evidence.
    data.audit.checklist[0]!.auditFinding = "Major NC";
    const nc = auditPptxMappings(build(data)).get(11)!.tables[0]![0]!;
    expect(nc[0]).toBe("AF-CTR-OFI-26-0001"); expect(nc[2]).toBe("-");
  });

  it.each([0, 1, 5, 23])("renders exactly %i finding rows, with no spare rows on any page", async count => {
    const data = input(count);
    const bytes = await renderConsolidatedAuditPptx({ sections: build(data) });
    const files = unzipSync(bytes), slides = ofiSlides(files);
    const rows = slides.flatMap(doc => Array.from(doc.getElementsByTagNameNS(A, "tr")).slice(2));
    expect(rows).toHaveLength(count);
    expect(rows.map(row => text(row as unknown as Element).split("\n").join(""))).toHaveLength(count);
    slides.forEach(doc => {
      const table = doc.getElementsByTagNameNS(A, "tbl")[0]!;
      const all = Array.from(table.getElementsByTagNameNS(A, "tr"));
      expect(text(doc)).not.toMatch(/B\.\[|No CAR|DO-NOT-USE|\[What/);
      if (count) expect(all.length).toBeGreaterThan(2);
      let frame = table.parentNode!;
      while (frame.localName !== "graphicFrame") frame = frame.parentNode!;
      const extent = (frame as unknown as Element).getElementsByTagNameNS(A, "ext")[0]!;
      expect(Number(extent.getAttribute("cy"))).toBe(all.reduce((n, row) => n + Number(row.getAttribute("h")), 0));
      expect(Number(extent.getAttribute("cy"))).toBeLessThanOrEqual(4151376);
    });
    rows.forEach((row, i) => {
      const cells = Array.from(row.getElementsByTagNameNS(A, "tc"));
      expect(Array.from(cells[0]!.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("")).toBe(data.audit.checklist[i]!.findingNumber);
      expect(text(cells[2]! as unknown as Element)).toBe("-");
    });
    if (!count) {
      expect(slides).toHaveLength(1);
      expect(text(slides[0]!)).toContain("No opportunities for improvement recorded.");
      expect(rows).toEqual([]);
    }
    if (count === 23) expect(slides.length).toBeGreaterThan(1);
    if (process.env.QMS_OFI_VISUAL === "1") {
      await mkdir("../../generated-artifacts/audit-ofi", { recursive: true });
      await writeFile(`../../generated-artifacts/audit-ofi/ofi-${count}.pptx`, bytes);
    }
  });

  it.each([false, true])("preserves ordinary/exceptional long text without creating extra findings (%s)", async exceptional => {
    const description = exceptional
      ? Array.from({ length: 170 }, (_, i) => `Detail-${i}: preserve every word and evidence context. `).join("")
      : "Ordinary long improvement description with all factual details. ".repeat(8);
    const data = input(2, description);
    data.audit.checklist[1]!.description = "Final distinct finding";
    data.audit.checklist[0]!.notes = "W".repeat(exceptional ? 850 : 40);
    const bytes = await renderConsolidatedAuditPptx({ sections: build(data) });
    const files = unzipSync(bytes), slides = ofiSlides(files);
    const rows = slides.flatMap(doc => Array.from(doc.getElementsByTagNameNS(A, "tr")).slice(2));
    expect(rows).toHaveLength(2);
    const content = slides.map(doc => text(doc)).join("\n").replace(/\s+/g, "");
    expect(content.match(/W/g)).toHaveLength(exceptional ? 850 : 40);
    for (const word of description.split(/\s+/).filter(Boolean)) expect(content).toContain(word);
    expect(content).toContain("Finaldistinctfinding");
    if (exceptional) for (let i = 0; i < 170; i++) expect(content.match(new RegExp(`Detail-${i}:`, "g"))).toHaveLength(1);
    expect(slides.some(doc => text(doc).includes("not an additional OFI"))).toBe(exceptional);
    // Validate schema ordering and every relationship target, including pristine
    // continuation cloning and notes relationships inherited from the template.
    for (const [name, part] of Object.entries(files)) {
      if (name.endsWith(".xml")) for (const p of Array.from(parse(part).getElementsByTagNameNS(A, "p"))) {
        const children = Array.from(p.childNodes).filter(n => n.nodeType === 1);
        if (children.some(n => n.localName === "pPr")) expect(children[0]!.localName).toBe("pPr");
        if (children.some(n => n.localName === "endParaRPr")) expect(children.at(-1)!.localName).toBe("endParaRPr");
        const props = p.getElementsByTagNameNS(A, "pPr")[0];
        if (props) {
          const tags = Array.from(props.childNodes).filter(n => n.nodeType === 1).map(n => n.localName);
          const order = ["lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip", "tabLst", "defRPr", "extLst"];
          const ranks = tags.map(t => order.indexOf(t!)).filter(n => n >= 0);
          expect(ranks, name).toEqual([...ranks].sort((a, b) => a - b));
        }
      }
      if (name.endsWith(".rels")) {
        const rels = Array.from(parse(part).getElementsByTagName("Relationship"));
        expect(new Set(rels.map(r => r.getAttribute("Id"))).size).toBe(rels.length);
        for (const rel of rels.filter(r => r.getAttribute("TargetMode") !== "External")) {
          const target = rel.getAttribute("Target")!;
          const owner = name === "_rels/.rels" ? "" : name.replace("/_rels/", "/").replace(/\.rels$/, "");
          const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(owner), target));
          expect(files[resolved], `${name}: ${target}`).toBeTruthy();
        }
      }
    }
    if (process.env.QMS_OFI_VISUAL === "1") await writeFile(`../../generated-artifacts/audit-ofi/ofi-${exceptional ? "overflow" : "long"}.pptx`, bytes);
  });
});
