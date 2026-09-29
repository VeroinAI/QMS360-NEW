import * as XLSX from "xlsx";
import type { ChecklistItem } from "@workspace/api-client-react";

export const checklistHeaders = ["Clause", "Audit Area", "Audit Question", "Description", "Audit Findings"] as const;
export const checklistFindings = ["Minor NC", "Moderate NC", "Major NC", "OFI", "Not applicable"] as const;
export type AuditAreaOption = { value: string; label: string };
export type ChecklistImportRow = {
  id?: string;
  clause: string;
  auditArea: string;
  question: string;
  description?: string;
  auditFinding?: (typeof checklistFindings)[number];
};

const MAX_ROWS = 500;

export async function createChecklistWorkbook(areas: AuditAreaOption[], items: ChecklistItem[] = []) {
  if (items.length > MAX_ROWS) throw new Error(`This audit has more than ${MAX_ROWS} items; the Excel template cannot include all records.`);
  const names = new Set<string>();
  for (const area of areas) {
    if (names.has(area.label)) throw new Error(`The Audit Area master data contains duplicate names: "${area.label}". Rename them before exporting.`);
    names.add(area.label);
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Checklist", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...checklistHeaders, "Item ID"]);
  sheet.columns = [22, 28, 55, 55, 23, 42].map(width => ({ width }));
  sheet.getColumn(6).hidden = true;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).height = 24;
  for (const item of items) {
    sheet.addRow([
      item.clause ?? "", areas.find(area => area.value === item.auditArea)?.label ?? item.auditArea ?? "",
      item.question, item.description || item.notes || "", item.auditFinding || item.result || "", item.id,
    ]);
  }
  const values = workbook.addWorksheet("Dropdown Values", { state: "veryHidden" });
  areas.forEach((area, index) => { values.getCell(index + 2, 1).value = area.label; });
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
    ["Existing items", "Existing Checklist records are prefilled. Keep the hidden Item ID column intact so uploading edits those rows instead of creating duplicates. Omitted rows are not deleted."],
    ["Rows", `Up to ${MAX_ROWS} rows per upload. Keep the original header names and worksheet name.`],
    ["Evidence", "Attach evidence to individual items in the app after import."],
    ["Validation", "Pasted values are checked again when uploaded; invalid rows prevent the whole import."],
  ].forEach(row => instructions.addRow(row));
  instructions.getColumn(1).width = 22;
  instructions.getColumn(2).width = 95;
  return workbook;
}

export async function downloadChecklistWorkbook(areas: AuditAreaOption[], items: ChecklistItem[] = []) {
  const workbook = await createChecklistWorkbook(areas, items);
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

/** Identify a checklist template even when a browser or user renamed the file. */
export function isChecklistWorkbook(bytes: ArrayBuffer): boolean {
  try {
    const workbook = XLSX.read(bytes, { type: "array", sheetRows: 1 });
    const sheet = workbook.Sheets.Checklist;
    if (!sheet) return false;
    const header = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0 })[0] ?? [];
    return checklistHeaders.every((name, index) => String(header[index] ?? "").trim() === name);
  } catch {
    return false;
  }
}

export function parseChecklistWorkbook(bytes: ArrayBuffer, areas: AuditAreaOption[], existing: ChecklistItem[] = []): ChecklistImportRow[] {
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheet = workbook.Sheets.Checklist;
  if (!sheet) throw new Error("Use the downloaded template (Checklist worksheet is missing).");
  const header = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, blankrows: false })[0] ?? [];
  if (checklistHeaders.some((value, index) => String(header[index] ?? "").trim() !== value)) {
    throw new Error("The Checklist columns do not match the downloaded template.");
  }
  const hasItemIds = String(header[5] ?? "").trim() === "Item ID";
  if (header[5] && !hasItemIds) throw new Error("The hidden Item ID column has been changed. Download a new template.");
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false, blankrows: false });
  if (!rows.length) throw new Error("The spreadsheet has no checklist items.");
  if (rows.length > MAX_ROWS) throw new Error(`Upload no more than ${MAX_ROWS} checklist items at once.`);
  const existingById = new Map(existing.map(item => [item.id, item]));
  const seenIds = new Set<string>();
  const allowedFindings = new Set<string>(checklistFindings);
  const parsed = rows.map((row): ChecklistImportRow | null => {
    const line = ((row as Record<string, unknown>).__rowNum__ as number) + 1;
    const values = checklistHeaders.map(key => String(row[key] ?? "").trim());
    const [clause, auditArea, question, description, finding] = values;
    const id = hasItemIds ? String(row["Item ID"] ?? "").trim() : "";
    if (id && !existingById.has(id)) throw new Error(`Row ${line}: Item ID is not in this audit. Download a fresh template.`);
    if (id && seenIds.has(id)) throw new Error(`Row ${line}: duplicate Checklist item ID.`);
    if (id) seenIds.add(id);
    const previous = id ? existingById.get(id) : undefined;
    if (!clause || !auditArea || !question) {
      const originalArea = areas.find(area => area.value === previous?.auditArea)?.label ?? previous?.auditArea ?? "";
      if (previous && clause === (previous.clause ?? "") && auditArea === originalArea
        && question === previous.question && description === (previous.description || previous.notes || "")
        && finding === (previous.auditFinding || previous.result || "")) {
        // Older rows can lack fields that are mandatory for new rows. Export them,
        // but leave unchanged rows alone rather than blocking unrelated imports.
        return null;
      }
      throw new Error(`Row ${line}: Clause, Audit Area and Audit Question are required.`);
    }
    const matchingAreas = hasItemIds
      ? areas.filter(area => area.label === auditArea)
      : areas.filter(area => area.value === auditArea);
    if (matchingAreas.length > 1) throw new Error(`Row ${line}: Audit Area "${auditArea}" has multiple master-data matches.`);
    const chosen = matchingAreas[0];
    if (chosen && previous && previous.auditArea === auditArea && chosen.value !== previous.auditArea) {
      throw new Error(`Row ${line}: Audit Area "${auditArea}" is ambiguous. Choose a listed name.`);
    }
    const areaValue = chosen?.value ?? (previous?.auditArea === auditArea ? auditArea : null);
    if (!areaValue) throw new Error(`Row ${line}: Audit Area "${auditArea}" is not an active master-data name.`);
    const unchangedLegacyFinding = previous && finding && !allowedFindings.has(finding)
      && finding === (previous.auditFinding ?? previous.result);
    if (finding && !allowedFindings.has(finding) && !unchangedLegacyFinding) {
      throw new Error(`Row ${line}: choose an Audit Findings value from the dropdown.`);
    }
    for (let col = 0; col < (hasItemIds ? 6 : 5); col++) {
      if (sheet[`${"ABCDEF"[col]}${line}`]?.f) throw new Error(`Row ${line}: formulas are not supported in Checklist cells.`);
    }
    return {
      ...(id ? { id } : {}),
      clause, auditArea: areaValue, question, description,
      ...(finding && !unchangedLegacyFinding ? { auditFinding: finding as ChecklistImportRow["auditFinding"] } : {}),
    };
  }).filter((row): row is ChecklistImportRow => row !== null);
  if (!parsed.length) throw new Error("No complete checklist items to load. Fill the required fields to update older rows.");
  return parsed;
}