import { readFile, mkdir, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { auditPptxMappings } from "../src/lib/audit-pptx-mapping";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const nodes = (node: Document | Element, ns: string, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const contents = (row: Element) => nodes(row, A, "tc").map(cell => nodes(cell, A, "t").map(t => t.textContent).join(""));
const fixture = (areas: string[], themes = 0) => buildConsolidatedAuditReport({
  audit: { title: "Saved audit", checklist: areas.map((auditArea, i) => ({
    id: `row-${i}`, auditArea, auditFinding: ["Major NC", "Moderate NC", "Minor NC", "OFI", ""][i % 5],
  })), reportDetails: { values: {}, rows: {
    recurringThemes: Array.from({ length: themes }, (_, i) => ({ theme: `Saved theme ${i}`, indication: `Cause ${i}`, references: `REF-${i}` })),
  } } },
  legacyFindings: [], cars: [], evidence: [], names: new Map(), roleNames: new Map(), pptxWorkbookMappings: true,
});

function summaryDocs(files: Record<string, Uint8Array>) {
  const rels = nodes(parse(files["ppt/_rels/presentation.xml.rels"]!), R.replace("officeDocument/2006/relationships", "package/2006/relationships"), "Relationship");
  return nodes(parse(files["ppt/presentation.xml"]!), P, "sldId").map(id => {
    const target = rels.find(rel => rel.getAttribute("Id") === id.getAttributeNS(R, "id"))!.getAttribute("Target")!;
    return parse(files[`ppt/${target}`]!);
  }).filter(doc => nodes(doc, A, "t").some(t => t.textContent === "Findings summary by audit area"));
}

function assertPackage(files: Record<string, Uint8Array>) {
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.endsWith(".rels")) continue;
    const rels = Array.from(parse(bytes).getElementsByTagName("Relationship"));
    expect(new Set(rels.map(rel => rel.getAttribute("Id"))).size, path).toBe(rels.length);
    for (const rel of rels) {
      if (rel.getAttribute("TargetMode") === "External") continue;
      const target = rel.getAttribute("Target")!;
      const base = path === "_rels/.rels" ? "" : posix.dirname(posix.dirname(path));
      const resolved = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(base, target));
      expect(files[resolved], `${path}: ${target}`).toBeTruthy();
    }
  }
  const overrides = Array.from(parse(files["[Content_Types].xml"]!).getElementsByTagName("Override"));
  for (const override of overrides) expect(files[override.getAttribute("PartName")!.slice(1)]).toBeTruthy();
  for (const path of Object.keys(files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))) {
    expect(overrides.some(o => o.getAttribute("PartName") === `/${path}`), path).toBe(true);
    const doc = parse(files[path]!);
    for (const p of nodes(doc, A, "p")) {
      const children = Array.from(p.childNodes).filter(n => n.nodeType === 1);
      const end = children.find(n => n.localName === "endParaRPr");
      if (end) expect(children.at(-1), path).toBe(end);
      const props = children.find(n => n.localName === "pPr") as Element | undefined;
      if (props) {
        expect(children[0]).toBe(props);
        const order = ["lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip", "tabLst", "defRPr", "extLst"];
        const positions = Array.from(props.childNodes).filter(n => n.nodeType === 1).map(n => order.indexOf(n.localName!)).filter(i => i >= 0);
        expect(positions, path).toEqual([...positions].sort((a, b) => a - b));
      }
    }
  }
}

describe("Findings-by-audit-area exported summary", () => {
  it.each([
    ["screenshot six-area case", 6, 0, [7]],
    ["one area", 1, 0, [2]],
    ["empty audit", 0, 0, [1]],
    ["Total fits exactly", 8, 0, [9]],
    ["areas fill exact capacity", 9, 0, [9, 1]],
    ["two full pages including Total", 17, 0, [9, 9]],
    ["multiple pages", 24, 0, [9, 9, 7]],
    ["theme-only continuations", 1, 10, [2, 0, 0, 0]],
    ["independent table and theme pagination", 9, 10, [9, 1, 0, 0]],
  ] as const)("%s contains only saved areas and one final styled Total", async (_label, count, themes, sizes) => {
    const data = fixture(Array.from({ length: count }, (_, i) => `Saved area ${i + 1}`), themes);
    const expected = auditPptxMappings(data).get(7)!.tables[0]!;
    const bytes = await renderConsolidatedAuditPptx({ sections: data });
    const files = unzipSync(bytes);
    const docs = summaryDocs(files);
    const original = unzipSync(await readFile(new URL("../src/assets/audit-report-template.pptx", import.meta.url)));
    const templateRows = nodes(parse(original["ppt/slides/slide7.xml"]!), A, "tr");
    expect(docs.map(doc => Math.max(0, nodes(doc, A, "tr").length - 1))).toEqual(sizes);
    const rendered: string[][] = [];
    for (const doc of docs) {
      const table = nodes(doc, A, "tbl")[0];
      if (!table) {
        expect(nodes(doc, P, "graphicFrame")).toHaveLength(0);
        continue;
      }
      const rows = nodes(table, A, "tr");
      expect(contents(rows[0]!)).toEqual(contents(templateRows[0]!));
      for (const row of rows.slice(1)) {
        const cells = contents(row);
        const index = rendered.length;
        expect(cells).toEqual(expected[index]);
        expect(cells).not.toContain("-");
        expect(cells).not.toContain("To be mapped");
        const isTotal = index === expected.length - 1;
        const prototype = isTotal ? templateRows.at(-1)! : templateRows[2]!;
        expect(nodes(row, A, "tcPr").map(n => n.toString())).toEqual(nodes(prototype, A, "tcPr").map(n => n.toString()));
        const cellsInRow = nodes(row, A, "tc");
        expect(nodes(cellsInRow[0]!, A, "rPr")[0]!.toString()).toBe(nodes(prototype, A, "rPr")[0]!.toString());
        for (const run of nodes(row, A, "rPr")) {
          expect(run.getAttribute("sz")).toBe("1200");
          expect(run.getAttribute("i")).not.toBe("1");
        }
        if (isTotal) expect(row).toBe(rows.at(-1));
        rendered.push(cells);
      }
      const frame = nodes(doc, P, "graphicFrame")[0]!;
      const top = Number(nodes(frame, A, "off")[0]!.getAttribute("y"));
      const height = Number(nodes(frame, A, "ext")[0]!.getAttribute("cy"));
      expect(height).toBe(rows.reduce((sum, row) => sum + Number(row.getAttribute("h")), 0));
      expect(top + height).toBeLessThanOrEqual(6035040);
      expect(Number(nodes(frame, A, "off")[0]!.getAttribute("x")) + Number(nodes(frame, A, "ext")[0]!.getAttribute("cx"))).toBeLessThan(7863840);
    }
    expect(rendered).toEqual(expected);
    expect(rendered.filter(row => row[0] === "Total")).toHaveLength(1);
    expect(rendered.at(-1)?.slice(1).every(cell => /^\d+$/.test(cell))).toBe(true);
    if (!count) expect(rendered).toEqual([["Total", "0", "0", "0", "0", "0"]]);
    assertPackage(files);
    // Optional local export fixtures for office rendering; excluded from source control.
    if (process.env.AUDIT_SUMMARY_FIXTURES && [6, 24].includes(count) && !themes) {
      await mkdir("../../generated-artifacts/audit-summary", { recursive: true });
      await writeFile(`../../generated-artifacts/audit-summary/summary-${count}.pptx`, bytes);
    }
  });

  it("keeps the screenshot's saved classification counts, including zeros", async () => {
    const data = fixture([]);
    const summary = data.find(s => s.key === "findings-summary")!;
    summary.tables[0]!.rows = [
      ["Project management and organization", "0", "1", "1", "0", "0", "2"],
      ["Design and engineering", "2", "0", "0", "0", "0", "2"],
      ["QMS and documentation", "0", "3", "1", "0", "0", "4"],
      ["Storage and material control", "0", "0", "0", "1", "0", "1"],
      ["Construction and site works", "2", "1", "0", "2", "0", "5"],
      ["Testing and commissioning", "1", "0", "0", "1", "0", "2"],
      ["Total", "5", "5", "2", "4", "0", "16"],
    ];
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const rows = nodes(summaryDocs(files)[0]!, A, "tr").slice(1).map(contents);
    expect(rows).toEqual(summary.tables[0]!.rows.map(r => [r[0], r[1], r[2], r[3], r[4], r[6]]));
    expect(rows.at(-1)).toEqual(["Total", "5", "5", "2", "4", "16"]);
  });

  it("preserves long names in taller rows without repeating entries or their counts", async () => {
    const longName = "Design and engineering — " + "Wide WWW process documentation, ".repeat(9);
    const data = fixture([longName, ...Array.from({ length: 10 }, (_, i) => `Area ${i}`)]);
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const docs = summaryDocs(files);
    const rows = docs.flatMap(doc => nodes(doc, A, "tr").slice(1));
    expect(rows).toHaveLength(12);
    expect(contents(rows[0]!)[0]!.replaceAll("\n", "")).toBe(longName);
    expect(contents(rows[0]!).slice(1)).toEqual(["1", "0", "0", "0", "1"]);
    expect(Number(rows[0]!.getAttribute("h"))).toBeGreaterThan(457200);
    expect(contents(rows.at(-1)!)[0]).toBe("Total");
    for (const doc of docs) {
      const frame = nodes(doc, P, "graphicFrame")[0]!;
      expect(Number(nodes(frame, A, "off")[0]!.getAttribute("y")) + Number(nodes(frame, A, "ext")[0]!.getAttribute("cy"))).toBeLessThanOrEqual(6035040);
    }
    assertPackage(files);
  });

  it("does not treat a genuine audit area named Total as the grand Total", async () => {
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: fixture(["Total"]) }));
    const rows = nodes(summaryDocs(files)[0]!, A, "tr").slice(1);
    expect(rows.map(contents)).toEqual([["Total", "1", "0", "0", "0", "1"], ["Total", "1", "0", "0", "0", "1"]]);
    expect(nodes(rows[0]!, A, "tcPr")[0]!.toString()).not.toContain("F3EEFA");
    expect(nodes(rows[1]!, A, "tcPr")[0]!.toString()).toContain("F3EEFA");
  });
});
