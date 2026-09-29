import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { checklistHeaders, createChecklistWorkbook, parseChecklistWorkbook } from "./checklist-workbook";

describe("Audit Checklist Excel template", () => {
  it("includes active Audit Areas and native dropdowns on every import row", async () => {
    const workbook = await createChecklistWorkbook(["Construction", "QMS"]);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    const sheet = reopened.getWorksheet("Checklist")!;
    const lists = reopened.getWorksheet("Dropdown Values")!;
    expect(sheet.getRow(1).values?.slice(1)).toEqual([...checklistHeaders]);
    expect(sheet.getCell("B2").dataValidation.formulae).toEqual(["ChecklistAuditAreas"]);
    expect(sheet.getCell("E501").dataValidation.formulae).toEqual(["ChecklistFindings"]);
    expect(sheet.getCell("B2").dataValidation.showErrorMessage).toBe(true);
    expect(lists.state).toBe("veryHidden");
    expect(lists.getCell("A2").value).toBe("Construction");
    expect(lists.getCell("A3").value).toBe("QMS");
    expect(lists.getCell("B6").value).toBe("Not applicable");
    expect(() => parseChecklistWorkbook(new Uint8Array(bytes).buffer as ArrayBuffer, ["Construction", "QMS"])).toThrow(/no checklist items/);
    sheet.getRow(2).values = ["9.2", "Construction", "Are records complete?", "Checked", "OFI"];
    const filled = await reopened.xlsx.writeBuffer();
    expect(parseChecklistWorkbook(new Uint8Array(filled).buffer as ArrayBuffer, ["Construction", "QMS"])).toEqual([
      { clause: "9.2", auditArea: "Construction", question: "Are records complete?", description: "Checked", auditFinding: "OFI" },
    ]);
  });

  it("parses valid rows and rejects invalid pasted dropdown values before upload", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...checklistHeaders],
      ["9.2", "Construction", "Are records available?", "Reviewed", "Major NC"],
      ["10", "QMS", "Are actions tracked?", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Checklist");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(parseChecklistWorkbook(bytes, ["Construction", "QMS"])).toEqual([
      { clause: "9.2", auditArea: "Construction", question: "Are records available?", description: "Reviewed", auditFinding: "Major NC" },
      { clause: "10", auditArea: "QMS", question: "Are actions tracked?" },
    ]);
    sheet.B3.v = "Unlisted Area";
    const invalid = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(() => parseChecklistWorkbook(invalid, ["Construction", "QMS"])).toThrow(/Row 3.*Audit Area/);
    sheet.B3.v = "QMS";
    sheet.E2.v = "Wrong finding";
    expect(() => parseChecklistWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer, ["Construction", "QMS"])).toThrow(/Row 2.*Audit Findings/);
  });
});