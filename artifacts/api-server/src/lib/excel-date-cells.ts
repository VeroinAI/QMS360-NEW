import * as XLSX from "xlsx";
import { excelDateNumberFormat, excelDateValue, formatSpreadsheetDate, parseSpreadsheetDate, isSpreadsheetDateField } from "@workspace/spreadsheet-dates";

const isDateHeading = (value: unknown) => typeof value === "string"
  && (isSpreadsheetDateField(value) || /\(DD\/MM\/YYYY\)/i.test(value));

/** Set real Excel dates and explicit custom formats, never touching free text.
 * Supports date columns, Field/Value reports, and label/value overview sheets.
 */
export function applyExcelDateFormats(workbook: XLSX.WorkBook): XLSX.WorkBook {
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  for (const name of workbook.SheetNames) {
    if (name === "Instructions") continue;
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) =>
      sheet[XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + index })]?.v);
    const dateColumns = headers.flatMap((header, index) => isDateHeading(header) ? [range.s.c + index] : []);
    const fieldIndex = headers.indexOf("Field");
    const valueIndex = headers.indexOf("Value");
    const fieldColumn = fieldIndex < 0 ? range.s.c : range.s.c + fieldIndex;
    const valueColumn = valueIndex < 0 ? range.s.c + 1 : range.s.c + valueIndex;
    const formatCell = (row: number, column: number) => {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address];
      if (cell?.f) {
        cell.z = excelDateNumberFormat;
        return;
      }
      const raw = cell?.v;
      if (raw !== undefined && raw !== null && raw !== ""
        && !parseSpreadsheetDate(typeof raw === "number" ? raw : formatSpreadsheetDate(raw), { date1904 })) return;
      const value = excelDateValue(raw, { date1904 });
      if (!value) {
        // Real blank stubs retain the style without becoming fake dates or rows.
        sheet[address] = { t: "z", z: excelDateNumberFormat };
        return;
      }
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
      const serial = (value.getTime() - epoch) / 86_400_000
        + (!date1904 && value.getTime() >= Date.UTC(1900, 2, 1) ? 1 : 0);
      sheet[address] = { t: "n", v: serial, z: excelDateNumberFormat };
    };
    // Include ready-to-use blank date cells, not just populated exports.
    const lastDateRow = dateColumns.length ? Math.max(range.e.r, 1000) : range.e.r;
    for (let row = range.s.r + 1; row <= lastDateRow; row += 1) {
      for (const column of dateColumns) formatCell(row, column);
      if (row <= range.e.r && isDateHeading(sheet[XLSX.utils.encode_cell({ r: row, c: fieldColumn })]?.v)) {
        formatCell(row, valueColumn);
      }
    }
    range.e.r = lastDateRow;
    sheet["!ref"] = XLSX.utils.encode_range(range);
  }
  return workbook;
}