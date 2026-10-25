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
  plan: { leadAuditorId: "auditor", auditTypes: ["Internal"], activities: [], startDateTime: "2026-10-01", endDateTime: "2026-10-02" },
  legacyFindings: [], cars: [], evidence: [], names: new Map([["auditor", "Recorded Auditor"]]), roleNames: new Map(),
});

describe("Original Audit PowerPoint report template", () => {
  it.each([false, true])("derives missing closing attendees, never manual participation text (PPTX: %s)", pptxWorkbookMappings => {
    const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    const build = (openingMeeting?: unknown, closingMeeting?: unknown) => buildConsolidatedAuditReport({
      audit: { title: "Audit", openingMeeting, closingMeeting, reportDetails: { values: { notRepresented: "Example manager" }, rows: {} } },
      names: new Map([[a, "Same Name"], [b, "Same Name"]]), roleNames: new Map(), legacyFindings: [], cars: [], evidence: [], pptxWorkbookMappings,
    }).find(s => s.key === "programme")!.fields.find(f => f.label === "Not represented in Closing meeting")!.value;
    expect(build({ attendees: [a, b, b.toUpperCase(), "", "Legacy attendee"] }, { attendees: [a] })).toBe("Same Name, Legacy attendee");
    expect(build({ attendees: [a, b] }, { attendees: [a, b] })).toBe("None");
    expect(build({ attendees: [] }, { attendees: [] })).toBe("None");
    expect(build(undefined, { attendees: [] })).toBe(pptxWorkbookMappings ? "-" : "Not recorded");
    expect(build({ attendees: [a] }, undefined)).toBe(pptxWorkbookMappings ? "-" : "Not recorded");
    expect(build({ attendees: ["cccccccc-cccc-4ccc-cccc-cccccccccccc"] }, { attendees: [] })).toBe("Former Audit user");
  });
  it("continues real missing-attendee names under the exact card heading, preserving branding", async () => {
    const data = sections();
    const programme = data.find(s => s.key === "programme")!;
    const names = Array.from({ length: 30 }, (_, i) => `Recorded attendee ${String(i).padStart(2, "0")}`);
    programme.fields.find(f => f.label === "Not represented in Closing meeting")!.value = names.join("\n");
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const docs = Object.entries(result).filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .map(([, bytes]) => parse(bytes)).filter(doc => Array.from(doc.getElementsByTagNameNS(A, "t")).some(t => t.textContent === "Audit programme and participation"));
    expect(docs.length).toBeGreaterThan(1);
    let output = "";
    for (const doc of docs) {
      const shape = (id: number) => Array.from(doc.getElementsByTagNameNS(P, "sp")).find(s => s.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === String(id))!;
      const strings = (id: number) => Array.from(shape(id).getElementsByTagNameNS(A, "t")).map(t => t.textContent ?? "");
      expect(strings(37).join(" ")).toBe("Not represented in Closing meeting");
      expect(shape(38).getElementsByTagNameNS(A, "p").length).toBeLessThanOrEqual(4);
      output += strings(38).join(" ") + " ";
    }
    for (const name of names) expect(output).toContain(name);
    expect(output).not.toMatch(/Example|Project Manager/);
  });
  it.each([false, true])("keeps DrawingML paragraph children in schema order (continuations: %s)", async (continuations) => {
    const data = sections();
    data.find(s => s.key === "non-conformities")!.tables[0]!.rows =
      Array.from({ length: 13 }, (_, i) => [`NC-${i}`, "Area", `Finding ${i}`, "Evidence", "8.5", "Major"]);
    data.find(s => s.key === "corrective-actions")!.tables[0]!.rows =
      Array.from({ length: 9 }, (_, i) => [`NC-${i}`, "Major", `Cause ${i}`, "Correction", "Owner", "05/10/2026", "Open", "Not recorded"]);
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    let paragraphs = 0;
    for (const [path, bytes] of Object.entries(result)) {
      if (!path.endsWith(".xml")) continue;
      const doc = parse(bytes);
      for (const paragraph of Array.from(doc.getElementsByTagNameNS(A, "p"))) {
        paragraphs++;
        const children = Array.from(paragraph.childNodes).filter(n => n.nodeType === 1);
        const end = children.find(n => n.namespaceURI === A && n.localName === "endParaRPr");
        if (end) expect(children.at(-1), `${path}: endParaRPr must be the final paragraph child`).toBe(end);
        const props = children.find(n => n.namespaceURI === A && n.localName === "pPr");
        if (props) expect(children[0], `${path}: pPr must be the first paragraph child`).toBe(props);
      }
    }
    expect(paragraphs).toBeGreaterThan(100);
  });
  it("preserves original masters, theme, branding, shape geometry and table formatting", async () => {
    const original = unzipSync(await readFile(new URL("../src/assets/audit-report-template.pptx", import.meta.url)));
    const result = unzipSync(await renderConsolidatedAuditPptx({ sections: sections() }));
    for (const name of Object.keys(original).filter(n => /^(ppt\/(slideMasters|theme|media)|_rels\/)/.test(n))) {
      expect(Buffer.from(result[name]!)).toEqual(Buffer.from(original[name]!));
    }
    for (let slide = 1; slide <= 18; slide++) {
      const path = `ppt/slides/slide${slide}.xml`;
      const source = parse(original[path]!); const output = parse(result[path]!);
      for (const tag of ["xfrm", "tblPr", "tblGrid", "tcPr"]) {
        // Programme text boxes are intentionally widened/repositioned to fix overflow.
        if ([5, 7, 8, 10, 12, 13, 15].includes(slide) && tag === "xfrm") continue;
        const rendered = Array.from(output.getElementsByTagNameNS(A, tag)).map(n => n.toString());
        const originalParts = Array.from(source.getElementsByTagNameNS(A, tag)).map(n => n.toString());
        // CAR rows now follow the actual response count; retained rows keep the template styling.
        // OFI keeps cell styling, but explicitly top-aligns and pads actual rows.
        if (slide === 7 && tag === "tcPr") {
          // Summary body rows all use the body prototype; Total uses the branded final row.
          const cells = Array.from(source.getElementsByTagNameNS(A, "tr"));
          const cellProps = (index: number) => Array.from(cells[index]!.getElementsByTagNameNS(A, "tcPr")).map(n => n.toString());
          expect(rendered).toEqual([...cellProps(0), ...cellProps(2), ...cellProps(2), ...cellProps(cells.length - 1)]);
        } else if (slide === 12 && tag === "tcPr") {
          const normalize = (part: string) => part.replace(/marT="\d+"|marB="\d+"|anchor="[^"]+"/g, "");
          expect(rendered.map(normalize)).toEqual(originalParts.slice(0, rendered.length).map(normalize));
        } else expect(rendered).toEqual([8, 10, 13, 15].includes(slide) && tag === "tcPr" ? originalParts.slice(0, rendered.length) : originalParts);
      }
    }
    const allText = Object.entries(result).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => text(b)).join("\n");
    for (const actual of ["Real project <A> & B", "Actual client", "Recorded [actual content]", "Recorded Auditor", "NC-001", "Recorded issue", "OFI-001", "Recorded improvement", "To be mapped"]) {
      expect(allText.replace(/\n/g, "")).toContain(actual);
    }
    expect(allText).not.toMatch(/Abdulkarim|Attaullah|Al-Zahrani|Tabarjal|QAM-IA-26-009|\[Project|\[What|Not recorded|To Be Mapped/);
    const count = parse(result["ppt/presentation.xml"]!).getElementsByTagNameNS(P, "sldId").length;
    expect(count).toBe(18);
  });
  it("sizes the CAR slide to its actual rows and continues when responses exceed one slide", async () => {
    const data = sections();
    const tracker = data.find(section => section.key === "corrective-actions")!.tables[0]!;
    tracker.rows = [["CAR-001", "Major NC", "Cause", "Corrective action", "Owner", "24-10-2026", "Submitted", "Pending verification"]];
    const one = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const table = parse(one["ppt/slides/slide15.xml"]!).getElementsByTagNameNS(A, "tbl")[0]!;
    expect(table.getElementsByTagNameNS(A, "tr").length).toBe(2);
    expect(text(one["ppt/slides/slide15.xml"]!)).toContain("CAR-001");
    tracker.rows = Array.from({ length: 26 }, (_, i) => [
      `CAR-${String(i + 1).padStart(3, "0")}`, "Major NC", "Cause", "Corrective action",
      "Owner", "24-10-2026", "Submitted", "Pending verification",
    ]);
    const many = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const slideText = Object.entries(many).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(([, bytes]) => text(bytes)).join("\n");
    expect(slideText).toContain("CAR-026");
    expect(Object.keys(many).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length).toBeGreaterThan(18);
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
    const photoTargets: string[] = [];
    for (const [path, bytes] of Object.entries(result)) {
      if (!/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(path)) continue;
      const relationships = Array.from(parse(bytes).getElementsByTagName("Relationship"));
      const ids = relationships.map(r => r.getAttribute("Id"));
      expect(new Set(ids).size, `${path}: relationship IDs must be unique`).toBe(ids.length);
      photoTargets.push(...relationships.map(r => r.getAttribute("Target") ?? "")
        .filter(target => target.startsWith("../media/audit-photo-")));
    }
    // Continuations must clone the untouched template, not the first rendered
    // page with its photo references already attached.
    expect(photoTargets).toHaveLength(photos.length);
    expect(new Set(photoTargets).size).toBe(photos.length);
    const allText = Object.entries(result).filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => text(b)).join("\n");
    for (let i = 0; i < 3; i++) expect(allText).toContain(`Recorded photograph ${i}`);
    expect(allText).toContain("Date: -");
    expect(allText).not.toContain("Date: 05 Oct 2026");
  });
  it("normalizes only missing values without substituting sample data", () => {
    expect([null, undefined, "", "Not recorded", "To Be Mapped"].map(mappedText)).toEqual(["-", "-", "-", "-", "To be mapped"]);
    expect(mappedText(0)).toBe("0");
    expect(mappedText("Not recorded; verifier Not recorded")).toBe("Not recorded; verifier Not recorded");
  });
  it("keeps programme dates and long details inside non-overlapping bounded boxes", async () => {
    const data = sections();
    const programme = data.find(s => s.key === "programme")!;

    const details = "A long activity description with important details that must be preserved in the downloaded report. ".repeat(15);
    programme.tables[0]!.rows = [[
      "2026-10-12T10:10:00.000Z (derived legacy)", "2026-10-12T10:10:00.000Z (derived legacy)",
      details, "Hidden subactivity remarks", "Recorded Auditor / QA/QC Manager",
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
        if (!header || !body) continue;
        const box = (node: typeof header) => ({
          y: Number(node.getElementsByTagNameNS(A, "off")[0]!.getAttribute("y")),
          h: Number(node.getElementsByTagNameNS(A, "ext")[0]!.getAttribute("cy")),
        });
        expect(box(header).y + box(header).h).toBeLessThan(box(body).y);
        const next = i < 4 ? shape(13 + i * 3) : undefined;
        if (next) expect(box(body).y + box(body).h).toBeLessThan(box(next).y);
        expect(box(body).y + box(body).h).toBeLessThanOrEqual(6236208);
        expect(header.getElementsByTagNameNS(A, "p").length).toBeLessThanOrEqual(26);
        expect(body.getElementsByTagNameNS(A, "p").length).toBeLessThanOrEqual(2);
        expect(body.getElementsByTagNameNS(A, "noAutofit").length).toBe(1);
        expect(body.getElementsByTagNameNS(A, "bodyPr")[0]!.getAttribute("wrap")).toBe("none");
        const lines = Array.from(header.getElementsByTagNameNS(A, "t")).map(t => t.textContent);
        if (!lines.includes("To be mapped")) bodies.push(...lines);
      }
      const headerText = Array.from(shape(11).getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
      if (shape(9)) expect(headerText).toContain("12 Oct 2026, 10:10");
      else expect(headerText).toBe("");
      expect(headerText).not.toContain("T10:10:00.000Z");
    }
    const preserved = bodies.join(" ").replace(/\s+/g, " ");
    expect(preserved).toContain(details.trim());
    expect(preserved).not.toContain("Hidden subactivity remarks");
    expect(preserved).not.toContain("Recorded Auditor / QA/QC Manager");
  });
});
