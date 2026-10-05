import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { buildConsolidatedAuditReport, type ReportSectionData } from "../src/lib/audit-consolidated-report";
import { mappedText } from "../src/lib/audit-pptx-mapping";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (bytes: Uint8Array) => Array.from(parse(bytes).getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
const sections = () => buildConsolidatedAuditReport({
  audit: { title: "Real project <A> & B", status: "Complete", checklist: [
    { id: "nc-1", clientReference: "NC-001", auditArea: "Construction", description: "Recorded issue", auditFinding: "Major NC", clause: "8.5", notes: "Objective evidence" },
    { id: "ofi-1", clientReference: "OFI-001", auditArea: "Design", description: "Recorded improvement", auditFinding: "OFI", clause: "7.5" },
  ], reportDetails: { values: { client: "Actual client", overallRating: "Effective", overallConclusion: "Recorded [actual content]\nconclusion" }, rows: {} } },
  plan: { leadAuditorId: "auditor", auditTypes: ["Internal"], activities: [] },
  legacyFindings: [], cars: [], evidence: [], names: new Map([["auditor", "Recorded Auditor"]]), roleNames: new Map(),
});

describe("Original Audit PowerPoint report template", () => {
  it("preserves original masters, theme, branding, shape geometry and table formatting", async () => {
    const original = unzipSync(await readFile(new URL("../src/assets/audit-report-template.pptx", import.meta.url)));
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: sections() }));
    for (const name of Object.keys(original).filter(n => /^(ppt\/(slideMasters|slideLayouts|theme|media)|_rels\/)/.test(n))) {
      expect(Buffer.from(result[name]!)).toEqual(Buffer.from(original[name]!));
    }
    for (let slide = 1; slide <= 18; slide++) {
      const path = `ppt/slides/slide${slide}.xml`;
      const source = parse(original[path]!); const output = parse(result[path]!);
      for (const tag of ["xfrm", "tblPr", "tblGrid", "tcPr"]) {
        // Programme text boxes are intentionally widened/repositioned to fix overflow.
        if (slide === 5 && tag === "xfrm") continue;
        expect(Array.from(output.getElementsByTagNameNS(A, tag)).map(n => n.toString()))
          .toEqual(Array.from(source.getElementsByTagNameNS(A, tag)).map(n => n.toString()));
      }
    }
    const allText = Object.entries(result).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => text(b)).join("\n");
    for (const actual of ["Real project <A> & B", "Actual client", "Recorded [actual content]", "Recorded Auditor", "NC-001", "Recorded issue", "OFI-001", "Recorded improvement", "To be mapped"]) {
      expect(allText).toContain(actual);
    }
    expect(allText).not.toMatch(/Abdulkarim|Attaullah|Al-Zahrani|Tabarjal|QAM-IA-26-009|\[Project|\[What|Not recorded|To Be Mapped/);
    const count = parse(result["ppt/presentation.xml"]!).getElementsByTagNameNS(P, "sldId").length;
    expect(count).toBe(18);
  });
  it("continues every finding and CAR row on identically styled slides", async () => {
    const data = sections();
    data.find(s => s.key === "non-conformities")!.tables[0]!.rows =
      Array.from({ length: 13 }, (_, i) => [`NC-${i}`, "Area", `Finding ${i}`, "Evidence", "8.5", "Major"]);
    data.find(s => s.key === "corrective-actions")!.tables[0]!.rows =
      Array.from({ length: 9 }, (_, i) => [`NC-${i}`, "Major", `Cause ${i}`, "Correction", "Owner", "05/10/2026", "Open", "Not recorded"]);
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const allText = Object.entries(result).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => text(b)).join("\n");
    for (let i = 0; i < 13; i++) expect(allText).toContain(`Finding ${i}`);
    for (let i = 0; i < 9; i++) expect(allText).toContain(`Cause ${i}`);
    const doc = parse(result["ppt/presentation.xml"]!);
    const ids = Array.from(doc.getElementsByTagNameNS(P, "sldId"));
    expect(ids.length).toBeGreaterThan(18);
    expect(new Set(ids.map(n => n.getAttribute("id"))).size).toBe(ids.length);
    expect(new Set(ids.map(n => n.getAttributeNS(R, "id"))).size).toBe(ids.length);
    const rels = parse(result["ppt/_rels/presentation.xml.rels"]!);
    for (const rel of Array.from(rels.getElementsByTagName("Relationship"))) {
      if (rel.getAttribute("Type")?.endsWith("/slide")) expect(result[`ppt/${rel.getAttribute("Target")}`]).toBeTruthy();
    }
  });
  it("embeds each photograph with the real caption and refuses to silently omit unavailable files", async () => {
    const data = sections();
    const photos: ReportSectionData["photos"] = Array.from({ length: 3 }, (_, i) => ({
      id: `photo-${i}`, fileName: `evidence-${i}.png`, reference: `NC-${i}`,
      description: `Grade: Major\nDate captured: Not recorded\nDate uploaded: 05 Oct 2026\nLocation: Actual site\nDescription: Recorded photograph ${i}\nRequirement: 8.5`,
    }));
    data.find(s => s.key === "photographs")!.photos = photos;
    await expect(renderConsolidatedAuditPptx({ sections: data })).rejects.toThrow("Photograph could not be loaded");
    // Tiny PNG; the route normalizes real evidence via sharp before rendering.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=", "base64");
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: data, photos: new Map(photos.map(p => [p.id, png])) }));
    expect(Object.keys(result).filter(n => n.startsWith("ppt/media/audit-photo-"))).toHaveLength(3);
    const allText = Object.entries(result).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => text(b)).join("\n");
    for (let i = 0; i < 3; i++) expect(allText).toContain(`Recorded photograph ${i}`);
    expect(allText).toContain("Date: To be mapped");
    expect(allText).not.toContain("Date: 05 Oct 2026");
  });
  it("normalizes only missing values without substituting sample data", () => {
    expect([null, undefined, "", "Not recorded", "To Be Mapped"].map(mappedText)).toEqual(Array(5).fill("To be mapped"));
    expect(mappedText(0)).toBe("0");
    expect(mappedText("Not recorded; verifier Not recorded")).toBe("To be mapped; verifier To be mapped");
  });
  it("keeps programme dates and long details inside non-overlapping bounded boxes", async () => {
    const data = sections();
    const programme = data.find(s => s.key === "programme")!;
    const details = "A long activity description with important details that must be preserved in the downloaded report. ".repeat(15);
    programme.tables[0]!.rows = [[
      "2026-10-12T10:10:00.000Z (derived legacy)", "2026-10-12T10:10:00.000Z (derived legacy)",
      "Opening meeting", details, "Recorded Auditor / QA/QC Manager",
    ]];
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const docs = Object.entries(result).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map(([, bytes]) => parse(bytes)).filter(doc =>
        Array.from(doc.getElementsByTagNameNS(A, "t")).some(t => t.textContent === "Audit programme and participation"));
    expect(docs.length).toBeGreaterThan(1);
    const bodies: string[] = [];
    for (const doc of docs) {
      const shape = (id: number) => Array.from(doc.getElementsByTagNameNS(P, "sp")).find(s =>
        s.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === String(id))!;
      for (let i = 0; i < 5; i++) {
        const header = shape(10 + i * 3), body = shape(11 + i * 3);
        const box = (node: typeof header) => ({
          y: Number(node.getElementsByTagNameNS(A, "off")[0]!.getAttribute("y")),
          h: Number(node.getElementsByTagNameNS(A, "ext")[0]!.getAttribute("cy")),
        });
        expect(box(header).y + box(header).h).toBeLessThan(box(body).y);
        if (i < 4) expect(box(body).y + box(body).h).toBeLessThan(box(shape(13 + i * 3)).y);
        expect(body.getElementsByTagNameNS(A, "p").length).toBeLessThanOrEqual(3);
        expect(header.getElementsByTagNameNS(A, "p").length).toBeLessThanOrEqual(2);
        expect(body.getElementsByTagNameNS(A, "noAutofit").length).toBe(1);
        expect(body.getElementsByTagNameNS(A, "bodyPr")[0]!.getAttribute("wrap")).toBe("none");
        const lines = Array.from(body.getElementsByTagNameNS(A, "t")).map(t => t.textContent);
        if (!lines.includes("To be mapped")) bodies.push(...lines);
      }
      const headerText = Array.from(shape(10).getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
      expect(headerText).toContain("12 Oct 2026, 10:10");
      expect(headerText).not.toContain("T10:10:00.000Z");
    }
    const preserved = bodies.join(" ").replace(/\s+/g, " ");
    expect(preserved).toContain(details.trim());
    expect(preserved).toContain("Recorded Auditor / QA/QC Manager");
  });
});
