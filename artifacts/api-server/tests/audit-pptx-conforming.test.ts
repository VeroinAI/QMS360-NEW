import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { auditPptxMappings, PPTX_UNMAPPED, PPTX_EMPTY } from "../src/lib/audit-pptx-mapping";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (node: ReturnType<typeof parse>) => Array.from(node.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
const build = (goodPractices: Record<string, string>[] = [], checklist: Record<string, unknown>[] = [], pptxWorkbookMappings = true) =>
  buildConsolidatedAuditReport({
    audit: { title: "Audit", checklist, additionalDocuments: { goodPractices } },
    legacyFindings: [], cars: [], evidence: [{ id: "file", fileName: "Verified record.pdf" }],
    names: new Map(), roleNames: new Map(), pptxWorkbookMappings,
  });

/** Read presentation order rather than physical part numbers: earlier tables may continue. */
function presentationDocs(files: Record<string, Uint8Array>) {
  const rels = Array.from(parse(files["ppt/_rels/presentation.xml.rels"]!).getElementsByTagName("Relationship"));
  return Array.from(parse(files["ppt/presentation.xml"]!).getElementsByTagNameNS(P, "sldId"))
    .map(id => {
      const target = rels.find(rel => rel.getAttribute("Id") === id.getAttributeNS(R, "id"))!.getAttribute("Target");
      return parse(files[`ppt/${target}`]!);
    });
}
function conformingDocs(files: Record<string, Uint8Array>) {
  return presentationDocs(files).filter(doc => text(doc).includes("Areas verified as conforming"));
}

function checkPackage(files: Record<string, Uint8Array>) {
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith(".rels")) {
      const rels = Array.from(parse(bytes).getElementsByTagName("Relationship"));
      expect(new Set(rels.map(rel => rel.getAttribute("Id"))).size, name).toBe(rels.length);
      for (const rel of rels) {
        if (rel.getAttribute("TargetMode") === "External") continue;
        const dir = name === "_rels/.rels" ? "" : path.posix.dirname(path.posix.dirname(name));
        const target = rel.getAttribute("Target")!;
        expect(files[target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(dir, target))], name).toBeTruthy();
      }
    }
    if (!name.endsWith(".xml")) continue;
    for (const p of Array.from(parse(bytes).getElementsByTagNameNS(A, "p"))) {
      const children = Array.from(p.childNodes).filter(n => n.nodeType === 1);
      if (children.some(n => n.localName === "pPr")) expect(children[0]!.localName, name).toBe("pPr");
      if (children.some(n => n.localName === "endParaRPr")) expect(children.at(-1)!.localName, name).toBe("endParaRPr");
    }
  }
}

describe("Conforming areas actual-row PowerPoint rendering", () => {
  it.each([0, 1, 3, 5, 6, 13])("retains exactly %i recorded rows in order, with no unused slots", async count => {
    const data = build(Array.from({ length: count }, (_, i) => ({
      areaProcess: `Area ${i}`, verifiedConforming: `Verified ${i}`, evidenceReference: `Record ${i}`, referenceNumber: `GP-${i}`,
    })));
    // Force earlier continuations so locating the section cannot rely on its displayed page number.
    data.find(s => s.key === "non-conformities")!.tables[0]!.rows = [];
    data.find(s => s.key === "project-progress")!.tables[0]!.rows =
      Array.from({ length: 20 }, (_, i) => [`Phase ${i}`, "10%", "20", "30", "10", "0"]);
    const bytes = await renderConsolidatedAuditPptx({ sections: data });
    const files = unzipSync(bytes), docs = conformingDocs(files);
    const firstConformingPage = presentationDocs(files).findIndex(doc => text(doc).includes("Areas verified as conforming")) + 1;
    expect(docs).toHaveLength(Math.max(1, Math.ceil(count / 5)));
    const actual: string[][] = [];
    const templateFiles = unzipSync(await readFile(new URL("../src/assets/audit-report-template.pptx", import.meta.url)));
    const original = parse(templateFiles["ppt/slides/slide10.xml"]!);
    const tick = Array.from(original.getElementsByTagNameNS(P, "pic"))
      .find(pic => pic.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === "7")!;
    expect(tick.getElementsByTagNameNS(P, "cNvPr")[0]!.getAttribute("name")).toBe("Image 0");
    expect(tick.getElementsByTagNameNS(A, "blip")[0]!.getAttributeNS(R, "embed")).toBe("rId3");
    const originalStyles = Array.from(original.getElementsByTagNameNS(A, "tcPr")).map(n => n.toString());
    for (const [page, doc] of docs.entries()) {
      for (const id of ["5", "6", "7", "8", "9"]) {
        expect(Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).some(n => n.getAttribute("id") === id)).toBe(false);
      }
      expect(Array.from(doc.getElementsByTagNameNS(A, "blip")).some(n => n.getAttributeNS(R, "embed") === "rId3")).toBe(false);
      expect(Array.from(doc.getElementsByTagNameNS(P, "pic")).map(n => n.toString()))
        .toEqual(Array.from(original.getElementsByTagNameNS(P, "pic")).filter(n => n !== tick).map(n => n.toString()));
      const heading = (source: typeof doc) => Array.from(source.getElementsByTagNameNS(P, "sp"))
        .find(s => s.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === "2")!.toString();
      expect(heading(doc)).toBe(heading(original));
      const number = Array.from(doc.getElementsByTagNameNS(P, "sp"))
        .find(s => s.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === "25")!;
      expect(number.getElementsByTagNameNS(A, "t")[0]!.textContent).toBe(String(firstConformingPage + page));
      const table = doc.getElementsByTagNameNS(A, "tbl")[0]!;
      const rows = Array.from(table.getElementsByTagNameNS(A, "tr"));
      expect(rows).toHaveLength(1 + Math.min(5, Math.max(0, count - page * 5)));
      const frame = doc.getElementsByTagNameNS(P, "graphicFrame")[0]!;
      expect(Number(frame.getElementsByTagNameNS(A, "ext")[0]!.getAttribute("cy")))
        .toBe(rows.reduce((sum, row) => sum + Number(row.getAttribute("h")), 0));
      expect(Array.from(table.getElementsByTagNameNS(A, "tcPr")).map(n => n.toString()))
        .toEqual(originalStyles.slice(0, rows.length * 3));
      actual.push(...rows.slice(1).map(row => Array.from(row.getElementsByTagNameNS(A, "tc"))
        .map(cell => Array.from(cell.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join(""))));
      expect(text(doc)).not.toContain("No CAR responses");
      expect(text(doc)).not.toContain(PPTX_UNMAPPED);
    }
    expect(actual).toEqual(Array.from({ length: count }, (_, i) => [`Area ${i}`, `Verified ${i}`, `Record ${i}`]));
    if (!count) expect(text(docs[0]!)).not.toMatch(/good practices|positive observations/i);
    else expect(text(docs[0]!)).not.toContain("Good practices and positive observations");
    for (const [name, originalBytes] of Object.entries(templateFiles)) {
      if (name.startsWith("ppt/media/") || name.startsWith("ppt/slideMasters/")) {
        expect(files[name], name).toEqual(originalBytes);
      }
      // The photographic section intentionally replaces/removes its sample pictures.
      if (/^ppt\/slides\/slide\d+\.xml$/.test(name) && !["ppt/slides/slide10.xml", "ppt/slides/slide13.xml"].includes(name)) {
        const pictures = (bytes: Uint8Array) => Array.from(parse(bytes).getElementsByTagNameNS(P, "pic")).map(n => n.toString());
        expect(pictures(files[name]!), name).toEqual(pictures(originalBytes));
      }
    }
    checkPackage(files);
    if (process.env.QMS_CONFORMING_VISUAL === "1" && [0, 1, 6].includes(count)) {
      await mkdir("../../generated-artifacts/audit-conforming", { recursive: true });
      await writeFile(`../../generated-artifacts/audit-conforming/${count}-entries.pptx`, bytes);
    }
  });

  it("excludes empty and whitespace-only source rows from both PPTX tables without changing other exports or saved data", () => {
    const rows = [
      {}, { areaProcess: "", verifiedConforming: "", evidenceReference: "", referenceNumber: "" },
      { areaProcess: " \t", verifiedConforming: "\n", evidenceReference: " ", referenceNumber: "\r\n" },
      { areaProcess: "Construction", verifiedConforming: "Co-ordination", evidenceReference: "", referenceNumber: "ok" },
      { evidenceReference: "Record-only practice" }, { referenceNumber: "Reference-only practice" },
    ];
    const before = JSON.stringify(rows);
    const sections = build(rows);
    const mapped = auditPptxMappings(sections).get(10)!;
    expect(mapped.tables[0]).toEqual([
      ["Construction", "Co-ordination", PPTX_EMPTY],
      [PPTX_EMPTY, PPTX_EMPTY, "Record-only practice"],
      [PPTX_EMPTY, PPTX_EMPTY, PPTX_EMPTY],
    ]);
    expect(sections.find(s => s.key === "conforming")!.tables[1]!.rows).toHaveLength(3);
    expect(mapped.shapes[9]).toBeUndefined();
    expect(build(rows, [], false).find(s => s.key === "conforming")!.tables[1]!.rows).toHaveLength(6);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("keeps factual conforming checklist entries before saved practices, preserving existing inclusion and missing-cell rules", async () => {
    const checklist = [
      { result: "Pass", auditArea: "Checklist area", question: "Verified question", evidenceIds: ["file"] },
      { result: "Compliant", auditArea: "Partial area" },
      { result: "Pass", auditArea: "Finding, not conforming", auditFinding: "OFI" },
      { result: "Fail", auditArea: "Failed area" },
    ];
    const data = build([{ verifiedConforming: "Recorded practice" }, {}], checklist);
    expect(auditPptxMappings(data).get(10)!.tables[0]).toEqual([
      ["Checklist area", "Verified question", "Verified record.pdf"],
      ["Partial area", PPTX_EMPTY, PPTX_EMPTY],
      [PPTX_EMPTY, "Recorded practice", PPTX_EMPTY],
    ]);
    const doc = conformingDocs(unzipSync(await renderConsolidatedAuditPptx({ sections: data })))[0]!;
    expect(doc.getElementsByTagNameNS(A, "tr")).toHaveLength(4);
    expect(text(doc)).toContain(PPTX_EMPTY);
    expect(text(doc)).toContain("Recorded practice");
  });

  it("shows a header-only empty table for wholly blank practices and no placeholder-only positive observations", async () => {
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: build([{}, { areaProcess: " \n " }]) }));
    const doc = conformingDocs(files)[0]!;
    expect(doc.getElementsByTagNameNS(A, "tr")).toHaveLength(1);
    expect(text(doc)).not.toContain(PPTX_UNMAPPED);
    expect(text(doc)).not.toMatch(/good practices|positive observations/i);
  });

  it("preserves long-text continuation content and trims the last page using pristine styled rows", async () => {
    const description = "Recorded conforming description with factual detail. ".repeat(27) + "END-OF-ENTRY";
    const data = build([], [{ result: "Pass", auditArea: "Long entry", description }]);
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const docs = conformingDocs(files);
    const expectedRows = Math.ceil(description.length / 160);
    expect(docs).toHaveLength(Math.ceil(expectedRows / 5));
    const rows = docs.flatMap(doc => Array.from(doc.getElementsByTagNameNS(A, "tr")).slice(1));
    expect(rows).toHaveLength(expectedRows);
    const retained = rows.map(row => Array.from(row.getElementsByTagNameNS(A, "tc")[1]!.getElementsByTagNameNS(A, "t"))
      .map(t => t.textContent).join("")).join("");
    expect(retained).toBe(description);
    expect(retained.endsWith("END-OF-ENTRY")).toBe(true);
    expect(text(docs.at(-1)!)).toContain("Long entry (continued)");
    checkPackage(files);
  });
});
