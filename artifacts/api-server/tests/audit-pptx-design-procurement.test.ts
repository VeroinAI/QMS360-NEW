import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { designProcurementPages } from "../src/lib/audit-pptx-design-procurement-layout";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main", P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const fixture = (design = 7, procurement = 8, comment = "okay") => ({
  audit: { title: "Recorded audit", additionalDocuments: {
    designStatus: Array.from({ length: design }, (_, i) => ({ label: `Design status ${i}`, value: i + 1 })),
    procurementStatus: Array.from({ length: procurement }, (_, i) => ({ label: `Procurement item ${i}`, value: i + 1 })),
    designRemarks: comment, procurementRemarks: comment,
  } },
  legacyFindings: [], cars: [], evidence: [], names: new Map<string, string>(), roleNames: new Map<string, string>(),
});
const sections = (input = fixture()) => buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true });
const sectionSlides = (files: Record<string, Uint8Array>) => Object.entries(files)
  .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(([, bytes]) => parse(bytes))
  .filter(doc => Array.from(doc.getElementsByTagNameNS(A, "t")).some(node => node.textContent === "Design and procurement status"));
const text = (node: ReturnType<typeof parse>) => Array.from(node.getElementsByTagNameNS(A, "t")).map(node => node.textContent).join("");

describe("Dynamic Design and procurement status slide", () => {
  it("keeps the reported eight-row design table, its total, procurement and comments on one slide", async () => {
    const input = fixture(), before = JSON.stringify(input), data = sections(input);
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const slides = sectionSlides(files);
    expect(slides).toHaveLength(1);
    const tables = Array.from(slides[0]!.getElementsByTagNameNS(A, "tbl"));
    expect(tables.map(table => table.getElementsByTagNameNS(A, "tr").length)).toEqual([9, 9]);
    expect(text(slides[0]!)).toContain("Total submittals28100%");
    expect(text(slides[0]!).match(/Comment: okay/g)).toHaveLength(2);
    expect(text(slides[0]!)).not.toContain(" — continued");
    const boxes = Array.from(slides[0]!.getElementsByTagNameNS(P, "sp")).filter(shape =>
      ["Shape 8", "Shape 11"].includes(shape.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name") ?? ""));
    expect(boxes).toHaveLength(2);
    const transforms = boxes.map(box => box.getElementsByTagNameNS(A, "xfrm")[0]!);
    expect(transforms[0]!.getElementsByTagNameNS(A, "off")[0]!.getAttribute("y"))
      .toEqual(transforms[1]!.getElementsByTagNameNS(A, "off")[0]!.getAttribute("y"));
    for (const box of boxes) expect(box.getElementsByTagNameNS(A, "prstGeom")[0]?.getAttribute("prst")).toBe("roundRect");
    expect(JSON.stringify(input)).toBe(before);
    if (process.env.QMS_DESIGN_VISUAL === "1") {
      await mkdir("../../generated-artifacts/audit-design-procurement", { recursive: true });
      await writeFile("../../generated-artifacts/audit-design-procurement/normal.pptx",
        await renderConsolidatedAuditPptx({ sections: data }));
    }
  });

  it("keeps Design and Procurement in their original panels on matching continuation slides", () => {
    const rows = [Array.from({ length: 16 }, (_, i) => [`Design ${i}`, "1", "1%"]), [["Procurement", "1"]]];
    const pages = designProcurementPages(rows, ["Comment: okay", "Comment: okay"], "");
    expect(pages).toHaveLength(2);
    expect(pages.flat().every(fragment => fragment.section === fragment.column)).toBe(true);
    for (const page of pages) expect(page[0]!.commentY).toEqual(page[1]!.commentY);
    expect(pages.flat().flatMap(fragment => fragment.entries).filter(entry => entry.kind === "row")).toHaveLength(17);
  });

  it("expands the padded comment boxes to retain longer comments without unnecessary continuation", () => {
    const remarks = "Actual recorded project progress. ".repeat(12);
    const pages = designProcurementPages([[["Status", "1", "100%"]], [["Item", "1"]]],
      [`Comment: ${remarks}`, "Comment: okay"], "");
    expect(pages).toHaveLength(1);
    const fragment = pages[0]![0]!;
    expect(fragment.entries.filter(entry => entry.kind === "note").map(entry => entry.text).join(""))
      .toBe(`Comment: ${remarks}`);
    expect(fragment.commentY).toBeLessThan(4709160);
    expect(fragment.commentHeight).toBeGreaterThan(1325880);
  });

  it("keeps every row and long comment, with bounded, nonoverlapping fragments on genuinely full pages", async () => {
    const input = fixture(30, 23, "Recorded quality status and procurement follow-up. ".repeat(80));
    const report = sections(input).find(section => section.key === "design-procurement")!;
    const pages = designProcurementPages(report.tables.map(table => table.rows),
      ["Comment: " + input.audit.additionalDocuments.designRemarks, "Comment: " + input.audit.additionalDocuments.procurementRemarks], "");
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) for (const fragment of page) {
      expect(fragment.column).toBe(fragment.section);
      const bottom = fragment.y + 274320 + 91440 + (fragment.header ? 283464 : 0)
        + fragment.entries.filter(entry => entry.kind === "row" || entry.role === "check")
          .reduce((sum, entry) => sum + entry.height, 0)
        + (fragment.entries.some(entry => entry.kind === "note" && entry.role === "check") ? 91440 : 0);
      expect(bottom).toBeLessThanOrEqual(fragment.commentY);
      expect(fragment.commentY + fragment.commentHeight).toBe(6035040);
      expect(fragment.entries.filter(entry => entry.kind === "note" && entry.role === "comment")
        .reduce((sum, entry) => sum + entry.height, 0) + 2 * 109728).toBeLessThanOrEqual(fragment.commentHeight);
    }
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: sections(input) }));
    const slides = sectionSlides(files), allText = slides.map(text).join("");
    for (let i = 0; i < 30; i++) expect(allText).toContain(`Design status ${i}`);
    for (let i = 0; i < 23; i++) expect(allText).toContain(`Procurement item ${i}`);
    // Continuation titles can interrupt a sentence between slides; compare the
    // comment text boxes alone to confirm every saved word is retained.
    const noteShapes = slides.flatMap(doc => Array.from(doc.getElementsByTagNameNS(P, "sp")));
    // Each independent column can continue mid-sentence. Reassemble each
    // section separately rather than interleaving Design and Procurement.
    for (const name of ["Text 9", "Text 12"]) {
      const notes = noteShapes.filter(shape =>
        shape.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name") === name)
        .map(shape => Array.from(shape.getElementsByTagNameNS(A, "t")).map(node => node.textContent).join("")).join("");
      expect(notes).toContain(input.audit.additionalDocuments.designRemarks);
      expect(notes.match(/Recorded quality status and procurement follow-up\./g)).toHaveLength(80);
    }
    for (const doc of slides) {
      const ids = Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).map(node => node.getAttribute("id"));
      expect(new Set(ids).size).toBe(ids.length);
      for (const row of Array.from(doc.getElementsByTagNameNS(A, "tr"))) {
        const budget = Number(row.getAttribute("h"));
        for (const cell of Array.from(row.getElementsByTagNameNS(A, "tc")))
          expect(cell.getElementsByTagNameNS(A, "p").length * 177800 + 73152).toBeLessThanOrEqual(budget);
      }
    }
    const original = unzipSync(await readFile(new URL("../src/assets/audit-report-template.pptx", import.meta.url)));
    expect(files["ppt/theme/theme1.xml"]).toEqual(original["ppt/theme/theme1.xml"]);
    if (process.env.QMS_DESIGN_VISUAL === "1")
      await writeFile("../../generated-artifacts/audit-design-procurement/continuations.pptx",
        await renderConsolidatedAuditPptx({ sections: sections(input) }));
  });
});
