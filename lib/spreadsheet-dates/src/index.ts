export const spreadsheetDateFormat = "DD/MM/YYYY";
export const excelDateNumberFormat = "dd/mm/yyyy";
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "MM-DD-YYYY"] as const;
export type DateFormat = typeof DATE_FORMATS[number];
export type SpreadsheetDateOptions = { date1904?: boolean; dateFormat?: DateFormat };
let dateFormatResolver: () => DateFormat = () => "DD/MM/YYYY";
/** Browser: authenticated organization preference. Server: request-local resolver. */
export function setDateFormatResolver(resolver: () => DateFormat) { dateFormatResolver = resolver; }
export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === "string" && DATE_FORMATS.includes(value as DateFormat);
}
export function getDateFormat(): DateFormat { return dateFormatResolver(); }
export function getExcelDateNumberFormat(format: DateFormat = getDateFormat()): string { return format.toLowerCase(); }
export function normalizeSpreadsheetDateHeader(value: unknown): string {
  return String(value ?? "").replace(/DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD|DD-MM-YYYY|MM-DD-YYYY/gi, "DD/MM/YYYY");
}
/** Explicit workbook declarations override the current setting for legacy files.
 * Unlabelled slash dates use the selected setting; conflicting declarations fail.
 */
export function detectSpreadsheetDateOptions(values: unknown[], options: SpreadsheetDateOptions = {}): SpreadsheetDateOptions {
  const found = new Set<DateFormat>();
  for (const value of values.flat(Infinity)) {
    if (typeof value !== "string") continue;
    const matches = value.toUpperCase().match(/DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD|DD-MM-YYYY|MM-DD-YYYY/g) ?? [];
    for (const match of matches) if (isDateFormat(match)) found.add(match);
  }
  if (found.size > 1) throw new Error("The workbook declares conflicting date formats. Use one date format throughout the file.");
  return { ...options, dateFormat: found.size ? [...found][0] : options.dateFormat ?? getDateFormat() };
}

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 100 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Organization-formatted text, native Excel serials and Dates become ISO API dates.
 * Unambiguous legacy ISO remains supported. Never guess another slash-date order.
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
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const format = options.dateFormat ?? getDateFormat();
  const parts = (format.includes("/") ? /^(\d{2})\/(\d{2})\/(\d{4})$/ : /^(\d{2})-(\d{2})-(\d{4})$/).exec(text);
  if (!parts || format === "YYYY-MM-DD") return null;
  const monthFirst = format.startsWith("MM");
  return calendarDate(Number(parts[3]), Number(parts[monthFirst ? 1 : 2]), Number(parts[monthFirst ? 2 : 1]));
}

/** Date-only spreadsheet display; never changes stored dates or application values. */
export function formatSpreadsheetDate(raw: unknown, format: DateFormat = getDateFormat()): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const input = typeof raw === "string"
    ? raw.replace(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/, "$1")
    : raw;
  const iso = parseSpreadsheetDate(input, { dateFormat: format });
  return iso ? format.replace("YYYY", iso.slice(0, 4)).replace("MM", iso.slice(5, 7)).replace("DD", iso.slice(8, 10)) : String(raw);
}
/** Date-only values are calendar days; actual timestamps keep the display timezone.
 * Planned wall-clock timestamps must pass their date portion explicitly.
 */
export function formatDate(raw: unknown, format: DateFormat = getDateFormat()): string {
  if (raw instanceof Date || (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw))) {
    const date = new Date(raw as Date | string);
    if (!Number.isFinite(date.getTime())) return String(raw);
    const day = calendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return day ? formatSpreadsheetDate(day, format) : String(raw);
  }
  return formatSpreadsheetDate(raw, format);
}
export function formatDateInTimeZone(raw: unknown, timeZone: string, format: DateFormat = getDateFormat()): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const date = new Date(raw as string | number | Date);
  if (!Number.isFinite(date.getTime())) return String(raw);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  return formatDate(`${part("year")}-${part("month")}-${part("day")}`, format);
}
export function formatDateTime(raw: unknown, format: DateFormat = getDateFormat(), timeZone?: string): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const date = new Date(raw as string | number | Date);
  if (!Number.isFinite(date.getTime())) return String(raw);
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  return `${formatDate(`${part("year")}-${part("month")}-${part("day")}`, format)} ${part("hour")}:${part("minute")}:${part("second")}`;
}

/** Native date value for XLSX writers; date text alone does not set Excel's cell format. */
export function excelDateValue(raw: unknown, options: SpreadsheetDateOptions = {}): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const iso = typeof raw === "number"
    ? parseSpreadsheetDate(raw, options)
    : parseSpreadsheetDate(formatSpreadsheetDate(raw, options.dateFormat), options);
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

/** PDF/Word presentation keeps the time on timestamp fields, unlike date-only Excel cells. */
export function formatPresentationData<T>(value: T, field = ""): T {
  if (Array.isArray(value)) return value.map(item => formatPresentationData(item, field)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, formatPresentationData(item, key)])) as T;
  }
  if (value instanceof Date || (isSpreadsheetDateField(field) && typeof value === "string")) {
    if (typeof value === "string" && /^(?:from|to|startDateTime|endDateTime|plannedStartDateTime|plannedEndDateTime)$/i.test(field)
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && parseSpreadsheetDate(value.slice(0, 10))) {
      return `${formatDate(value.slice(0, 10))} ${value.slice(11).replace(/(?:Z|[+-]\d{2}:\d{2})$/, "")}` as T;
    }
    const timestamp = /(?:At|DateTime|Datetime|Timestamp|[\s_]at)$/i.test(field);
    return (timestamp && (value instanceof Date || String(value).includes("T"))
      ? formatDateTime(value) : formatDate(value)) as T;
  }
  return value;
}

/** Normalize date fields inside JSON spreadsheet cells before existing validation. */
export function parseSpreadsheetData<T>(value: T, options: SpreadsheetDateOptions = {}, field = ""): T {
  if (Array.isArray(value)) return value.map(item => parseSpreadsheetData(item, options, field)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseSpreadsheetData(item, options, key)])) as T;
  }
  if (isSpreadsheetDateField(field) && value !== "" && value !== null && value !== undefined) {
    const date = parseSpreadsheetDate(value, options);
    if (!date) throw new Error(`${field}: enter a valid date as ${options.dateFormat ?? getDateFormat()}`);
    return date as T;
  }
  return value;
}