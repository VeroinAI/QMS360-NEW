import { DATE_FORMATS, detectSpreadsheetDateOptions, getDateFormat, type DateFormat, type SpreadsheetDateOptions } from '@workspace/spreadsheet-dates';

/** Format explicitly annotated in a header like "From Date (MM/DD/YYYY)"; never guessed from values. */
export function explicitHeaderDateFormat(headers: readonly string[]): DateFormat | undefined {
  for (const header of headers) {
    const match = /\(([^)]+)\)\s*$/.exec(String(header).trim());
    const found = (DATE_FORMATS as readonly string[]).find((f) => f === match?.[1]?.trim().toUpperCase());
    if (found) return found as DateFormat;
  }
  return undefined;
}

export function importDateOptions(headers: readonly string[], base: SpreadsheetDateOptions = {}): SpreadsheetDateOptions & { dateFormat: DateFormat } {
  return detectSpreadsheetDateOptions([...headers], base) as SpreadsheetDateOptions & { dateFormat: DateFormat };
}

export const dateImportError = (label: string, format: DateFormat = getDateFormat()) =>
  `${label} must be a valid calendar date in ${format} format.`;
