import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { auditPptxMappings } from "../src/lib/audit-pptx-mapping";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (node: ReturnType<typeof parse>) =>
  Array.from(node.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
const fixture = () => ({
  audit: { title: "NCR mapping regression", checklist: Array.from({ length: 14 }, (_, i) => ({
    id: `nc-${i}`, findingId: i === 0 ? "linked-legacy" : undefined,
    findingNumber: i === 1 ? "" : i === 2 ? " " : `AF-CTR-MIN-26-${String(i + 1).padStart(4, "0")}`,
    clientReference: `IDEMPOTENCY-KEY-${i}`, auditArea: "Construction",
    description: `Saved finding ${i}`, auditFinding: i === 0 ? "Major NC" : i === 1 ? "Moderate NC" : "Minor NC",
    evidenceIds: i === 0 ? ["uploaded"] : i === 3 ? ["unavailable"] : [],
    notes: "General notes are not uploaded evidence", clause: "8.5",
  })) },
  legacyFindings: [
    { id: "linked-legacy", classification: "Major NC", description: "Must not duplicate" },
    { id: "historical", classification: "Minor NC", description: "Historical finding", evidenceIds: ["legacy-file"] },
    { id: "historical-empty", classification: "Minor NC", description: "Historical without evidence", notes: "Not an upload" },
  ],
  evidence: [
    { id: "uploaded", fileName: "Inspection record.pdf", mimeType: "application/pdf" },
    { id: "legacy-file", fileName: "Historical record.pdf", mimeType: "application/pdf" },
    { id: "unrelated", fileName: "Unrelated attachment.pdf", mimeType: "application/pdf" },
  ],
  cars: [{ findingId: "nc-0", carNumber: "CAR-NOT-NCR" }],
  names: new Map<string, string>(), roleNames: new Map<string, string>(),
});

describe("NCR PowerPoint references and uploaded evidence", () => {
  it("uses issued finding numbers only, preserves legacy deduplication and leaves non-PPTX data untouched", () => {
    const input = fixture(), before = JSON.stringify(input);
    const baseline = buildConsolidatedAuditReport(input);
    const sections = buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true });
    const rows = auditPptxMappings(sections).get(11)!.tables[0]!;
    expect(rows).toHaveLength(16);
    expect(rows.map(row => row[0])).toEqual([
      ...input.audit.checklist.map(item => item.findingNumber.trim() || "-"),
      "-", "-",
    ]);
    expect(rows.map(row => row[2])).toEqual([
      "Inspection record.pdf", "-", "-", "File unavailable (unavailable)",
      ...Array(10).fill("-"), "Historical record.pdf", "-",
    ]);
    expect(rows[0]).toEqual([
      "AF-CTR-MIN-26-0001", "Construction\nSaved finding 0", "Inspection record.pdf", "Construction", "Major",
    ]);
    expect(rows[1]![4]).toBe("Moderate");
    expect(JSON.stringify(rows)).not.toMatch(/IDEMPOTENCY|B\.\d|CAR-NOT|General notes|Not an upload|Unrelated|Must not duplicate/);
    expect(baseline.find(s => s.key === "non-conformities")!.tables[0]!.rows[1])
      .toEqual(["IDEMPOTENCY-KEY-1", "Construction", "Saved finding 1", "General notes are not uploaded evidence", "8.5", "Moderate"]);
    expect(buildConsolidatedAuditReport(input)).toEqual(baseline);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("retains references and hyphens across NCR continuation pages without altering table geometry or package integrity", async () => {
    const input = fixture();
    input.audit.checklist[4]!.description = "Long saved NCR description. ".repeat(18);
    const sections = buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true });
    const bytes = await renderConsolidatedAuditPptx({ sections });
    const files = unzipSync(bytes);
    const rels = Array.from(parse(files["ppt/_rels/presentation.xml.rels"]!).getElementsByTagName("Relationship"));
    const slides = Array.from(parse(files["ppt/presentation.xml"]!).getElementsByTagNameNS(P, "sldId"))
      .map(id => rels.find(rel => rel.getAttribute("Id") === id.getAttributeNS(R, "id"))!)
      .map(rel => parse(files[`ppt/${rel.getAttribute("Target")}`]!))
      // Identify the section by content, not the displayed page number.
      .filter(doc => Array.from(doc.getElementsByTagNameNS(A, "tr")[1]?.getElementsByTagNameNS(A, "t") ?? [])
        .some(t => t.textContent === "Non-conformities"));
    expect(slides.length).toBeGreaterThan(1);
    const rows = slides.flatMap(doc => Array.from(doc.getElementsByTagNameNS(A, "tr")).slice(2))
      .map(row => Array.from(row.getElementsByTagNameNS(A, "tc")).map(cell =>
        Array.from(cell.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("")));
    for (const item of input.audit.checklist) {
      const row = rows.find(row => row[1]!.includes(item.description.slice(0, 20)))!;
      expect(row).toBeTruthy();
      expect(row[0]).toBe(item.findingNumber.trim() || "-");
      if (!item.evidenceIds.length) expect(row[2]).toBe("-");
    }
    const continued = rows.filter(row => row[0] === "AF-CTR-MIN-26-0005 (continued)");
    expect(continued.length).toBeGreaterThan(0);
    continued.forEach(row => expect(row[2]).toBe("-"));
    expect(rows.find(row => row[1]!.includes("Historical finding"))?.slice(0, 3))
      .toEqual(["-", "-Historical finding", "Historical record.pdf"]);
    expect(slides.map(text).join("\n")).not.toMatch(/IDEMPOTENCY|CAR-NOT|General notes|Unrelated attachment|Must not duplicate/);
    const original = unzipSync(await readFile(new URL("../src/assets/audit-report-template.pptx", import.meta.url)));
    const template = parse(original["ppt/slides/slide11.xml"]!);
    for (const doc of slides) {
      for (const tag of ["xfrm", "tblPr", "tblGrid", "tcPr", "tr"]) {
        const parts = (source: typeof doc) => Array.from(source.getElementsByTagNameNS(A, tag))
          .map(n => tag === "tr" ? n.getAttribute("h") : n.toString());
        expect(parts(doc), tag).toEqual(parts(template));
      }
    }
    for (const [name, contents] of Object.entries(files)) {
      if (name.endsWith(".rels")) {
        const relationships = Array.from(parse(contents).getElementsByTagName("Relationship"));
        expect(new Set(relationships.map(rel => rel.getAttribute("Id"))).size, name).toBe(relationships.length);
        for (const rel of relationships) {
          if (rel.getAttribute("TargetMode") === "External") continue;
          const directory = name === "_rels/.rels" ? "" : path.posix.dirname(path.posix.dirname(name));
          const target = rel.getAttribute("Target")!;
          const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(directory, target));
          expect(files[resolved], `${name}: ${resolved}`).toBeTruthy();
        }
      }
      if (!name.endsWith(".xml")) continue;
      for (const paragraph of Array.from(parse(contents).getElementsByTagNameNS(A, "p"))) {
        const children = Array.from(paragraph.childNodes).filter(node => node.nodeType === 1);
        if (children.some(node => node.localName === "pPr")) expect(children[0]!.localName).toBe("pPr");
        if (children.some(node => node.localName === "endParaRPr")) expect(children.at(-1)!.localName).toBe("endParaRPr");
      }
    }
    if (process.env.QMS_NCR_VISUAL === "1") {
      await mkdir("../../generated-artifacts/audit-ncr", { recursive: true });
      await writeFile("../../generated-artifacts/audit-ncr/ncr-regression.pptx", bytes);
    }
  });
});
