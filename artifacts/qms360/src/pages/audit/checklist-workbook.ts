import * as XLSX from "xlsx";

export const checklistHeaders = ["Clause", "Audit Area", "Audit Question", "Description", "Audit Findings"] as const;
export const checklistFindings = ["Minor NC", "Moderate NC", "Major NC", "OFI", "Not applicable"] as const;
export type ChecklistImportRow = {
  clause: string;
  auditArea: string;
  question: string;
  description?: string;
  auditFinding?: (typeof checklistFindings)[number];
};

const MAX_ROWS = 500;

export async function createChecklistWorkbook(areas: string[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Checklist", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...checklistHeaders]);
  sheet.columns = [22, 28, 55, 55, 23].map(width => ({ width }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).height = 24;
  const values = workbook.addWorksheet("Dropdown Values", { state: "veryHidden" });
  [...new Set(areas)].forEach((area, index) => { values.getCell(index + 2, 1).value = area; });
  checklistFindings.forEach((finding, index) => { values.getCell(index + 2, 2).value = finding; });
  workbook.definedNames.add(`'Dropdown Values'!$A$2:$A$${Math.max(2, areas.length + 1)}`, "ChecklistAuditAreas");
  workbook.definedNames.add(`'Dropdown Values'!$B$2:$B$${checklistFindings.length + 1}`, "ChecklistFindings");
  for (let row = 2; row <= MAX_ROWS + 1; row++) {
    for (const [column, name, required] of [["B", "ChecklistAuditAreas", true], ["E", "ChecklistFindings", false]] as const) {
      sheet.getCell(`${column}${row}`).dataValidation = {
        type: "list", allowBlank: !required, showErrorMessage: true, errorStyle: "error",
        errorTitle: "Select a listed value", error: "Choose a value from the dropdown.", formulae: [name],
      };
    }
  }
  const instructions = workbook.addWorksheet("Instructions");
  [
    ["Checklist import"],
    ["Required", "Clause, Audit Area and Audit Question. Fill from row 2 onward."],
    ["Dropdowns", "Choose Audit Area and optional Audit Findings from the dropdown in each cell."],
    ["Rows", `Up to ${MAX_ROWS} rows per upload. Keep the original header names and worksheet name.`],
    ["Evidence", "Attach evidence to individual items in the app after import."],
    ["Validation", "Pasted values are checked again when uploaded; invalid rows prevent the whole import."],
  ].forEach(row => instructions.addRow(row));
  instructions.getColumn(1).width = 22;
  instructions.getColumn(2).width = 95;
  return workbook;
}

export async function downloadChecklistWorkbook(areas: string[]) {
  const workbook = await createChecklistWorkbook(areas);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "audit-checklist-template.xlsx";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function parseChecklistWorkbook(bytes: ArrayBuffer, areas: string[]): ChecklistImportRow[] {
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheet = workbook.Sheets.Checklist;
  if (!sheet) throw new Error("Use the downloaded template (Checklist worksheet is missing).");
  const header = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, blankrows: false })[0] ?? [];
  if (checklistHeaders.some((value, index) => String(header[index] ?? "").trim() !== value)) {
    throw new Error("The Checklist columns do not match the downloaded template.");
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false, blankrows: false });
  if (!rows.length) throw new Error("The spreadsheet has no checklist items.");
  if (rows.length > MAX_ROWS) throw new Error(`Upload no more than ${MAX_ROWS} checklist items at once.`);
  const allowedAreas = new Set(areas);
  const allowedFindings = new Set<string>(checklistFindings);
  return rows.map(row => {
    const line = ((row as Record<string, unknown>).__rowNum__ as number) + 1;
    const values = checklistHeaders.map(key => String(row[key] ?? "").trim());
    const [clause, auditArea, question, description, finding] = values;
    if (!clause || !auditArea || !question) throw new Error(`Row ${line}: Clause, Audit Area and Audit Question are required.`);
    if (!allowedAreas.has(auditArea)) throw new Error(`Row ${line}: Audit Area "${auditArea}" is not an active master-data value.`);
    if (finding && !allowedFindings.has(finding)) throw new Error(`Row ${line}: choose an Audit Findings value from the dropdown.`);
    for (let col = 0; col < checklistHeaders.length; col++) {
      if (sheet[`${"ABCDE"[col]}${line}`]?.f) throw new Error(`Row ${line}: formulas are not supported in Checklist cells.`);
    }
    return {
      clause, auditArea, question,
      ...(description ? { description } : {}),
      ...(finding ? { auditFinding: finding as ChecklistImportRow["auditFinding"] } : {}),
    };
  });
}