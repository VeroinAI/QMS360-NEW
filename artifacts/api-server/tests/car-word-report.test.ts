import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { CAR_UNMAPPED, renderCarWordReport } from "../src/lib/car-word-report";
import { carReportDate } from "../src/lib/car-word-report-data";

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
});
