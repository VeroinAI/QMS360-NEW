export const spreadsheetDateFormat = "DD/MM/YYYY";
export const excelDateNumberFormat = "dd/mm/yyyy";
export type SpreadsheetDateOptions = { date1904?: boolean };

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 100 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Day-first text, native Excel serials and Dates become the existing ISO API date.
 * Legacy ISO text remains supported; slash dates are NEVER interpreted month-first.
 */
export function parseSpreadsheetDate(raw: unknown, options: SpreadsheetDateOptions = {}): string | null {
  if (raw instanceof Date) {
    return calendarDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === "number") {
    const days = Math.floor(raw);
    if (!Number.isFinite(raw) || days < (options.date1904 ? 0 : 1) || days > 2_958_465 || (!options.date1904 && days === 60)) return null;
    const epoch = options.date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const adjusted = options.date1904 ? days : days - (days > 60 ? 1 : 0);
    const date = new Date(epoch + adjusted * 86_400_000);
    return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(raw ?? "").trim();
  const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (dayFirst) return calendarDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return iso ? calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
}

/** Date-only spreadsheet display; never changes stored dates or application values. */
export function formatSpreadsheetDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const input = typeof raw === "string"
    ? raw.replace(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/, "$1")
    : raw;
  const iso = parseSpreadsheetDate(input);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : String(raw);
}

/** Native date value for XLSX writers; date text alone does not set Excel's cell format. */
export function excelDateValue(raw: unknown, options: SpreadsheetDateOptions = {}): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const iso = typeof raw === "number"
    ? parseSpreadsheetDate(raw, options)
    : parseSpreadsheetDate(formatSpreadsheetDate(raw));
  if (!iso) throw new Error("Cannot export an invalid Excel date");
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Recognize date fields, not arbitrary ISO-looking text in titles or remarks. */
export function isSpreadsheetDateField(field: string): boolean {
  const name = (field.split(".").at(-1) ?? field).replace(/\([^)]*\)/g, "").trim();
  const key = name.replace(/[\s_-]/g, "").toLowerCase();
  return /(?:At|_at|\sat)$/.test(name)
    || /^(?:dateof|datefrom|dateto)/.test(key)
    || /(?:Date|DateTime|Datetime|Timestamp|Period)$/.test(name)
    || /(?:^|[\s_-])(?:date|datetime|timestamp|period)$/i.test(name)
    || /^(?:start|end|due|from|to|last|next|birth|joining|submission|approval|review|survey|report|plannedstart|plannedend|lastmeeting|nextmeeting)date$/.test(key)
    || /^(?:created|updated|submitted|approved|reviewed|closed|completed|deleted|recorded|resolved|changed|due|breached|started|lastnotified|lastmodified|lastlogin|lastsync|lastrun|generated|synced)at$/.test(key)
    || /^(?:at|from|to|reportfrom|reportto|frommonth|tomonth|month|deadline)$/.test(key);
}

/** Recursively format only date-valued fields, without mutating the original data. */
export function formatSpreadsheetData<T>(value: T, field = ""): T {
  if (value instanceof Date) return formatSpreadsheetDate(value) as T;
  if (Array.isArray(value)) return value.map(item => formatSpreadsheetData(item, field)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, formatSpreadsheetData(item, key)])) as T;
  }
  return (isSpreadsheetDateField(field) && typeof value === "string" ? formatSpreadsheetDate(value) : value) as T;
}

/** Normalize date fields inside JSON spreadsheet cells before existing validation. */
export function parseSpreadsheetData<T>(value: T, options: SpreadsheetDateOptions = {}, field = ""): T {
  if (Array.isArray(value)) return value.map(item => parseSpreadsheetData(item, options, field)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseSpreadsheetData(item, options, key)])) as T;
  }
  if (isSpreadsheetDateField(field) && value !== "" && value !== null && value !== undefined) {
    const date = parseSpreadsheetDate(value, options);
    if (!date) throw new Error(`${field}: enter a valid date as DD/MM/YYYY`);
    return date as T;
  }
  return value;
}