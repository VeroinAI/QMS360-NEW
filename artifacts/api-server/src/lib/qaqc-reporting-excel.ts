import * as XLSX from "xlsx";
import { applyExcelDateFormats, spreadsheetWorkbookDateOptions } from "./excel-date-cells";
import { getDateFormat, normalizeSpreadsheetDateHeader, parseSpreadsheetDate, parseSpreadsheetData, type SpreadsheetDateOptions } from "@workspace/spreadsheet-dates";

export type ReportingType = "monthly" | "daily" | "csat";
export type ReportingProjectOption = { id: string; name: string; code: string; costCentre?: string | null };
export type ReportingWorkbookError = { sheet: string; row: number; field: string; message: string };

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
const TYPE_FIELDS: Record<ReportingType, Array<[string, string, string]>> = {
  monthly: [
    ["noUpdates", "No updates this month?", "boolean"],
    ["pqpStatus", "PQP status", "text"], ["pqpOther", "Other PQP status", "text"],
    ["pqpSubmittedDate", "PQP submission date (DD/MM/YYYY)", "date"],
    ["pqpApprovedDate", "PQP approval date (DD/MM/YYYY)", "date"],
    ["reportReference", "Last report reference", "text"], ["reportFrom", "Report from date (DD/MM/YYYY)", "date"],
    ["reportTo", "Report to date (DD/MM/YYYY)", "date"],
    ["meetings", "Meetings (JSON array; each entry has type,lastDate,nextDate)", "json"],
    ["internalAudit", "Internal audit (JSON object: conducted,lastDate,nextDate)", "json"],
    ["manpower", "Manpower (JSON array: department,count,approvalRequired,approved,rejected)", "json"],
    ["metrics", "Metrics (JSON object: external_ncr,internal_ncr,rfi,rmi with issued,closed,ageing)", "json"],
    ["material", "Material inspection (JSON object)", "json"], ["qtbt", "QTBT (JSON object)", "json"],
    ["documents", "Document status (JSON object with drawings and submittals)", "json"],
    ["qmsReports", "QMS reports (JSON array)", "json"], ["narrative", "Final quality assessment", "text"],
  ],
  daily: [
    ["noUpdates", "No updates today?", "boolean"], ["disciplines", "Discipline status (JSON object)", "json"],
    ["revisions", "Approved status by revision (JSON object)", "json"],
    ["documentTypes", "Document types (JSON object)", "json"], ["pending", "Pending documents (JSON object)", "json"],
    ["correspondence", "Correspondence (JSON object: incoming,outgoing)", "json"],
  ],
  csat: [
    ["ratings", "Ratings (JSON object: quality,timeline,communication,professionalism,valueForMoney,issueHandling)", "json"],
    ["expectations", "Met expectations (Yes, No, or Partially)", "text"],
    ["recommend", "Would recommend (Yes, No, or Partially)", "text"],
    ["satisfactoryAspects", "Most satisfactory aspects", "text"],
    ["improvementSuggestions", "Improvement suggestions", "text"], ["comments", "Additional comments", "text"],
  ],
};
const DYNAMIC_SHEETS: Record<ReportingType, string[]> = {
  monthly: ["Meetings", "Manpower", "NCR Ageing", "QMS Reports"],
  daily: ["Revisions"],
  csat: [],
};

function validType(value: string): value is ReportingType {
  return value === "monthly" || value === "daily" || value === "csat";
}

function workbookBuffer(base64: string) {
  if (typeof base64 !== "string" || base64.length > Math.ceil(MAX_WORKBOOK_BYTES * 4 / 3) + 8
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Workbook must be a valid base64-encoded .xlsx file under 8 MB");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_WORKBOOK_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Workbook must be a valid .xlsx file under 8 MB");
  }
  return bytes;
}

function parseCell(raw: unknown, kind: string, dateOptions: SpreadsheetDateOptions = {}) {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (kind === "json") {
    return parseSpreadsheetData(typeof raw === "string" ? JSON.parse(raw) : raw, dateOptions);
  }
  if (kind === "boolean") {
    if (raw === true || raw === false) return raw;
    const value = String(raw).trim().toLowerCase();
    if (["yes", "true", "1"].includes(value)) return true;
    if (["no", "false", "0"].includes(value)) return false;
    throw new Error("Enter Yes or No");
  }
  if (kind === "date") {
    const date = parseSpreadsheetDate(raw, dateOptions);
    if (!date) throw new Error(`Enter a valid date as ${dateOptions.dateFormat ?? getDateFormat()}`);
    return date;
  }
  return String(raw).trim();
}

function deepSet(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function tableRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
  expectedHeaders: string[],
  errors: ReportingWorkbookError[],
) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const header = (rows[0] ?? []).map((value) => normalizeSpreadsheetDateHeader(String(value).trim()));
  if (expectedHeaders.some((expected, index) => header[index] !== expected)) {
    errors.push({ sheet: sheetName, row: 1, field: "header", message: `Expected columns: ${expectedHeaders.join(", ")}` });
    return [];
  }
  return rows.slice(1).map((row, index) => ({ row: row ?? [], rowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => value !== "" && value !== undefined && value !== null));
}

function requiredText(value: unknown, sheet: string, row: number, field: string, errors: ReportingWorkbookError[]) {
  const text = String(value ?? "").trim();
  if (!text) errors.push({ sheet, row, field, message: "Value is required" });
  return text;
}

function nonnegativeInteger(value: unknown, sheet: string, row: number, field: string, errors: ReportingWorkbookError[], positive = false) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < (positive ? 1 : 0)) {
    errors.push({ sheet, row, field, message: positive ? "Enter a positive whole number" : "Enter a nonnegative whole number" });
    return 0;
  }
  return value;
}

function readDynamicSheets(
  reportType: ReportingType,
  workbook: XLSX.WorkBook,
  data: Record<string, unknown>,
  errors: ReportingWorkbookError[],
  sourceRows: Map<string, { sheet: string; row: number }>,
) {
  if (reportType === "monthly") {
    const meetings: Array<Record<string, unknown>> = [];
    const meetingRows = tableRows(workbook, "Meetings", [
      "Type", "Last meeting date (DD/MM/YYYY)", "Next meeting date (DD/MM/YYYY)",
    ], errors);
    for (const { row, rowNumber } of meetingRows) {
      const type = requiredText(row[0], "Meetings", rowNumber, "Type", errors);
      if (!["Project Management Review Meeting", "Internal Meeting", "External Meeting", "Project Quality Meeting"].includes(type)) {
        errors.push({ sheet: "Meetings", row: rowNumber, field: "Type", message: "Select a supported meeting type" });
      }
      try {
        const dateOptions = spreadsheetWorkbookDateOptions(workbook);
        const lastDate = parseCell(row[1], "date", dateOptions);
        const nextDate = parseCell(row[2], "date", dateOptions);
        if (!lastDate) throw new Error("Last meeting date is required");
        if (!nextDate) throw new Error("Next meeting date is required");
        meetings.push({ type, lastDate, nextDate });
      } catch (error) {
        errors.push({ sheet: "Meetings", row: rowNumber, field: "dates", message: error instanceof Error ? error.message : "Dates are invalid" });
      }
      sourceRows.set("meetings", { sheet: "Meetings", row: rowNumber });
    }
    if (meetingRows.length) data.meetings = meetings;

    const manpower: Array<Record<string, unknown>> = [];
    const manpowerRows = tableRows(workbook, "Manpower", [
      "Department", "Headcount", "Client approval required (Yes/No)", "Approved", "Rejected",
    ], errors);
    for (const { row, rowNumber } of manpowerRows) {
      const department = requiredText(row[0], "Manpower", rowNumber, "Department", errors);
      const count = nonnegativeInteger(row[1], "Manpower", rowNumber, "Headcount", errors, true);
      let approvalRequired = false;
      try { approvalRequired = parseCell(row[2], "boolean") as boolean; } catch (error) {
        errors.push({ sheet: "Manpower", row: rowNumber, field: "Client approval required", message: error instanceof Error ? error.message : "Enter Yes or No" });
      }
      const approved = nonnegativeInteger(row[3], "Manpower", rowNumber, "Approved", errors);
      const rejected = nonnegativeInteger(row[4], "Manpower", rowNumber, "Rejected", errors);
      if (!approvalRequired && (approved !== 0 || rejected !== 0)) {
        errors.push({ sheet: "Manpower", row: rowNumber, field: "Approved / Rejected", message: "Both values must be zero when approval is not required" });
      }
      manpower.push({ department, count, approvalRequired, approved, rejected });
      sourceRows.set("manpower", { sheet: "Manpower", row: rowNumber });
    }
    if (manpowerRows.length) data.manpower = manpower;

    const ageing: Record<string, Array<Record<string, unknown>>> = { external_ncr: [], internal_ncr: [] };
    const ageingRows = tableRows(workbook, "NCR Ageing", [
      "Metric (external_ncr or internal_ncr)", "Department", "Ageing bucket (0-15, 15-45, over45)", "Count",
    ], errors);
    for (const { row, rowNumber } of ageingRows) {
      const metric = String(row[0] ?? "").trim();
      const department = requiredText(row[1], "NCR Ageing", rowNumber, "Department", errors);
      const bucket = String(row[2] ?? "").trim();
      if (!(metric in ageing)) errors.push({ sheet: "NCR Ageing", row: rowNumber, field: "Metric", message: "Select external_ncr or internal_ncr" });
      if (!["0-15", "15-45", "over45"].includes(bucket)) errors.push({ sheet: "NCR Ageing", row: rowNumber, field: "Ageing bucket", message: "Select 0-15, 15-45, or over45" });
      const count = nonnegativeInteger(row[3], "NCR Ageing", rowNumber, "Count", errors, true);
      if (metric in ageing) ageing[metric]!.push({ department, bucket, count });
      sourceRows.set("metrics", { sheet: "NCR Ageing", row: rowNumber });
    }
    if (ageingRows.length) {
      const metrics = (data.metrics && typeof data.metrics === "object" && !Array.isArray(data.metrics)
        ? data.metrics : {}) as Record<string, Record<string, unknown>>;
      for (const key of Object.keys(ageing)) {
        const current = metrics[key] && typeof metrics[key] === "object" ? metrics[key] as Record<string, unknown> : {};
        metrics[key] = { ...current, ageing: ageing[key] };
      }
      data.metrics = metrics;
    }

    const departments = ["HSSE", "Quality", "Finance", "Fleet & Facilities Management", "Human Resources", "Group Digital & Technology", "Operations"];
    const qmsReports: Array<Record<string, unknown>> = [];
    const qmsRows = tableRows(workbook, "QMS Reports", [
      "Department", "Type (Manual, Policy, SOP, Form)", "Document name", "Status", "Remarks",
    ], errors);
    for (const { row, rowNumber } of qmsRows) {
      const department = requiredText(row[0], "QMS Reports", rowNumber, "Department", errors);
      const type = requiredText(row[1], "QMS Reports", rowNumber, "Type", errors);
      const status = requiredText(row[3], "QMS Reports", rowNumber, "Status", errors);
      if (!departments.includes(department)) errors.push({ sheet: "QMS Reports", row: rowNumber, field: "Department", message: "Select a supported department" });
      if (!["Manual", "Policy", "SOP", "Form"].includes(type)) errors.push({ sheet: "QMS Reports", row: rowNumber, field: "Type", message: "Select Manual, Policy, SOP, or Form" });
      if (!["Under Review and Signature", "Approved", "Published"].includes(status)) errors.push({ sheet: "QMS Reports", row: rowNumber, field: "Status", message: "Select a supported QMS report status" });
      qmsReports.push({ department, type, documentName: String(row[2] ?? "").trim(), status, remarks: String(row[4] ?? "").trim() });
      sourceRows.set("qmsReports", { sheet: "QMS Reports", row: rowNumber });
    }
    if (qmsRows.length) data.qmsReports = qmsReports;
  } else if (reportType === "daily") {
    const revisions: Record<string, Array<Record<string, unknown>>> = { drawings: [], submittals: [] };
    const revisionRows = tableRows(workbook, "Revisions", [
      "Document type (Drawings or Submittals)", "Revision name (e.g. Rev 00)", "Approved status count",
    ], errors);
    for (const { row, rowNumber } of revisionRows) {
      const section = String(row[0] ?? "").trim();
      const name = requiredText(row[1], "Revisions", rowNumber, "Revision name", errors);
      if (section !== "Drawings" && section !== "Submittals") {
        errors.push({ sheet: "Revisions", row: rowNumber, field: "Document type", message: "Select Drawings or Submittals" });
      }
      const value = nonnegativeInteger(row[2], "Revisions", rowNumber, "Approved status count", errors);
      if (section === "Drawings" || section === "Submittals") revisions[section.toLowerCase()]!.push({ name, value });
      sourceRows.set("revisions", { sheet: "Revisions", row: rowNumber });
    }
    if (revisionRows.length) data.revisions = revisions;
  }
}

export function makeQaqcReportingTemplate(
  reportType: ReportingType,
  projects: ReportingProjectOption[] = [],
): Buffer {
  const workbook = XLSX.utils.book_new();
  const instructions = [
    ["QA/QC Reporting Import Template", "Complete the Values in the Report Data sheet, then upload for preview. Import never saves or submits."],
    ["Report type", reportType],
    ["Period", "Set the reporting period in the application before importing."],
    ["Date format", "DD/MM/YYYY. Use this format for all date cells and dates inside JSON values."],
    ["Project", "Choose a project in the application. Do not enter or edit a project UUID in this workbook."],
      ["Value format", "Use Yes/No for boolean fields. Dynamic meetings, manpower, ageing, QMS and revision entries have separate sheets."],
    ["", ""],
    ["Project code", "Project name", "Cost centre"],
    ...projects.map((project) => [project.code, project.name, project.costCentre ?? ""]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "Instructions");
  const rows: unknown[][] = [["Field", "Description", "Value"]];
  for (const [field, description] of TYPE_FIELDS[reportType]) rows.push([field, description, ""]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Report Data");
  if (reportType === "monthly") {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Type", "Last meeting date (DD/MM/YYYY)", "Next meeting date (DD/MM/YYYY)"],
    ]), "Meetings");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Department", "Headcount", "Client approval required (Yes/No)", "Approved", "Rejected"],
    ]), "Manpower");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Metric (external_ncr or internal_ncr)", "Department", "Ageing bucket (0-15, 15-45, over45)", "Count"],
    ]), "NCR Ageing");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Department", "Type (Manual, Policy, SOP, Form)", "Document name", "Status", "Remarks"],
    ]), "QMS Reports");
  } else if (reportType === "daily") {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Document type (Drawings or Submittals)", "Revision name (e.g. Rev 00)", "Approved status count"],
    ]), "Revisions");
  }
  return XLSX.write(applyExcelDateFormats(workbook), { type: "buffer", bookType: "xlsx", sheetStubs: true }) as Buffer;
}

export function parseQaqcReportingWorkbook(input: {
  reportType: ReportingType;
  base64: string;
  validate: (type: ReportingType, data: Record<string, unknown>, baseline: Record<string, unknown>, submit: boolean) => string[];
  baseline?: Record<string, unknown>;
}) {
  if (!validType(input.reportType)) throw new Error("reportType must be monthly, daily, or csat");
  const workbook = XLSX.read(workbookBuffer(input.base64), { type: "buffer", cellDates: false, dense: false });
  const errors: ReportingWorkbookError[] = [];
  for (const sheet of workbook.SheetNames) {
    if (!["Instructions", "Report Data", ...DYNAMIC_SHEETS[input.reportType]].includes(sheet)) {
      errors.push({ sheet, row: 1, field: "sheet", message: "Unexpected worksheet; use the standardized template" });
    }
  }
  const dataSheet = workbook.Sheets["Report Data"];
  if (!dataSheet) return { data: {}, errors: [{ sheet: "Report Data", row: 1, field: "sheet", message: "Required Report Data worksheet is missing" }] };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(dataSheet, { header: 1, defval: "" });
  const header = (rows[0] ?? []).map((value) => String(value).trim());
  if (header[0] !== "Field" || header[1] !== "Description" || header[2] !== "Value") {
    errors.push({ sheet: "Report Data", row: 1, field: "header", message: "Expected Field, Description, Value columns" });
  }
  const allowed = new Map(TYPE_FIELDS[input.reportType].map(([key, description, kind]) => [key, { description, kind }]));
  const data: Record<string, unknown> = {};
  const seen = new Set<string>();
  const sourceRows = new Map<string, { sheet: string; row: number }>();
  for (let index = 1; index < rows.length; index++) {
    const rowNumber = index + 1;
    const row = rows[index] ?? [];
    const field = String(row[0] ?? "").trim();
    const rawValue = row[2];
    if (!field && (rawValue === "" || rawValue === undefined)) continue;
    const fieldSpec = allowed.get(field);
    if (!fieldSpec) {
      errors.push({ sheet: "Report Data", row: rowNumber, field: field || "(blank)", message: "Unknown field for this report type" });
      continue;
    }
    if (seen.has(field)) {
      errors.push({ sheet: "Report Data", row: rowNumber, field, message: "Field is duplicated" });
      continue;
    }
    seen.add(field);
    sourceRows.set(field.split(".")[0]!, { sheet: "Report Data", row: rowNumber });
    try {
      const value = parseCell(rawValue, fieldSpec.kind, spreadsheetWorkbookDateOptions(workbook));
      if (value !== undefined) deepSet(data, field, value);
    } catch (error) {
      errors.push({ sheet: "Report Data", row: rowNumber, field, message: error instanceof Error ? error.message : "Invalid value" });
    }
  }
  readDynamicSheets(input.reportType, workbook, data, errors, sourceRows);
  for (const message of input.validate(input.reportType, data, input.baseline ?? {}, true)) {
    const rootField = /^([A-Za-z][\w]*)/.exec(message)?.[1] ?? "data";
    const location = sourceRows.get(rootField) ?? { sheet: "Report Data", row: 1 };
    errors.push({
      sheet: location.sheet,
      row: location.row,
      field: rootField,
      message,
    });
  }
  return { data, errors };
}

export const qaqcReportingWorkbookMimeType = MIME;