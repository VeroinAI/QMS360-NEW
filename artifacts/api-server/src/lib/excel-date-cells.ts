import * as XLSX from "xlsx";
import { getDateFormat, getExcelDateNumberFormat, detectSpreadsheetDateOptions, excelDateValue, formatSpreadsheetDate, parseSpreadsheetDate, isSpreadsheetDateField } from "@workspace/spreadsheet-dates";
const dateOptionsCache = new WeakMap<XLSX.WorkBook, { organizationFormat: string; options: ReturnType<typeof detectSpreadsheetDateOptions> }>();

const isDateHeading = (value: unknown) => typeof value === "string"
  && (isSpreadsheetDateField(value) || /\(DD\/MM\/YYYY\)/i.test(value));

/** Set real Excel dates and explicit custom formats, never touching free text.
 * Supports date columns, Field/Value reports, and label/value overview sheets.
 */
export function applyExcelDateFormats(workbook: XLSX.WorkBook): XLSX.WorkBook {
  dateOptionsCache.delete(workbook);
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  for (const name of workbook.SheetNames) {
    const cells = workbook.Sheets[name];
    if (cells?.["!ref"]) {
      const bounds = XLSX.utils.decode_range(cells["!ref"]);
      for (let row = bounds.s.r; row <= bounds.e.r; row++) for (let column = bounds.s.c; column <= bounds.e.c; column++) {
        const cell = cells[XLSX.utils.encode_cell({ r: row, c: column })];
        if (typeof cell?.v === "string" && (name === "Instructions" || row === bounds.s.r || isSpreadsheetDateField(cell.v))) {
          cell.v = cell.v.replace(/DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD|DD-MM-YYYY|MM-DD-YYYY/g, getDateFormat());
        }
      }
    }
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
        cell.z = getExcelDateNumberFormat();
        return;
      }
      const raw = cell?.v;
      if (raw !== undefined && raw !== null && raw !== ""
        && !parseSpreadsheetDate(typeof raw === "number" ? raw : formatSpreadsheetDate(raw), { date1904 })) return;
      const value = excelDateValue(raw, { date1904 });
      if (!value) {
        // Real blank stubs retain the style without becoming fake dates or rows.
        sheet[address] = { t: "z", z: getExcelDateNumberFormat() };
        return;
      }
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
      const serial = (value.getTime() - epoch) / 86_400_000
        + (!date1904 && value.getTime() >= Date.UTC(1900, 2, 1) ? 1 : 0);
      sheet[address] = { t: "n", v: serial, z: getExcelDateNumberFormat() };
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

export function spreadsheetWorkbookDateOptions(workbook: XLSX.WorkBook) {
  const cached = dateOptionsCache.get(workbook);
  if (cached?.organizationFormat === getDateFormat()) return cached.options;
  const declarations: unknown[] = [];
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" });
    if (name === "Instructions") declarations.push(rows);
    else {
      declarations.push(rows[0] ?? []);
      declarations.push(rows.flat().filter(value => typeof value === "string" && isSpreadsheetDateField(value)));
    }
  }
  const options = detectSpreadsheetDateOptions(declarations, { date1904: !!workbook.Workbook?.WBProps?.date1904 });
  dateOptionsCache.set(workbook, { organizationFormat: getDateFormat(), options });
  return options;
}