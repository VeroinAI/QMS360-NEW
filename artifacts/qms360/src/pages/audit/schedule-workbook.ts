import type { AuditSchedule } from "@workspace/api-client-react";

export const scheduleImportHeaders = [
  "Audit Type", "Audit Category", "Department / Project", "Location", "Audit Title",
  "Process / Product Owner", "From Date", "To Date", "Remarks",
];

type Option = { value: string; label: string };
type Project = { code?: string | null; name: string };
type ProgrammeRange = { fromDate: string; toDate: string };

export type ScheduleWorkbookOptions = {
  auditTypes: Option[];
  auditCategories: Option[];
  departments: Option[];
  processOwners: Option[];
  projects: Project[];
};

export async function createScheduleWorkbook(
  schedules: AuditSchedule[],
  options: ScheduleWorkbookOptions,
  range?: ProgrammeRange,
) {
  // ExcelJS writes native list validations. SheetJS reads the upload, but does
  // not write spreadsheet data validations.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Audit Schedules", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(scheduleImportHeaders);
  sheet.columns = [27, 24, 32, 25, 38, 30, 16, 16, 42].map(width => ({ width }));
  sheet.getRow(1).font = { bold: true };
  for (const item of schedules) {
    sheet.addRow([
      item.auditTypes?.join(", ") ?? "", item.auditCategory ?? "", item.departmentProject ?? "",
      item.location ?? "", item.title, item.processProductOwner ?? "",
      item.plannedStartDate.slice(0, 10), item.plannedEndDate.slice(0, 10), item.remarks ?? "",
    ]);
  }

  const lists = workbook.addWorksheet("Dropdown Values", { state: "veryHidden" });
  const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
  const columns = [
    { name: "AuditTypes", values: unique([...options.auditTypes.map(x => x.value), ...schedules.flatMap(x => x.auditTypes ?? [])]) },
    { name: "AuditCategories", values: unique([...options.auditCategories.map(x => x.value), ...schedules.map(x => x.auditCategory ?? "")]) },
    { name: "Departments", values: unique([...options.departments.flatMap(x => [x.label, x.value]), ...schedules.filter(x => x.auditTypes?.includes("Quality Internal Process Audit")).map(x => x.departmentProject ?? "")]) },
    { name: "Projects", values: unique([...options.projects.flatMap(x => [x.name, x.code ?? ""]), ...schedules.filter(x => !x.auditTypes?.includes("Quality Internal Process Audit")).map(x => x.departmentProject ?? "")]) },
    { name: "ProcessOwners", values: unique([...options.processOwners.map(x => x.value), ...schedules.map(x => x.processProductOwner ?? "")]) },
  ];
  columns.forEach(({ name, values }, index) => {
    lists.getCell(1, index + 1).value = name;
    values.forEach((value, row) => { lists.getCell(row + 2, index + 1).value = value; });
    const letter = String.fromCharCode(65 + index);
    workbook.definedNames.add(`'Dropdown Values'!$${letter}$2:$${letter}$${Math.max(2, values.length + 1)}`, name);
  });
  const listValidation = (formula: string) => ({
    type: "list" as const, allowBlank: true, showErrorMessage: true,
    errorStyle: "error" as const, errorTitle: "Select a listed value",
    error: "Choose a value from the cell dropdown.", formulae: [formula],
  });
  const lastRow = Math.min(1_048_576, Math.max(1001, schedules.length + 501));
  for (let row = 2; row <= lastRow; row += 1) {
    sheet.getCell(`A${row}`).dataValidation = listValidation("AuditTypes");
    sheet.getCell(`B${row}`).dataValidation = listValidation("AuditCategories");
    sheet.getCell(`C${row}`).dataValidation = listValidation(`IF($A${row}="Quality Internal Process Audit",Departments,Projects)`);
    sheet.getCell(`F${row}`).dataValidation = listValidation("ProcessOwners");
  }

  const instructions = workbook.addWorksheet("Instructions");
  [
    ["Audit Schedule Import Instructions"],
    ["Template columns", scheduleImportHeaders.join(", ")],
    ["Mandatory columns", "Audit Type, Audit Category, Department / Project, Audit Title, Process / Product Owner, From Date, To Date"],
    ["Dropdown fields", "Audit Type, Audit Category, Department / Project, Process / Product Owner. The Department / Project dropdown depends on Audit Type."],
    ["Date format", "YYYY-MM-DD"],
    ["Parent range", range ? `${range.fromDate} through ${range.toDate}` : "No parent range"],
  ].forEach(row => instructions.addRow(row));
  instructions.getColumn(1).width = 24;
  instructions.getColumn(2).width = 110;

  return workbook;
}

export async function downloadScheduleWorkbook(
  schedules: AuditSchedule[],
  fileName: string,
  options: ScheduleWorkbookOptions,
  range?: ProgrammeRange,
) {
  const workbook = await createScheduleWorkbook(schedules, options, range);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}