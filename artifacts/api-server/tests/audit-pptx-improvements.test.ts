import { writeFile } from "node:fs/promises";
import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { formatDateInTimeZone } from "@workspace/spreadsheet-dates";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { auditPptxMappings } from "../src/lib/audit-pptx-mapping";
import { programmeLines } from "../src/lib/audit-programme-pptx-layout";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const els = (node: Document | Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const shape = (doc: Document, id: number) => els(doc, P, "sp").find(s => els(s, P, "cNvPr")[0]?.getAttribute("id") === String(id));
const text = (node?: Element | Document) => node ? els(node, A, "t").map(t => t.textContent ?? "").join(" ") : "";
const noSpaces = (value: string) => value.replace(/\s/g, "");
const source = () => ({
  audit: { title: "Audit report improvements", reportDetails: { values: {
    contractNumber: "STALE-REPORT-CONTRACT", processOwner: "Stale saved owner", effectiveDate: "2001-01-01",
  }, rows: {} } },
  plan: { qaqcScope: "Actual agreed scope" }, schedule: { ownerId: "schedule-owner" },
  project: { name: "Actual project", code: "WRONG-PROJECT-CODE", customFields: {
    contractNumber: "WRONG-LEGACY-CONTRACT", qmsAdditionalData: { contractProjectNumber: "000456/CP-26" },
  } },
  pptxProcessOwnerNames: ["First assigned owner", "Second assigned owner", "First assigned owner"],
  generatedAt: new Date("2026-10-23T23:30:00Z"), timeZone: "Asia/Riyadh",
  legacyFindings: [], cars: [], evidence: [], names: new Map([["schedule-owner", "Not a role-assigned owner"]]),
  roleNames: new Map(), pptxWorkbookMappings: true,
});
const field = (sections: ReturnType<typeof buildConsolidatedAuditReport>, key: string, label: string) =>
  sections.find(s => s.key === key)!.fields.find(f => f.label === label)!;
describe("Requested Audit PowerPoint report corrections", () => {
  it("uses Project Master Additional Data, role-assigned names and the download date, without changing PDF/JSON", async () => {
    const input = source(), snapshot = JSON.stringify(input);
    const sections = buildConsolidatedAuditReport(input);
    const mappings = auditPptxMappings(sections);
    expect(mappings.get(1)!.shapes[14]).toBe("000456/CP-26");
    expect(mappings.get(2)!.shapes[17]).toBe("First assigned owner, Second assigned owner");
    expect(mappings.get(2)!.shapes[15]).toBe(formatDateInTimeZone(input.generatedAt, input.timeZone));
    const output = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    expect(text(shape(parse(output["ppt/slides/slide1.xml"]!), 14))).toBe("000456/CP-26");
    expect(text(shape(parse(output["ppt/slides/slide2.xml"]!), 17))).toBe("First assigned owner, Second assigned owner");
    expect(JSON.stringify(input)).toBe(snapshot);
    const other = buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: false });
    expect(field(other, "cover", "Contract / project number").value).toBe("STALE-REPORT-CONTRACT");
    expect(field(other, "document-control", "Process owner").value).toBe("Stale saved owner");
    expect(field(other, "document-control", "Effective date").value).toBe("2001-01-01");
    const empty = source(); empty.project.customFields.qmsAdditionalData.contractProjectNumber = " ";
    empty.pptxProcessOwnerNames = [];
    const blank = auditPptxMappings(buildConsolidatedAuditReport(empty));
    expect(blank.get(1)!.shapes[14]).toBe("-");
    expect(blank.get(2)!.shapes[17]).toBe("-");
  });
  it("continues complete scope sentences within bounded plain-paragraph boxes and enlarges the last participation card text", async () => {
    const sections = buildConsolidatedAuditReport(source());
    for (const f of sections.find(s => s.key === "scope")!.fields) {
      f.value = `${f.label}: ` + "A complete sentence about recorded project scope and actual audit activities. ".repeat(18) + "FINAL-SENTENCE.";
    }
    const mappings = auditPptxMappings(sections);
    const buffer = await renderConsolidatedAuditPptx({ sections });
    if (process.env.QMS_PPTX_LAYOUT_PREVIEW === "1") await writeFile("/tmp/audit-pptx-improvements.pptx", buffer);
    const files = unzipSync(buffer);
    const docs = Object.entries(files).filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .map(([, value]) => parse(value)).filter(doc => text(shape(doc, 3)) === "Objective, scope, criteria and method");
    expect(docs.length).toBeGreaterThan(1);
    // Physical parts use source slide4 followed by newly allocated continuation parts.
    for (const id of [6, 11, 16, 21]) {
      const retained = docs.map(doc => text(shape(doc, id))).join(" ");
      expect(noSpaces(retained)).toBe(noSpaces(mappings.get(4)!.shapes[id]!));
      for (const doc of docs) {
        const box = shape(doc, id)!;
        expect(els(box, A, "p").length).toBeLessThanOrEqual(id === 6 ? 2 : 16);
        expect(els(box, A, "buChar")).toHaveLength(0);
        expect(els(box, A, "buAutoNum")).toHaveLength(0);
        expect(els(box, A, "buNone").length).toBeGreaterThan(0);
        const body = els(box, A, "bodyPr")[0]!;
        expect(body.getAttribute("wrap")).toBe("none");
        const extent = els(box, A, "ext")[0]!;
        expect(els(box, A, "p").length * 1250 * 127).toBeLessThanOrEqual(Number(extent.getAttribute("cy")));
      }
    }
    const programme = parse(files["ppt/slides/slide5.xml"]!);
    const heading = shape(programme, 37)!, names = shape(programme, 38)!;
    expect(text(heading)).toBe("Not represented in Closing meeting");
    expect(Number(els(heading, A, "ext")[0]!.getAttribute("cy"))).toBeGreaterThanOrEqual(2 * 1250 * 127);
    const namesY = Number(els(names, A, "off")[0]!.getAttribute("y"));
    expect(namesY).toBeGreaterThan(Number(els(heading, A, "off")[0]!.getAttribute("y")) + Number(els(heading, A, "ext")[0]!.getAttribute("cy")));
    expect(namesY + Number(els(names, A, "ext")[0]!.getAttribute("cy"))).toBeLessThanOrEqual(6217920);
    expect(programmeLines("Long factual sentence. ".repeat(60), 21).length).toBeGreaterThan(16);
  });
  it("shows None without numbered badges for empty themes and numbers only populated entries across pages", async () => {
    const sections = buildConsolidatedAuditReport(source());
    const themes = sections.find(s => s.key === "findings-summary")!.tables[1]!;
    themes.rows = [[" ", "-", "Not recorded"]];
    let output = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    let doc = parse(output["ppt/slides/slide7.xml"]!);
    expect(text(shape(doc, 10))).toBe("None");
    for (const id of [4, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19]) expect(shape(doc, id)).toBeUndefined();
    themes.rows = Array.from({ length: 4 }, (_, i) => [`Actual theme ${i + 1}`, `Actual explanation ${i + 1}`, "NC-1"]);
    output = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    doc = parse(output["ppt/slides/slide7.xml"]!);
    expect(text(shape(doc, 4))).toBe("1"); expect(text(shape(doc, 13))).toBe("2"); expect(text(shape(doc, 17))).toBe("3");
    const last = Object.entries(output).filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .map(([, bytes]) => parse(bytes)).find(candidate => text(shape(candidate, 10)) === "Actual theme 4")!;
    expect(text(shape(last, 4))).toBe("4");
    expect(shape(last, 13)).toBeUndefined(); expect(shape(last, 17)).toBeUndefined();
  });
  it("removes project progress totals/date/source and the entire good-practice panel", async () => {
    const sections = buildConsolidatedAuditReport(source());
    sections.find(s => s.key === "project-progress")!.tables[0]!.rows = [
      ["Engineering", "20%", "10", "12", "2", "5"], ["Overall", "100%", "33", "44", "11", "22"],
    ];
    const output = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    const progress = parse(output["ppt/slides/slide8.xml"]!);
    const rows = els(progress, A, "tr");
    expect(rows).toHaveLength(2);
    expect(text(rows[1])).toContain("Engineering");
    expect(text(progress)).not.toMatch(/Data as at:|Source:|Overall 100%/);
    expect(text(shape(progress, 7)).trim()).toBe("");
    const conforming = parse(output["ppt/slides/slide10.xml"]!);
    expect(text(shape(conforming, 3))).toBe("Areas verified as conforming");
    expect(text(conforming)).not.toMatch(/good practices|positive observations/i);
    for (const id of [5, 6, 8, 9]) expect(shape(conforming, id)).toBeUndefined();
  });
});
