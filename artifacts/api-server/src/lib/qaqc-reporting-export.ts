import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import type { ReportingType } from "./qaqc-reporting-excel";

export type QaqcReportExport = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName?: string | null;
  projectCode?: string | null;
  reportType: ReportingType | string;
  period: string;
  state: string;
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
  baseline: Record<string, unknown>;
  approverId?: string | null;
  submittedById?: string | null;
  submittedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  reviewComments?: string | null;
  history?: Array<Record<string, unknown>>;
  referenceNumber?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  reportTemplates?: Array<{ name: string; template: Record<string, unknown> }>;
};

export type QaqcDashboardExport = {
  title?: string;
  filters?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  dashboardData?: unknown;
  trends?: Array<Record<string, unknown>>;
  reports?: Array<QaqcReportExport>;
};

function printable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flatten(value: unknown, prefix = ""): Array<{ Field: string; Value: string }> {
  if (Array.isArray(value)) {
    if (!value.length) return [{ Field: prefix || "value", Value: "[]" }];
    return value.flatMap((item, index) => flatten(item, `${prefix}[${index + 1}]`));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return [{ Field: prefix || "value", Value: "{}" }];
    return entries.flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
  }
  return [{ Field: prefix || "value", Value: printable(value) }];
}

function addJsonSheet(workbook: XLSX.WorkBook, title: string, value: unknown) {
  const rows = flatten(value);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), title.slice(0, 31));
}

function reportWorkbook(report: QaqcReportExport) {
  const book = XLSX.utils.book_new();
  const overview = [
    ["Report", report.reportType.toUpperCase()],
    ["Project", report.projectName ?? report.projectId],
    ["Project code", report.projectCode ?? ""],
    ["Period", report.period],
    ["Status", report.state],
    ["Reference", report.referenceNumber ?? ""],
    ["Report ID", report.id],
    ["Submitted by", report.submittedById ?? ""],
    ["Submitted at", printable(report.submittedAt)],
    ["Approver", report.approverId ?? ""],
    ["Approved at", printable(report.approvedAt)],
    ["Review comments", report.reviewComments ?? ""],
    ["Created at", printable(report.createdAt)],
    ["Updated at", printable(report.updatedAt)],
    ["Configured QA/QC template count", String(report.reportTemplates?.length ?? 0)],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(overview), "Report");
  addJsonSheet(book, "Submitted Data", report.data);
  addJsonSheet(book, "Calculated Values", report.computed);
  addJsonSheet(book, "Baseline", report.baseline);
  if (report.reportTemplates?.length) addJsonSheet(book, "Template Metadata", report.reportTemplates);
  if (report.history?.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.history), "Workflow History");
  return book;
}

export function exportQaqcReportExcel(report: QaqcReportExport): Buffer {
  return XLSX.write(reportWorkbook(report), { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportQaqcDashboardExcel(dashboard: QaqcDashboardExport): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Dashboard", dashboard.title ?? "QA/QC reporting dashboard"],
    ...Object.entries(dashboard.filters ?? {}).map(([key, value]) => [key, printable(value)]),
  ]), "Filters");
  addJsonSheet(book, "Summary", dashboard.summary ?? {});
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(dashboard.rows), "Report Data");
  if (dashboard.dashboardData !== undefined) addJsonSheet(book, "Dashboard Data", dashboard.dashboardData);
  if (dashboard.trends?.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(dashboard.trends), "Trends");
  if (dashboard.reports?.length) {
    const workflow = dashboard.reports.map((report) => ({
      id: report.id, project: report.projectName ?? report.projectId, projectCode: report.projectCode,
      reportType: report.reportType, period: report.period, state: report.state,
      referenceNumber: report.referenceNumber, submittedById: report.submittedById, submittedAt: printable(report.submittedAt),
      approverId: report.approverId, approvedAt: printable(report.approvedAt), reviewComments: report.reviewComments,
      reportTemplateCount: report.reportTemplates?.length ?? 0,
    }));
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(workflow), "Workflow");
    const historyRows = dashboard.reports.flatMap((report) => (report.history ?? []).map((event) => ({
      reportId: report.id, project: report.projectName ?? report.projectId, period: report.period, ...event,
    })));
    if (historyRows.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(historyRows), "Workflow History");
    const contentRows = (key: "data" | "computed" | "baseline") => dashboard.reports!.flatMap((report) =>
      flatten(report[key]).map((field) => ({ reportId: report.id, project: report.projectName ?? report.projectId, period: report.period, ...field })));
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(contentRows("data")), "Submitted Data");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(contentRows("computed")), "Calculated Values");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(contentRows("baseline")), "Baselines");
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function pdfText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");
}

function wrap(text: string, max: number) {
  const words = pdfText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > max) {
      if (line) lines.push(line);
      line = "";
      for (let offset = 0; offset < word.length; offset += max) lines.push(word.slice(offset, offset + max));
      continue;
    }
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

async function makePdf(title: string, sections: Array<[string, unknown]>) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 48;
  const addPage = () => { page = document.addPage([pageWidth, pageHeight]); y = pageHeight - 48; };
  const write = (text: string, options: { bold?: boolean; size?: number } = {}) => {
    const size = options.size ?? 9;
    for (const line of wrap(text, Math.floor(105 * 9 / size))) {
      if (y < 38) addPage();
      page.drawText(line, { x: 42, y, size, font: options.bold ? bold : font, color: options.bold ? rgb(0.12, 0.25, 0.42) : rgb(0.12, 0.12, 0.12) });
      y -= size + 4;
    }
  };
  write(title, { bold: true, size: 18 });
  y -= 9;
  for (const [heading, data] of sections) {
    write(heading, { bold: true, size: 12 });
    const rows = flatten(data);
    for (const row of rows) write(`${row.Field}: ${row.Value}`);
    y -= 8;
  }
  return Buffer.from(await document.save());
}

export function exportQaqcReportPdf(report: QaqcReportExport): Promise<Buffer> {
  const title = `${report.reportType.toUpperCase()} QA/QC Report`;
  const metadata = {
    project: report.projectName ?? report.projectId,
    projectCode: report.projectCode,
    period: report.period,
    status: report.state,
    referenceNumber: report.referenceNumber,
    reportId: report.id,
    submittedBy: report.submittedById,
    submittedAt: report.submittedAt,
    approver: report.approverId,
    approvedAt: report.approvedAt,
    reviewComments: report.reviewComments,
    configuredQaqcTemplateCount: report.reportTemplates?.length ?? 0,
  };
  return makePdf(title, [["Report identity and workflow", metadata],
    ...(report.reportTemplates?.length ? [["Configured QA/QC template metadata", report.reportTemplates] as [string, unknown]] : []),
    ["Workflow history", report.history ?? []],
    ["Submitted report data", report.data], ["Calculated values", report.computed], ["Frozen baseline", report.baseline]]);
}

export function exportQaqcDashboardPdf(dashboard: QaqcDashboardExport): Promise<Buffer> {
  const rows = dashboard.rows.map((row, index) => ({ index: index + 1, ...row }));
  const detailSections: Array<[string, unknown]> = (dashboard.reports ?? []).flatMap((report) => [
    [`${report.reportType.toUpperCase()} - ${report.projectName ?? report.projectId} - ${report.period} - Workflow`, {
      id: report.id, state: report.state, referenceNumber: report.referenceNumber, approverId: report.approverId,
      submittedById: report.submittedById, submittedAt: report.submittedAt, approvedAt: report.approvedAt,
      reviewComments: report.reviewComments, history: report.history, reportTemplates: report.reportTemplates ?? [],
    }],
    [`Submitted Data - ${report.projectName ?? report.projectId} - ${report.period}`, report.data],
    [`Calculated Values - ${report.projectName ?? report.projectId} - ${report.period}`, report.computed],
    [`Frozen Baseline - ${report.projectName ?? report.projectId} - ${report.period}`, report.baseline],
  ]);
  return makePdf(dashboard.title ?? "QA/QC Reporting Dashboard", [
    ["Filters", dashboard.filters ?? {}], ["Summary", dashboard.summary ?? {}],
    ["Report and KPI data", rows], ["Dashboard Data", dashboard.dashboardData ?? dashboard.summary ?? {}],
    ["Trends", dashboard.trends ?? []], ...detailSections,
  ]);
}