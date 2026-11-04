import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { CAR_UNMAPPED, renderCarWordReport } from "../src/lib/car-word-report";
import { carReportDate } from "../src/lib/car-word-report-data";
import sharp from "sharp";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
describe("CAR Word template fidelity", () => {
  it("retains every original package part except populated document content", async () => {
    const original = unzipSync(await readFile(new URL("../src/assets/car-report-template.docx", import.meta.url)));
    const result = unzipSync(await renderCarWordReport({
      auditor: "Auditor", recipient: "Action Taker", date: "05/10/2026", auditReference: "AUD-001",
      rootCause: "Missing controls & checks <required>\nSecond line",
      correction: "Correction", correctiveAction: "Recorded action", risk: "medium",
      accepted: true, completed: true, withinAcd: false,
    }));
    expect(Object.keys(result).sort()).toEqual(Object.keys(original).sort());
    for (const name of Object.keys(original).filter(name => name !== "word/document.xml")) {
      expect(Buffer.from(result[name]!)).toEqual(Buffer.from(original[name]!));
    }
    const xml = strFromU8(result["word/document.xml"]!);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const text = Array.from(doc.getElementsByTagNameNS(W, "t")).map(t => t.textContent).join("\n");
    expect(text).toContain("Missing controls & checks <required>");
    expect(text).toContain("Second line");
    for (const value of ["Auditor", "Action Taker", "05/10/2026", "AUD-001", "Correction", "Recorded action", CAR_UNMAPPED]) {
      expect(text).toContain(value);
    }
    expect(doc.getElementsByTagNameNS(W, "sdt").length).toBe(0);
    expect(text).not.toMatch(/Click.*enter|Choose an item/);
    expect(text.match(/☒/g)).toHaveLength(5); // Quality, Medium, Accepted, Outside ACD, Completed
    // Original geometry, borders, fill colours and row/page layout are unchanged.
    const sourceDoc = new DOMParser().parseFromString(strFromU8(original["word/document.xml"]!), "application/xml");
    for (const tag of ["tblPr", "tblGrid", "tcPr", "trPr", "sectPr"]) {
      expect(Array.from(doc.getElementsByTagNameNS(W, tag)).map(node => node.toString()))
        .toEqual(Array.from(sourceDoc.getElementsByTagNameNS(W, tag)).map(node => node.toString()));
    }
  });
  it("fills unavailable data and signature fields without making up dates or approvals", async () => {
    const result = unzipSync(await renderCarWordReport({}));
    const doc = new DOMParser().parseFromString(strFromU8(result["word/document.xml"]!), "application/xml");
    const text = Array.from(doc.getElementsByTagNameNS(W, "t")).map(t => t.textContent).join("\n");
    expect(text.match(/To be mapped/g)).toHaveLength(34); // 24 text controls + six signatures + four unknown indicators
    expect(text.match(/☒/g)).toHaveLength(1); // Quality only
    expect(text).not.toMatch(/Click.*enter|Choose an item/);
  });
  it("formats stored calendar dates without local-time conversion", () => {
    expect(carReportDate("2026-10-05")).toBe("05/10/2026");
    expect(carReportDate("2026-10-05T23:59:00Z")).toBe("05/10/2026");
    expect(carReportDate(null)).toBeNull();
    expect(carReportDate("unknown")).toBeNull();
  });
  it("embeds three bounded signatures with valid relationships and preserves original package artwork and table geometry", async () => {
    const png = await sharp({ create: { width: 400, height: 80, channels: 4, background: "#142a88" } }).png().toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    const original = unzipSync(await readFile(new URL("../src/assets/car-report-template.docx", import.meta.url)));
    const output = unzipSync(await renderCarWordReport({ originatorSignature: png, recipientSignature: webp,
      originatorDate: "01/10/2026", recipientDate: "06/10/2026", accepted: true, withinAcd: true, completed: true }));
    const changed = new Set(["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"]);
    for (const name of Object.keys(original).filter(name => !changed.has(name))) expect(output[name]).toEqual(original[name]);
    expect(Object.keys(output).filter(name => !original[name])).toEqual([
      "word/media/car-signature-1.png", "word/media/car-signature-2.png", "word/media/car-signature-3.png",
    ]);
    const parser = new DOMParser(), document = parser.parseFromString(strFromU8(output["word/document.xml"]!), "application/xml");
    const source = parser.parseFromString(strFromU8(original["word/document.xml"]!), "application/xml");
    for (const tag of ["tblPr", "tblGrid", "tcPr", "trPr", "sectPr"]) {
      expect(Array.from(document.getElementsByTagNameNS(W, tag)).map(n => n.toString()))
        .toEqual(Array.from(source.getElementsByTagNameNS(W, tag)).map(n => n.toString()));
    }
    const rels = parser.parseFromString(strFromU8(output["word/_rels/document.xml.rels"]!), "application/xml");
    const originalRels = parser.parseFromString(strFromU8(original["word/_rels/document.xml.rels"]!), "application/xml");
    for (const rel of Array.from(originalRels.getElementsByTagName("Relationship"))) {
      expect(Array.from(rels.getElementsByTagName("Relationship")).find(n => n.getAttribute("Id") === rel.getAttribute("Id"))?.toString()).toBe(rel.toString());
    }
    const drawings = Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "docPr"));
    expect(new Set(drawings.map(n => n.getAttribute("id"))).size).toBe(drawings.length);
    const allDrawingIds = Object.entries(output).filter(([name]) => name.startsWith("word/") && name.endsWith(".xml"))
      .flatMap(([, bytes]) => Array.from(parser.parseFromString(strFromU8(bytes), "application/xml")
        .getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "docPr")).map(n => n.getAttribute("id")));
    expect(new Set(allDrawingIds).size).toBe(allDrawingIds.length);
    const blips = Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip"));
    expect(blips).toHaveLength(3);
    for (const blip of blips) {
      const id = blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
      const rel = Array.from(rels.getElementsByTagName("Relationship")).find(n => n.getAttribute("Id") === id)!;
      expect(rel.getAttribute("TargetMode")).not.toBe("External");
      expect((await sharp(output[`word/${rel.getAttribute("Target")}`]).metadata()).format).toBe("png");
    }
    const cells = Array.from(document.getElementsByTagNameNS(W, "tc"));
    const signedCells = cells.filter(c => c.getElementsByTagNameNS(W, "drawing").length);
    expect(signedCells).toHaveLength(3);
    expect(signedCells.map(c => c.textContent)).toEqual(["", "", ""]);
    const text = Array.from(document.getElementsByTagNameNS(W, "t")).map(n => n.textContent).join("\n");
    expect(text).toContain("01/10/2026"); expect(text).toContain("06/10/2026");
    for (const extent of Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "extent"))) {
      expect(Number(extent.getAttribute("cx"))).toBeLessThanOrEqual(1_400_000);
      expect(Number(extent.getAttribute("cy"))).toBeLessThanOrEqual(220_000);
    }
  });
  it("uses the exact placeholder for corrupt signature bytes rather than broken drawings", async () => {
    const result = unzipSync(await renderCarWordReport({ originatorSignature: new Uint8Array([1, 2, 3]) }));
    expect(Object.keys(result).some(name => name.includes("car-signature"))).toBe(false);
    expect(strFromU8(result["word/document.xml"]!)).toContain(CAR_UNMAPPED);
  });
});
