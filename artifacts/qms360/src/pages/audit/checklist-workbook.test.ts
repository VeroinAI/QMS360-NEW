import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { ChecklistItem } from "@workspace/api-client-react";
import { checklistHeaders, createChecklistWorkbook, isChecklistWorkbook, parseChecklistWorkbook } from "./checklist-workbook";

describe("Audit Checklist Excel template", () => {
  const areas = [
    { value: "AREA-1", label: "Construction" },
    { value: "AREA-2", label: "QMS" },
  ];
  it("includes active Audit Areas and native dropdowns on every import row", async () => {
    const workbook = await createChecklistWorkbook(areas);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    const sheet = reopened.getWorksheet("Checklist")!;
    const lists = reopened.getWorksheet("Dropdown Values")!;
    expect(isChecklistWorkbook(new Uint8Array(bytes).buffer as ArrayBuffer)).toBe(true);
    expect(sheet.getRow(1).values?.slice(1, 6)).toEqual([...checklistHeaders]);
    expect(sheet.getCell("F1").value).toBe("Item ID");
    expect(sheet.getCell("B2").dataValidation.formulae).toEqual(["ChecklistAuditAreas"]);
    expect(sheet.getCell("E501").dataValidation.formulae).toEqual(["ChecklistFindings"]);
    expect(sheet.getCell("B2").dataValidation.showErrorMessage).toBe(true);
    expect(lists.state).toBe("veryHidden");
    expect(lists.getCell("A2").value).toBe("Construction");
    expect(lists.getCell("A3").value).toBe("QMS");
    expect(lists.getCell("B6").value).toBe("Not applicable");
    expect(sheet.getColumn(6).hidden).toBe(true);
    expect(() => parseChecklistWorkbook(new Uint8Array(bytes).buffer as ArrayBuffer, areas)).toThrow(/no checklist items/);
    sheet.getRow(2).values = ["9.2", "Construction", "Are records complete?", "Checked", "OFI"];
    const filled = await reopened.xlsx.writeBuffer();
    expect(parseChecklistWorkbook(new Uint8Array(filled).buffer as ArrayBuffer, areas)).toEqual([
      { clause: "9.2", auditArea: "AREA-1", question: "Are records complete?", description: "Checked", auditFinding: "OFI" },
    ]);
  });

  it("extracts existing rows by name and ID so uploading updates them without losing their evidence", async () => {
    const existing: ChecklistItem[] = [{
      id: "original-id", clause: "4.1", auditArea: "AREA-2", question: "Existing question",
      description: "Original description", auditFinding: "Minor NC", evidenceIds: ["stored-file"],
    }];
    const workbook = await createChecklistWorkbook(areas, existing);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    const sheet = reopened.getWorksheet("Checklist")!;
    expect(sheet.getCell("B2").value).toBe("QMS");
    expect(sheet.getCell("F2").value).toBe("original-id");
    expect(sheet.getCell("F3").value).toBeNull();
    expect(sheet.getCell("B3").dataValidation.formulae).toEqual(["ChecklistAuditAreas"]);
    sheet.getCell("C2").value = "Edited question";
    sheet.getRow(3).values = ["5", "Construction", "New question"];
    const loaded = parseChecklistWorkbook(new Uint8Array(await reopened.xlsx.writeBuffer()).buffer as ArrayBuffer, areas, existing);
    expect(loaded).toEqual([
      { id: "original-id", clause: "4.1", auditArea: "AREA-2", question: "Edited question", description: "Original description", auditFinding: "Minor NC" },
      { clause: "5", auditArea: "AREA-1", question: "New question", description: "" },
    ]);
  });

  it("keeps unchanged incomplete historical rows in the export without blocking new rows", async () => {
    const legacy: ChecklistItem[] = [{
      id: "old-id", clause: "", question: "Old question", notes: "Earlier notes", result: "Observation",
    }];
    const workbook = await createChecklistWorkbook(areas, legacy);
    const sheet = workbook.getWorksheet("Checklist")!;
    expect(sheet.getCell("B2").value).toBe("");
    expect(sheet.getCell("E2").value).toBe("Observation");
    expect(sheet.getCell("F2").value).toBe("old-id");
    sheet.getRow(3).values = ["9.2", "Construction", "New question"];
    const bytes = await workbook.xlsx.writeBuffer();
    expect(parseChecklistWorkbook(new Uint8Array(bytes).buffer as ArrayBuffer, areas, legacy)).toEqual([
      { clause: "9.2", auditArea: "AREA-1", question: "New question", description: "" },
    ]);
    sheet.getCell("C2").value = "Edited old question";
    const editedBytes = await workbook.xlsx.writeBuffer();
    expect(() => parseChecklistWorkbook(new Uint8Array(editedBytes).buffer as ArrayBuffer, areas, legacy)).toThrow(/Row 2.*Audit Area/);
  });

  it("accepts older value-based templates but rejects invalid pasted choices and foreign IDs", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...checklistHeaders],
      ["9.2", "AREA-1", "Are records available?", "Reviewed", "Major NC"],
      ["10", "AREA-2", "Are actions tracked?", "", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Checklist");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(parseChecklistWorkbook(bytes, areas)).toEqual([
      { clause: "9.2", auditArea: "AREA-1", question: "Are records available?", description: "Reviewed", auditFinding: "Major NC" },
      { clause: "10", auditArea: "AREA-2", question: "Are actions tracked?", description: "" },
    ]);
    sheet.B3.v = "Unlisted Area";
    const invalid = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(() => parseChecklistWorkbook(invalid, areas)).toThrow(/Row 3.*Audit Area/);
    sheet.B3.v = "AREA-2";
    sheet.E2.v = "Wrong finding";
    expect(() => parseChecklistWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer, areas)).toThrow(/Row 2.*Audit Findings/);
    sheet.E2.v = "Major NC";
    sheet.F1 = { t: "s", v: "Item ID" };
    sheet.F2 = { t: "s", v: "foreign-id" };
    sheet["!ref"] = "A1:F3";
    expect(() => parseChecklistWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer, areas)).toThrow(/Row 2.*Item ID/);
  });

  it("distinguishes a renamed Checklist workbook from an unrelated evidence spreadsheet", () => {
    const unrelated = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(unrelated, XLSX.utils.aoa_to_sheet([["Report", "Result"], ["A", "Pass"]]), "Results");
    const bytes = XLSX.write(unrelated, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(isChecklistWorkbook(bytes)).toBe(false);
    const renamed = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(renamed, XLSX.utils.aoa_to_sheet([[...checklistHeaders, "Item ID"], ["1", "Area", "Question"]]), "Checklist");
    expect(isChecklistWorkbook(XLSX.write(renamed, { type: "array", bookType: "xlsx" }) as ArrayBuffer)).toBe(true);
  });
});