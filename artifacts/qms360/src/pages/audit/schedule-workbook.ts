import type { AuditSchedule } from "@workspace/api-client-react";
import { categoryOptionsForAuditType, linkedAuditTypes } from "./audit-category-options";

export const scheduleImportHeaders = [
  "Audit Type", "Audit Category", "Department / Project", "Location", "Audit Title",
  "Process / Product Owner", "From Date (YYYY-MM-DD)", "To Date (YYYY-MM-DD)", "Remarks",
];

const scheduleHeaderAliases: Record<string, string> = {
  audittype: "auditTypes", audittypevalue: "auditTypes", auditcategory: "auditCategory",
  departmentproject: "departmentProject", project: "departmentProject", location: "location",
  audittitle: "title", processeeproductowner: "processProductOwner", processproductowner: "processProductOwner",
  fromdate: "plannedStartDate", fromdateyyyymmdd: "plannedStartDate", startdate: "plannedStartDate",
  todate: "plannedEndDate", todateyyyymmdd: "plannedEndDate", enddate: "plannedEndDate",
  remarks: "remarks",
};

export const scheduleFieldForHeader = (header: string) =>
  scheduleHeaderAliases[header.trim().toLowerCase().replace(/[^a-z0-9]/g, "")];

type Option = { value: string; label: string; metadata?: Record<string, unknown> };
type Project = { id?: string; code?: string | null; name: string };
type ProgrammeRange = { fromDate: string; toDate: string };

export const projectDropdownLabel = (project: Project) =>
  project.code?.trim() ? `${project.code.trim()} — ${project.name}` : project.name;

export const resolveScheduleProject = <T extends Project>(projects: T[], text: string) =>
  projects.find(project => projectDropdownLabel(project) === text)
  ?? projects.find(project => project.code === text || project.name === text);

export type ScheduleWorkbookOptions = {
  auditTypes: Option[];
  auditCategories: Option[];
  departments: Option[];
  processOwners: Option[];
  projects: Project[];
};

export function scheduleCategoryLinkError(
  categories: Option[], auditTypes: string[], category: string,
): string | null {
  if (!categories.some(option => linkedAuditTypes(option).length)) return null;
  const incompatible = auditTypes.filter(type =>
    !categoryOptionsForAuditType(categories, type).some(option => option.value === category));
  return incompatible.length
    ? `Audit Category "${category}" is not linked to Audit Type(s) ${incompatible.join(", ")} in master data`
    : null;
}
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
  sheet.columns = [27, 24, 32, 25, 38, 30, 25, 25, 42].map(width => ({ width }));
  sheet.getRow(1).font = { bold: true };
  for (const item of schedules) {
    const project = item.auditTypes?.includes("Quality Internal Process Audit")
      ? undefined
      : options.projects.find(candidate => candidate.id && item.projectIds?.includes(candidate.id))
        ?? resolveScheduleProject(options.projects, item.departmentProject ?? "");
    sheet.addRow([
      item.auditTypes?.join(", ") ?? "", item.auditCategory ?? "",
      project ? projectDropdownLabel(project) : item.departmentProject ?? "",
      item.location ?? "", item.title, item.processProductOwner ?? "",
      item.plannedStartDate.slice(0, 10), item.plannedEndDate.slice(0, 10), item.remarks ?? "",
    ]);
  }

  const lists = workbook.addWorksheet("Dropdown Values", { state: "veryHidden" });
  const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
  const linkedCategories = options.auditCategories.some(category => linkedAuditTypes(category).length > 0);
  const auditTypeChoices = unique([
    ...options.auditTypes.map(x => x.value),
    ...schedules.map(x => x.auditTypes?.join(", ") ?? ""),
  ]);
  const columns = [
    { name: "AuditTypes", values: auditTypeChoices },
    { name: "AuditCategories", values: unique([...options.auditCategories.map(x => x.value), ...(!linkedCategories ? schedules.map(x => x.auditCategory ?? "") : [])]) },
    { name: "Departments", values: unique([...options.departments.flatMap(x => [x.label, x.value]), ...schedules.filter(x => x.auditTypes?.includes("Quality Internal Process Audit")).map(x => x.departmentProject ?? "")]) },
    { name: "Projects", values: unique([
      ...options.projects.map(projectDropdownLabel),
      ...schedules.filter(x => !x.auditTypes?.includes("Quality Internal Process Audit"))
        .filter(x => !options.projects.some(project => project.id && x.projectIds?.includes(project.id))
          && !resolveScheduleProject(options.projects, x.departmentProject ?? ""))
        .map(x => x.departmentProject ?? ""),
    ]) },
    // Preserve old cell text but never offer a formerly authorized owner as a new selection.
    { name: "ProcessOwners", values: unique(options.processOwners.map(x => x.value)) },
  ];
  columns.forEach(({ name, values }, index) => {
    lists.getCell(1, index + 1).value = name;
    values.forEach((value, row) => { lists.getCell(row + 2, index + 1).value = value; });
    const letter = lists.getColumn(index + 1).letter;
    workbook.definedNames.add(`'Dropdown Values'!$${letter}$2:$${letter}$${Math.max(2, values.length + 1)}`, name);
  });
  if (linkedCategories) {
    // Store type -> named range separately from the legacy flat category list.
    // Excel's INDIRECT resolves the name returned by VLOOKUP for each schedule row.
    lists.getCell("G1").value = "Audit Type";
    lists.getCell("H1").value = "Category Range";
    // Reserve a blank cell below the mapping, away from populated owner lists.
    const emptyCategoryRow = Math.max(3, columns[0].values.length + 2);
    workbook.definedNames.add(`'Dropdown Values'!$G$${emptyCategoryRow}`, "EmptyAuditCategories");
    columns[0].values.forEach((type, index) => {
      const name = `ScheduleCategories${index + 1}`;
      const column = lists.getColumn(9 + index);
      const letter = column.letter;
      const selectedTypes = type.split(",").map(value => value.trim()).filter(Boolean);
      const values = unique(options.auditCategories
        .filter(category => selectedTypes.every(selected =>
          categoryOptionsForAuditType(options.auditCategories, selected).some(option => option.value === category.value)))
        .map(category => category.value));
      lists.getCell(index + 2, 7).value = type;
      lists.getCell(index + 2, 8).value = values.length ? name : "EmptyAuditCategories";
      lists.getCell(1, 9 + index).value = name;
      values.forEach((value, row) => { lists.getCell(row + 2, 9 + index).value = value; });
      if (values.length) {
        workbook.definedNames.add(`'Dropdown Values'!$${letter}$2:$${letter}$${values.length + 1}`, name);
      }
    });
    workbook.definedNames.add(
      `'Dropdown Values'!$G$2:$H$${Math.max(2, columns[0].values.length + 1)}`, "AuditCategoryMap",
    );
  }
  const listValidation = (formula: string) => ({
    type: "list" as const, allowBlank: true, showErrorMessage: true,
    errorStyle: "error" as const, errorTitle: "Select a listed value",
    error: "Choose a value from the cell dropdown.", formulae: [formula],
  });
  const lastRow = Math.min(1_048_576, Math.max(1001, schedules.length + 501));
  for (let row = 2; row <= lastRow; row += 1) {
    sheet.getCell(`A${row}`).dataValidation = listValidation("AuditTypes");
    sheet.getCell(`B${row}`).dataValidation = listValidation(linkedCategories
      ? `INDIRECT(IFERROR(VLOOKUP($A${row},AuditCategoryMap,2,FALSE),"EmptyAuditCategories"))`
      : "AuditCategories");
    sheet.getCell(`C${row}`).dataValidation = listValidation(`IF($A${row}="Quality Internal Process Audit",Departments,Projects)`);
    sheet.getCell(`F${row}`).dataValidation = listValidation("ProcessOwners");
  }

  const instructions = workbook.addWorksheet("Instructions");
  [
    ["Audit Schedule Import Instructions"],
    ["Template columns", scheduleImportHeaders.join(", ")],
    ["Mandatory columns", "Audit Type, Audit Category, Department / Project, Audit Title, Process / Product Owner, From Date (YYYY-MM-DD), To Date (YYYY-MM-DD)"],
    ["Dropdown fields", "Audit Type, Audit Category, Department / Project, Process / Product Owner (active Audit users assigned the Product / Process Owner authorization). The Audit Category dropdown follows the Audit Type when links are configured in master data; reselect the category if you change the type. The Department / Project dropdown depends on Audit Type."],
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
