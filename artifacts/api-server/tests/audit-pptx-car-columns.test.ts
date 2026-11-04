import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { auditPptxMappings } from "../src/lib/audit-pptx-mapping";
import { CAR_HEADERS } from "../src/lib/audit-pptx-car-layout";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (node: Element) => Array.from(node.getElementsByTagNameNS(A, "t")).map(t => t.textContent ?? "").join("\n");
const cells = (row: Element) => Array.from(row.getElementsByTagNameNS(A, "tc")).map(text);
const fixture = (cars: Record<string, unknown>[]) => ({
  audit: { title: "Recorded Audit", checklist: [{ id: "item", findingId: "finding", auditFinding: "Major NC" }] },
  cars, legacyFindings: [], evidence: [], names: new Map([["owner", "Recorded owner"]]), roleNames: new Map<string, string>(),
});
const car = { findingId: "finding", carNumber: "CAR-2026-001", rootCause: "Recorded cause", correction: "Repair the joint",
  correctiveAction: "Revise the procedure", ownerId: "owner", dueDate: "2026-10-25", status: "Submitted" };

describe("Separate PowerPoint CAR response columns", () => {
  it.each([
    ["Repair the joint", "Revise the procedure"], ["Repair the joint", null],
    [null, "Revise the procedure"], ["  ", "\t"], [undefined, undefined],
  ])("maps each response independently (%s / %s), without changing PDF/JSON or records", async (correction, correctiveAction) => {
    const input = fixture([{ ...car, correction, correctiveAction }]);
    const before = JSON.stringify(input);
    const other = buildConsolidatedAuditReport(input).find(s => s.key === "corrective-actions")!.tables[0]!;
    expect(other.columns).toHaveLength(8);
    expect(other.columns[3]).toBe("Correction and corrective action");
    expect(other.rows[0]![3]).toBe([correction, correctiveAction].filter(Boolean).join("\n") || "Not recorded");
    const sections = buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true });
    const tracker = sections.find(s => s.key === "corrective-actions")!.tables[0]!;
    expect(tracker.columns).toEqual(CAR_HEADERS);
    const mapped = auditPptxMappings(sections).get(15)!.tables[0]![0]!;
    expect(mapped).toEqual(["CAR-2026-001", "Major", "Recorded cause", correction?.trim() || "-",
      correctiveAction?.trim() || "-", "Recorded owner", expect.any(String), "Submitted", "-"]);
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    const rows = Array.from(parse(files["ppt/slides/slide15.xml"]!).getElementsByTagNameNS(A, "tr"));
    expect(cells(rows[0]!).map(v => v.replaceAll("\n", "").trim())).toEqual(CAR_HEADERS);
    expect(cells(rows[1]!).map(v => v.replaceAll("\n", ""))).toEqual(mapped);
    expect(JSON.stringify(input)).toBe(before);
    expect(buildConsolidatedAuditReport(input).find(s => s.key === "corrective-actions")!.tables[0]).toEqual(other);
  });

  it("keeps the nine-column empty tracker free of sample responses", async () => {
    const sections = buildConsolidatedAuditReport({ ...fixture([]), pptxWorkbookMappings: true });
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    const doc = parse(files["ppt/slides/slide15.xml"]!);
    const rows = Array.from(doc.getElementsByTagNameNS(A, "tr"));
    expect(rows).toHaveLength(2);
    expect(cells(rows[1]!)).toEqual(["No CAR responses recorded", ...Array(8).fill("-")]);
    expect(doc.getElementsByTagNameNS(A, "gridCol")).toHaveLength(9);
  });

  it("preserves both complete long responses and downstream alignment on branded continuation slides", async () => {
    const correction = "Repair the recorded joint and inspect the actual work. ".repeat(55) + "CORRECTION-END";
    const correctiveAction = "Revise the saved control procedure. ".repeat(65) + "W".repeat(180) + "ACTION-END";
    const sections = buildConsolidatedAuditReport({ ...fixture([
      { ...car, correction, correctiveAction },
      { ...car, carNumber: "CAR-2026-002", correction: "Second repair", correctiveAction: "Second action", ownerId: "Second owner", status: "Closed" },
    ]), pptxWorkbookMappings: true });
    const buffer = await renderConsolidatedAuditPptx({ sections });
    if (process.env.QMS_PPTX_LAYOUT_PREVIEW === "1") await writeFile("/tmp/audit-car-columns.pptx", buffer);
    const files = unzipSync(buffer);
    const docs = Object.entries(files).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map(([, bytes]) => parse(bytes)).filter(doc => Array.from(doc.getElementsByTagNameNS(A, "t")).some(t => t.textContent === "Corrective action tracker"));
    expect(docs.length).toBeGreaterThan(2);
    const retained = ["", ""];
    let second = 0;
    for (const doc of docs) {
      const table = doc.getElementsByTagNameNS(A, "tbl")[0]!;
      const widths = Array.from(table.getElementsByTagNameNS(A, "gridCol")).map(col => Number(col.getAttribute("w")));
      expect(widths).toHaveLength(9);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(11091672);
      const rows = Array.from(table.getElementsByTagNameNS(A, "tr"));
      expect(cells(rows[0]!).map(v => v.replaceAll("\n", "").trim())).toEqual(CAR_HEADERS);
      let height = 0;
      for (const row of rows) {
        height += Number(row.getAttribute("h"));
        expect(cells(row)).toHaveLength(9);
        for (const cell of Array.from(row.getElementsByTagNameNS(A, "tc"))) {
          expect(cell.getElementsByTagNameNS(A, "p").length * 152400 + 73152).toBeLessThanOrEqual(Number(row.getAttribute("h")));
        }
      }
      expect(1463040 + height).toBeLessThanOrEqual(5815584);
      for (const row of rows.slice(1)) {
        const values = cells(row).map(v => v.replaceAll("\n", ""));
        if (values[0]!.startsWith("CAR-2026-001")) {
          retained[0] += values[3]; retained[1] += values[4];
          expect(values.slice(5)).toEqual(["Recorded owner", expect.any(String), "Submitted", "-"]);
        } else {
          second++;
          expect(values).toEqual(["CAR-2026-002", "Major", "Recorded cause", "Second repair", "Second action", "Second owner", expect.any(String), "Closed", "-"]);
        }
      }
    }
    expect(retained).toEqual([correction, correctiveAction]);
    expect(second).toBe(1);
    // Every internal relationship must resolve; IDs and DrawingML ordering must
    // remain valid even when tracker pages clone the pristine original parts.
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith(".rels")) {
        const rels = Array.from(parse(bytes).getElementsByTagName("Relationship"));
        expect(new Set(rels.map(r => r.getAttribute("Id"))).size).toBe(rels.length);
        for (const rel of rels.filter(r => r.getAttribute("TargetMode") !== "External")) {
          const target = rel.getAttribute("Target")!.split("#")[0]!;
          const base = path.posix.dirname(name).replace(/(?:^|\/)_rels$/, "");
          expect(files[path.posix.normalize(path.posix.join(base, target))], `${name}: ${target}`).toBeTruthy();
        }
      }
      if (!name.endsWith(".xml")) continue;
      for (const p of Array.from(parse(bytes).getElementsByTagNameNS(A, "p"))) {
        const children = Array.from(p.childNodes).filter(n => n.nodeType === 1);
        const end = children.find(n => n.localName === "endParaRPr");
        if (end) expect(children.at(-1)).toBe(end);
        const props = children.find(n => n.localName === "pPr");
        if (props) expect(children[0]).toBe(props);
      }
    }
  });

  it("keeps endpoint register overrides aligned with the separate response columns", async () => {
    const source = await readFile(new URL("../src/routes/audit.ts", import.meta.url), "utf8");
    const route = source.split('router.get("/audits/:id/report/pptx"')[1]!.split("const images =")[0]!;
    expect(route).toContain("row[3] = car.correction?.trim()");
    expect(route).toContain("row[4] = car.correctiveAction?.trim()");
    expect(route).toContain('if (row[5] === "Not recorded"');
    expect(route).toContain('row[6] = car.extensionStatus === "approved"');
    expect(route).toContain("row[7] = carDto(car).status");
    expect(route).toContain("row[8] = meta.reviewedAt");
  });
});
