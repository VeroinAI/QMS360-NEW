import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { auditPptxMappings, mappedText, PPTX_UNMAPPED } from "../src/lib/audit-pptx-mapping";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const text = (bytes: Uint8Array) => Array.from(new DOMParser()
  .parseFromString(strFromU8(bytes), "application/xml").getElementsByTagNameNS(A, "t"))
  .map(node => node.textContent).join("\n");
const fixture = () => ({
  audit: { title: "Recorded audit", checklist: [
    { id: "nc", auditFinding: "Minor NC", auditArea: "Civil" },
    { id: "ofi", auditFinding: "OFI" },
  ], additionalDocuments: { goodPractices: [{ areaProcess: "Civil" }] } },
   plan: { activities: [{ section: "Inspection", remarks: "Saved inspection subactivity\nSaved evidence check" }] },
  legacyFindings: [], cars: [{ findingId: "nc" }], evidence: [],
  names: new Map<string, string>(), roleNames: new Map<string, string>(),
});

describe("Audit PPTX mapping availability versus missing transaction data", () => {
  it("uses a dash for mapped blanks across every data slide; leaves only unsupported attachment confirmations unmapped", async () => {
    const data = buildConsolidatedAuditReport({ ...fixture(), pptxWorkbookMappings: true });
    const mapped = auditPptxMappings(data);
    for (const [slide, values] of mapped) {
      if (slide === 18) {
        expect(Object.values(values.shapes)).toEqual(Array(6).fill(PPTX_UNMAPPED));
        continue;
      }
      expect(Object.values(values.shapes).join("\n"), `slide ${slide}`).not.toContain(PPTX_UNMAPPED);
      expect(values.tables.flat(2).join("\n"), `slide ${slide}`).not.toContain(PPTX_UNMAPPED);
    }
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    for (const [path, bytes] of Object.entries(files)) {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(path)) continue;
      const content = text(bytes);
      if (path.endsWith("/slide18.xml")) expect(content).toContain(PPTX_UNMAPPED);
      else expect(content, path).not.toMatch(/to be mapped|not recorded|not numbered/i);
    }
    const layouts = Object.entries(files).filter(([path]) => /^ppt\/slideLayouts\/.*\.xml$/.test(path))
      .map(([, bytes]) => text(bytes)).join("\n");
    expect(layouts).not.toContain("[Audit Ref]");
    expect(layouts).toContain("Report No: -");
    expect(mapped.get(11)!.tables[0]![0]![0]).toBe("-");
    expect(mapped.get(15)!.tables[0]![0]![0]).toBe("-");
    expect(mapped.get(3)!.shapes[25]).toBe("-");
  });

  it("reserves unmapped for missing source definitions, not a missing value in an existing field", () => {
    const sections = buildConsolidatedAuditReport({ ...fixture(), pptxWorkbookMappings: true });
    const scope = sections.find(section => section.key === "scope")!;
    scope.fields.find(field => field.label === "Objective")!.value = "";
    expect(auditPptxMappings(sections).get(4)!.shapes[6]).toBe("-");
    scope.fields = scope.fields.filter(field => field.label !== "Objective");
    expect(auditPptxMappings(sections).get(4)!.shapes[6]).toBe(PPTX_UNMAPPED);
  });

  it("preserves zero, false, literal prose and evidence filenames containing placeholder wording", async () => {
    expect(mappedText(0)).toBe("0");
    expect(mappedText(false)).toBe("false");
    expect(mappedText(" \t ")).toBe("-");
    const description = "IT said To be mapped; Not recorded is a source note.";
    const fileName = "Evidence - To Be Mapped - Not recorded.pdf";
    expect(mappedText(description)).toBe(description);
    expect(mappedText(fileName)).toBe(fileName);
    const source = fixture();
    const input = { ...source, audit: { ...source.audit, checklist: [
      { id: "nc", auditFinding: "Minor NC", description, evidenceIds: ["file"] },
    ] }, evidence: [{ id: "file", fileName, mimeType: "application/pdf" }] };
    const files = unzipSync(await renderConsolidatedAuditPptx({
      sections: buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true }),
    }));
    const ncr = text(files["ppt/slides/slide11.xml"]!).replaceAll("\n", "");
    expect(ncr).toContain(description);
    expect(ncr).toContain(fileName);
  });

  it("does not change saved data or the existing PDF/JSON missing-data convention", () => {
    const input = fixture(), before = JSON.stringify(input);
    const other = buildConsolidatedAuditReport(input);
    buildConsolidatedAuditReport({ ...input, pptxWorkbookMappings: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(buildConsolidatedAuditReport(input)).toEqual(other);
    expect(other.find(section => section.key === "programme")!.tables[0]!.rows[0]![3])
      .toBe(input.plan.activities[0]!.remarks);
    expect(other.find(section => section.key === "scope")!.fields[0]!.value).toBe("Not recorded");
  });
});
