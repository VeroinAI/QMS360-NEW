import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSpreadsheetDate } from "@workspace/spreadsheet-dates";
import { applyExcelDateFormats } from "./excel-date-cells";

function reopen(book: XLSX.WorkBook) {
  const bytes = XLSX.write(applyExcelDateFormats(book), { type: "buffer", bookType: "xlsx", sheetStubs: true });
  return XLSX.read(bytes, { type: "buffer", cellNF: true, sheetStubs: true });
}

describe("Excel native date cell formats", () => {
  it("writes real date numbers with fixed DD/MM/YYYY display and styled blank entry cells", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["From Date (DD/MM/YYYY)", "To Date (DD/MM/YYYY)", "Remarks", "Count"],
      ["01/02/2027", "05/02/2027", "01/02/2027", 5],
    ]), "Dates");
    const sheet = reopen(book).Sheets.Dates;
    expect(sheet.A2.t).toBe("n");
    expect(sheet.A2.z).toBe("dd/mm/yyyy");
    expect(sheet.A2.w).toBe("01/02/2027");
    expect(parseSpreadsheetDate(sheet.A2.v)).toBe("2027-02-01");
    expect(sheet.B2.w).toBe("05/02/2027");
    expect(sheet.A1001.z).toBe("dd/mm/yyyy");
    expect(sheet.A1001.t).toBe("z");
    expect(sheet.C2.t).toBe("s");
    expect(sheet.D2.v).toBe(5);
    expect(XLSX.utils.sheet_to_json(sheet)).toHaveLength(1);
  });
  it("formats flattened and overview date values, not date-like free text", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["Field", "Description", "Value"],
      ["meetings[1].lastDate", "", "04/05/2026"],
      ["narrative", "", "04/05/2026"],
      ["reportTo", "", ""],
    ]), "Report Data");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["Report", "Monthly"], ["Period", "01/05/2026"], ["Created at", "2026-05-04T10:30:00.000Z"],
    ]), "Report");
    const result = reopen(book);
    expect(result.Sheets["Report Data"].C2.z).toBe("dd/mm/yyyy");
    expect(result.Sheets["Report Data"].C2.w).toBe("04/05/2026");
    expect(result.Sheets["Report Data"].C3.t).toBe("s");
    expect(result.Sheets["Report Data"].C4.t).toBe("z");
    expect(result.Sheets.Report.B2.z).toBe("dd/mm/yyyy");
    expect(result.Sheets.Report.B3.w).toBe("04/05/2026");
  });
  it("leaves template instructions and partial month filters unchanged", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Period", "Set the period in the app."]]), "Instructions");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Filters", ""], ["fromMonth", "2026-05"]]), "Filters");
    const result = reopen(book);
    expect(result.Sheets.Instructions.B1.v).toBe("Set the period in the app.");
    expect(result.Sheets.Filters.B2.v).toBe("2026-05");
  });
  it("preserves a 1904 workbook's native calendar date", () => {
    const book = XLSX.utils.book_new();
    book.Workbook = { WBProps: { date1904: true } };
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Date"], [0]]), "Dates");
    const result = reopen(book);
    expect(result.Sheets.Dates.A2.v).toBe(0);
    expect(result.Sheets.Dates.A2.z).toBe("dd/mm/yyyy");
    expect(parseSpreadsheetDate(result.Sheets.Dates.A2.v, { date1904: true })).toBe("1904-01-01");
  });
});