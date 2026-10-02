import {
  PDFArray, PDFButton, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFOptionList,
  PDFRadioGroup, PDFSignature, PDFStream, PDFTextField, StandardFonts,
} from "pdf-lib";
import { calculateReport, validateReportData } from "./qaqc-reporting-model";

export type PdfMapping = {
  source: string;
  pdfField?: string;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
};

export type PdfInspection = {
  pages: Array<{ width: number; height: number }>;
  fields: Array<{ name: string; type: string }>;
};

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 40;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SUPPORTED_FIELD_TYPES = new Set(["TextField", "PDFTextField", "CheckBox", "PDFCheckBox", "Dropdown", "PDFDropdown", "RadioGroup", "PDFRadioGroup"]);
const inspectionRotations = new WeakMap<PdfInspection, number[]>();

function validatePdfBytes(bytes: Buffer): void {
  if (!Buffer.isBuffer(bytes)) throw new Error("PDF input must be a Buffer.");
  if (bytes.length > MAX_BYTES) throw new Error("PDF exceeds the 10 MB upload limit.");
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF: missing %PDF- signature.");
}

async function loadPdf(bytes: Buffer): Promise<PDFDocument> {
  validatePdfBytes(bytes);
  let document: PDFDocument;
  let pageCount: number;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: false });
    pageCount = document.getPageCount();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read PDF (encrypted or malformed): ${reason}`);
  }
  if (pageCount > MAX_PAGES) throw new Error(`PDF has more than ${MAX_PAGES} pages.`);
  // Actions can live in compressed objects, so inspecting raw upload bytes is
  // not sufficient to keep scripts and embedded files out of downloadable forms.
  const visited = new Set<unknown>();
  const activeKeys = new Set(["/JavaScript", "/JS", "/AA", "/OpenAction", "/Launch", "/EmbeddedFiles"]);
  const checkObject = (object: unknown) => {
    if (visited.has(object)) return;
    visited.add(object);
    if (object instanceof PDFStream) checkObject(object.dict);
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (key.toString() === "/XFA") throw new Error("XFA PDFs are not supported.");
        if (activeKeys.has(key.toString()) || value.toString() === "/JavaScript" || value.toString() === "/Launch") {
          throw new Error("PDF templates must not contain scripts, automatic actions or embedded files.");
        }
        checkObject(value);
      }
    } else if (object instanceof PDFArray) {
      for (let index = 0; index < object.size(); index++) checkObject(object.get(index));
    }
  };
  for (const [, object] of document.context.enumerateIndirectObjects()) checkObject(object);
  try {
    if (document.getForm().hasXFA()) throw new Error("XFA PDFs are not supported.");
    if (document.getForm().getFields().length > 500) throw new Error("PDF has more than 500 fillable fields.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("XFA PDFs are not supported")) throw error;
    throw new Error(`Unable to inspect PDF form: ${error instanceof Error ? error.message : String(error)}`);
  }
  return document;
}

function fieldType(field: any): string {
  // Bundlers rename constructors (for example PDFTextField2). Never persist or
  // authorize field capabilities using a runtime constructor's display name.
  if (field instanceof PDFTextField) return "PDFTextField";
  if (field instanceof PDFCheckBox) return "PDFCheckBox";
  if (field instanceof PDFDropdown) return "PDFDropdown";
  if (field instanceof PDFRadioGroup) return "PDFRadioGroup";
  if (field instanceof PDFOptionList) return "PDFOptionList";
  if (field instanceof PDFButton) return "PDFButton";
  if (field instanceof PDFSignature) return "PDFSignature";
  return "Unknown";
}

function inspectionFromDocument(document: PDFDocument): PdfInspection {
  const form = document.getForm();
  const pages = document.getPages();
  const inspection: PdfInspection = {
    pages: pages.map((page) => {
      const { width, height } = page.getSize();
      return { width, height };
    }),
    fields: form.getFields().map((field) => ({
      name: field.getName(),
      type: isReadOnly(field) ? `${fieldType(field)} (read-only)` : fieldType(field),
    })),
  };
  inspectionRotations.set(inspection, pages.map((page) => page.getRotation().angle));
  return inspection;
}

export async function inspectPdf(bytes: Buffer): Promise<PdfInspection> {
  return inspectionFromDocument(await loadPdf(bytes));
}

function validateSource(source: string): void {
  if (typeof source !== "string" || !source.trim()) throw new Error("Each PDF mapping requires a non-empty source path.");
  const parts = source.split(".");
  if (parts.some((part) => !part || UNSAFE_KEYS.has(part))) {
    throw new Error(`Unsafe or invalid source path: ${source}`);
  }
}

export function validatePdfMappings(mappings: PdfMapping[], inspection: PdfInspection): void {
  if (!Array.isArray(mappings)) throw new Error("PDF mappings must be an array.");
  const mappedFields = new Set<string>();
  for (const mapping of mappings) {
    validateSource(mapping.source);
    if (mapping.pdfField !== undefined) {
      if (mappedFields.has(mapping.pdfField)) throw new Error(`PDF field "${mapping.pdfField}" is mapped more than once.`);
      mappedFields.add(mapping.pdfField);
      const field = inspection.fields.find((item) => item.name === mapping.pdfField);
      if (!field) throw new Error(`PDF field not found: ${mapping.pdfField}`);
      if (field.type.endsWith(" (read-only)")) throw new Error(`PDF field "${mapping.pdfField}" is read-only and cannot be mapped.`);
      if (!SUPPORTED_FIELD_TYPES.has(field.type)) throw new Error(`Unsupported PDF field type "${field.type}" for ${mapping.pdfField}.`);
      continue;
    }
    const pageNo = mapping.page;
    if (!Number.isInteger(pageNo) || (pageNo as number) < 1 || (pageNo as number) > inspection.pages.length) {
      throw new Error(`Coordinate mapping for "${mapping.source}" requires a valid one-based page number.`);
    }
    if ((inspectionRotations.get(inspection)?.[(pageNo as number) - 1] ?? 0) % 360 !== 0) {
      throw new Error(`Coordinate mapping for "${mapping.source}" targets a rotated page; rotate the PDF page upright before mapping coordinates.`);
    }
    for (const key of ["x", "y", "width", "height"] as const) {
      if (typeof mapping[key] !== "number" || !Number.isFinite(mapping[key])) {
        throw new Error(`Coordinate mapping for "${mapping.source}" requires finite ${key}.`);
      }
    }
    const { width: pageWidth, height: pageHeight } = inspection.pages[(pageNo as number) - 1]!;
    const { x, y, width, height } = mapping as Required<Pick<PdfMapping, "x" | "y" | "width" | "height">>;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > pageWidth || y + height > pageHeight) {
      throw new Error(`Coordinate rectangle for "${mapping.source}" is outside page ${pageNo} bounds.`);
    }
    if (mapping.fontSize !== undefined && (!Number.isFinite(mapping.fontSize) || mapping.fontSize <= 0)) {
      throw new Error(`fontSize for "${mapping.source}" must be a positive finite number.`);
    }
  }
}

function resolveSource(values: Record<string, unknown>, source: string): unknown {
  validateSource(source);
  let value: any = values;
  for (const part of source.split(".")) {
    if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) {
      throw new Error(`Missing data for PDF mapping source "${source}".`);
    }
    value = value[part];
  }
  if (value === undefined) throw new Error(`Missing data for PDF mapping source "${source}".`);
  return value;
}

function printable(value: unknown): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("JSON serialization returned no value.");
    return json;
  } catch {
    throw new Error("Mapped object or array could not be represented as JSON.");
  }
}

function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        if (line) { lines.push(line); line = ""; }
        let piece = "";
        for (const char of word) {
          const candidate = piece + char;
          if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
            if (!piece) throw new Error("Mapped text contains a character too wide for the target rectangle.");
            lines.push(piece);
            piece = char;
          } else piece = candidate;
        }
        line = piece;
      } else if (line && font.widthOfTextAtSize(`${line} ${word}`, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawFittedText(document: PDFDocument, mapping: PdfMapping, text: string): void {
  const page = document.getPages()[(mapping.page as number) - 1]!;
  const { x, y, width, height } = mapping as Required<Pick<PdfMapping, "x" | "y" | "width" | "height">>;
  const fontSize = mapping.fontSize ?? 10;
  const leading = fontSize * 1.2;
  let lines: string[];
  let font;
  try {
    font = document.embedStandardFont(StandardFonts.Helvetica);
    lines = wrapText(text, width, font, fontSize);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Mapped text cannot be represented in the PDF: ${message}`);
  }
  if (lines.length * leading > height + 0.001) {
    throw new Error(`Mapped text for "${mapping.source}" overflows its ${width}×${height} point rectangle.`);
  }
  lines.forEach((line, index) => page.drawText(line, {
    x,
    y: page.getHeight() - y - fontSize - index * leading,
    size: fontSize,
    font,
  }));
}

function isReadOnly(field: any): boolean {
  return typeof field.isReadOnly === "function" && field.isReadOnly();
}

function setTextFieldValue(document: PDFDocument, field: any, value: unknown, fieldName: string): void {
  const text = printable(value);
  const maxLength = field.getMaxLength?.();
  if (maxLength !== undefined && text.length > maxLength) {
    throw new Error(`PDF field "${fieldName}" allows at most ${maxLength} characters; the mapped value has ${text.length}.`);
  }
  const widgets = field.acroField?.getWidgets?.() ?? [];
  if (!widgets.length) throw new Error(`PDF text field "${fieldName}" has no visible widget.`);
  const rectangles = widgets.map((widget: any) => widget.getRectangle());
  const width = Math.min(...rectangles.map((rect: any) => rect.width)) - 8;
  const height = Math.min(...rectangles.map((rect: any) => rect.height)) - 8;
  const multiline = field.isMultiline?.() ?? false;
  if (!multiline && /[\r\n]/.test(text)) {
    throw new Error(`PDF text field "${fieldName}" is single-line and cannot represent multiline text.`);
  }
  const font = document.embedStandardFont(StandardFonts.Helvetica);
  let initialSize = 10;
  try {
    initialSize = Number(field.getFontSize?.()) || 10;
  } catch {
    initialSize = 10;
  }
  let fittedSize: number | undefined;
  for (let size = Math.max(initialSize, 4); size >= 4; size = Math.max(4, size - 0.5)) {
    let lines: string[];
    try {
      lines = multiline ? wrapText(text, width, font, size) : [text];
    } catch (error) {
      throw new Error(`Mapped text for "${fieldName}" cannot be represented by the PDF font: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (lines.every((line) => font.widthOfTextAtSize(line, size) <= width) && lines.length * size * 1.2 <= height) {
      fittedSize = size;
      break;
    }
    if (size === 4) break;
  }
  if (fittedSize === undefined) throw new Error(`Mapped text for PDF field "${fieldName}" cannot fit its widget without clipping.`);
  try {
    field.setFontSize(fittedSize);
    field.setText(text);
  } catch (error) {
    throw new Error(`Unable to set PDF text field "${fieldName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assignField(document: PDFDocument, field: any, value: unknown, fieldName: string): void {
  const type = fieldType(field);
  if (isReadOnly(field)) throw new Error(`PDF field "${fieldName}" is read-only and cannot be mapped.`);
  if (!SUPPORTED_FIELD_TYPES.has(type)) throw new Error(`Unsupported PDF field type "${type}" for ${fieldName}.`);
  try {
    if (type === "CheckBox" || type === "PDFCheckBox") {
      if (typeof value !== "boolean") throw new Error("checkbox values must be boolean");
      value ? field.check() : field.uncheck();
    } else if (type === "Dropdown" || type === "PDFDropdown") {
      if (typeof value !== "string") throw new Error("dropdown values must be strings");
      const options = field.getOptions();
      if (!options.includes(value)) throw new Error(`value must be one of: ${options.join(", ")}`);
      field.select(value);
    } else if (type === "RadioGroup" || type === "PDFRadioGroup") {
      if (typeof value !== "string") throw new Error("radio values must be strings");
      const options = field.getOptions();
      if (!options.includes(value)) throw new Error(`value must be one of: ${options.join(", ")}`);
      field.select(value);
    } else {
      setTextFieldValue(document, field, value, fieldName);
    }
  } catch (error) {
    throw new Error(`Unable to set PDF field "${fieldName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function renderPdfLayout(bytes: Buffer, mappings: PdfMapping[], values: Record<string, unknown>): Promise<Buffer> {
  const document = await loadPdf(bytes);
  const inspection = inspectionFromDocument(document);
  validatePdfMappings(mappings, inspection);
  const form = document.getForm();
  for (const formField of form.getFields()) {
    const field = formField as any;
    if (isReadOnly(field)) continue;
    if (field.setText || field.uncheck || field.clear) {
      try {
        if (field.setText) field.setText("");
        else if (field.uncheck) field.uncheck();
        else field.clear();
      } catch (error) {
        throw new Error(`Unable to clear PDF field "${field.getName()}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const mapping of mappings) {
    const value = resolveSource(values, mapping.source);
    if (value === null) {
      if (mapping.pdfField) {
        const field = form.getField(mapping.pdfField) as any;
        try {
          if (fieldType(field) === "CheckBox" || fieldType(field) === "PDFCheckBox") field.uncheck();
          else if (fieldType(field) === "TextField" || fieldType(field) === "PDFTextField") field.setText("");
        } catch (error) {
          throw new Error(`Unable to blank optional field "${mapping.pdfField}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      continue;
    }
    if (mapping.pdfField) assignField(document, form.getField(mapping.pdfField), value, mapping.pdfField);
    else drawFittedText(document, mapping, printable(value));
  }
  if (mappings.length) form.flatten();
  return Buffer.from(await document.save());
}

type ReportType = "monthly" | "daily" | "csat";
type ReportKind = "report" | "dashboard";

function sampleData(reportType: ReportType): Record<string, any> {
  if (reportType === "monthly") {
    const metrics = Object.fromEntries(["external_ncr", "internal_ncr", "rfi", "rmi"].map((key) => [key, {
      issued: 2, closed: 1,
      ageing: key === "external_ncr" || key === "internal_ncr" ? [{ department: "Civil", bucket: "0-15", count: 3 }] : [],
    }]));
    return {
      noUpdates: false,
      pqpStatus: "Approved A", pqpOther: null, pqpSubmittedDate: "2025-01-08", pqpApprovedDate: "2025-01-15",
      reportReference: "QA-MONTHLY-2025-01", reportFrom: "2025-01-01", reportTo: "2025-01-31",
      meetings: [{ type: "Project Quality Meeting", lastDate: "2025-01-10", nextDate: "2025-02-10" }],
      internalAudit: { conducted: true, lastDate: "2024-12-10", nextDate: "2025-06-10" },
      metrics,
      material: {
        issued: 2, closed: 1, osdAvailable: false, osdMirns: 0, overage: 0, shortage: 0, damage: 0, defective: 0,
        totalItems: 2, approved: 1, onHold: 1, rejectedDoNotUse: 0, rejectedReturn: 0, hazardous: 0, handleWithCare: 0,
      },
      qtbt: { talkCount: 1, attendance: 12, durationMinutes: 30 }, manpower: [{ department: "Quality", count: 4, approvalRequired: true, approved: 3, rejected: 1 }],
      documents: {
        drawings: { approved: 2, resubmitted: 1, rejected: 0, underReview: 1, clientReviewDays: 3, internalReviewDays: 2, remarks: "Drawing review is within the planned cycle." },
        submittals: { approved: 1, resubmitted: 0, rejected: 0, underReview: 1, clientReviewDays: 2, internalReviewDays: 1, remarks: "One submittal remains under review." },
      },
      qmsReports: [{ department: "Quality", type: "SOP", documentName: "Inspection procedure", status: "Approved & Published", remarks: "Current controlled revision." }],
      narrative: "Monthly QA/QC assessment sample.",
    };
  }
  if (reportType === "daily") {
    const disciplines: Record<string, unknown> = {};
    for (const section of ["drawings", "submittals"]) disciplines[section] = Object.fromEntries(
      ["Civil", "Mechanical", "Structural", "Electrical", "Instrumentation"].map((discipline) => [discipline, { approved: 1, resubmit: 0, rejected: 0, underReview: 0 }]),
    );
    const pending = Object.fromEntries(["Client", "Algihaz", "Supplier"].map((entity) => [entity, Object.fromEntries(
      ["underReview", "A", "B", "C", "D", "E"].map((status) => [status, { upTo7: 0, days8To30: 0, over30: 0 }]),
    )]));
    return {
      noUpdates: false, disciplines, revisions: { drawings: [{ name: "Rev A", value: 1 }], submittals: [{ name: "Rev B", value: 0 }] },
      documentTypes: Object.fromEntries(["Drawings", "Material Submittals", "Method Statements", "ITPs", "CVs", "PQP", "IFR", "Vendors"].map((name) => [name, 1])),
      pending, correspondence: { incoming: 2, outgoing: 1 },
    };
  }
  return {
    ratings: { quality: 5, timeline: 4, communication: 5, professionalism: 4, valueForMoney: 4, issueHandling: 5 },
    expectations: "Yes", recommend: "Yes",
    satisfactoryAspects: "Responsive quality team and clear close-out records.",
    improvementSuggestions: "Provide earlier visibility of upcoming submittals.",
    comments: "Thank you for the support.",
  };
}

function sampleBaseline(reportType: ReportType): Record<string, any> {
  if (reportType === "monthly") return {
    previousPeriod: "2024-12-01", hasBaseline: true, legacyFallback: false,
    metrics: {
      external_ncr: { accumulatedIssued: 10, accumulatedClosed: 8 },
      internal_ncr: { accumulatedIssued: 6, accumulatedClosed: 4 },
      rfi: { accumulatedIssued: 24, accumulatedClosed: 20 },
      rmi: { accumulatedIssued: 12, accumulatedClosed: 10 },
    },
    material: { accumulatedIssued: 20, accumulatedClosed: 18 },
    qtbt: { accumulatedTalkCount: 18, accumulatedManhours: 96 },
  };
  if (reportType === "daily") return { ...sampleData("daily"), previousPeriod: "2025-01-30", hasBaseline: true, legacyFallback: false };
  return {};
}

function sampleReport(reportType: ReportType): Record<string, unknown> {
  const data = sampleData(reportType);
  const baseline = sampleBaseline(reportType);
  const period = reportType === "monthly" ? "2025-01-01" : "2025-01-31";
  const createdAt = "2025-02-01T08:00:00.000Z";
  const submittedAt = "2025-02-01T09:00:00.000Z";
  const approvedAt = "2025-02-01T10:00:00.000Z";
  const validation = validateReportData(reportType, data, baseline, true);
  if (!validation.valid) throw new Error(`Invalid ${reportType} sample report data: ${validation.errors.join("; ")}`);
  return {
    id: `sample-${reportType}-report-1`, organizationId: "sample-org", projectId: "sample-project",
    projectName: "Sample Project", projectCode: "SP-001", reportType, period, state: "approved",
    data, computed: calculateReport(reportType, data, baseline), baseline,
    createdById: "sample-creator", submittedById: "sample-submitter", approverId: "sample-approver",
    submittedAt, approvedAt, reviewComments: "Reviewed; approved for the reporting period.",
    referenceNumber: `QA-${reportType.toUpperCase()}-2025-01`,
    deletedAt: null, createdAt, updatedAt: approvedAt,
    history: [{
      id: "sample-history-1", actorId: "sample-approver", actorName: "Sample Approver",
      action: "approve", createdAt: approvedAt, before: { state: "submitted" }, after: { state: "approved", comments: "Reviewed." },
    }],
    reportTemplates: [{ name: "Approved QA/QC layout", template: { revision: "A", active: true } }],
  };
}

export function sampleTemplateValues(reportType: ReportType, kind: ReportKind): Record<string, unknown> {
  if (kind === "report") return sampleReport(reportType);
  const report = sampleReport(reportType);
  const reportPeriod = report.period as string;
  const dashboardFilters = { projectId: null, projectGroup: null, from: "2025-01-01", to: reportPeriod, category: "all" };
  const sourceMonthly = reportType === "monthly" ? [{
    projectId: report.projectId, projectName: report.projectName, period: reportPeriod, state: report.state,
    computed: report.computed, data: report.data,
  }] : [];
  const sourceCsat = reportType === "csat" ? [{
    projectId: report.projectId, period: reportPeriod, computed: report.computed, data: report.data,
  }] : [];
  const sourceDaily = reportType === "daily" ? [{
    projectId: report.projectId, projectName: report.projectName, period: reportPeriod,
    snapshot: report.computed, movement: null, absoluteSnapshot: true, globalPeriod: reportPeriod, baselinePeriod: null,
  }] : [];
  const computed = report.computed as Record<string, any>;
  const metricValues = Object.fromEntries(Object.entries(computed.metrics ?? {}).map(([key, metric]) =>
    [key, Number((metric as Record<string, unknown>).accumulatedRate ?? 0)]));
  const aggregates = reportType === "monthly" ? [{
    period: reportPeriod, projects: 1, averagePqi: Number(computed.pqi?.accumulated ?? 0), metrics: metricValues,
  }] : [];
  const dashboardData = {
    filters: dashboardFilters, monthly: sourceMonthly, aggregates, csat: sourceCsat,
    csatAverage: sourceCsat.length ? Number(computed.averageRating ?? 0) : 0, daily: sourceDaily,
  };
  const dashboardRows = reportType === "daily" ? sourceDaily
    : reportType === "csat"
      ? sourceCsat.map((item) => ({ ...item, reportType: "csat", ...computed }))
      : sourceMonthly.map((item) => ({ ...item, reportType: "monthly", ...computed }));
  return {
    title: "QA/QC Reporting Dashboard",
    filters: { ...dashboardFilters, reportType, category: "all" },
    summary: dashboardData,
    rows: dashboardRows,
    dashboardData,
    trends: [...aggregates, ...sourceDaily],
    reports: [report],
  };
}

export function templateSourceCatalog(reportType: ReportType, kind: ReportKind): Array<{ path: string; label: string; example: string }> {
  const sample = sampleTemplateValues(reportType, kind);
  const catalog: Array<{ path: string; label: string; example: string }> = [];
  const visit = (value: unknown, path: string) => {
    if (value && typeof value === "object") {
      if (path) catalog.push({ path, label: `${path} (JSON group)`, example: JSON.stringify(value) });
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
      } else {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          if (UNSAFE_KEYS.has(key)) continue;
          visit(child, path ? `${path}.${key}` : key);
        }
      }
      return;
    }
    if (path) catalog.push({
      path, label: path,
      example: value === null ? "null" : String(value),
    });
  };
  visit(sample, "");
  return catalog;
}