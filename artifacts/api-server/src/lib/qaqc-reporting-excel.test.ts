import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  makeQaqcReportingTemplate, parseQaqcReportingWorkbook, type ReportingType,
} from "./qaqc-reporting-excel";

function base64Workbook(rows: unknown[][], sheet = "Report Data") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet);
  return (XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");
}

const validate = (_type: ReportingType, data: Record<string, unknown>) =>
  typeof data.narrative === "string" ? [] : ["narrative is required"];

describe("QA/QC reporting Excel tools", () => {
  it("creates human-readable instructions, named project options, and a report data sheet", () => {
    const bytes = makeQaqcReportingTemplate("monthly", [{
      id: "project-id-not-a-template-input", name: "Central Hospital", code: "CH-01", costCentre: "CC-4",
    }]);
    const workbook = XLSX.read(bytes, { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Instructions", "Report Data", "Meetings", "Manpower", "NCR Ageing", "QMS Reports"]);
    const instructions = XLSX.utils.sheet_to_json(workbook.Sheets.Instructions!, { header: 1 }) as unknown[][];
    expect(instructions.some((row) => row.includes("Central Hospital"))).toBe(true);
    expect(instructions.some((row) => row.some((cell) => String(cell).includes("Do not enter or edit a project UUID")))).toBe(true);
  });

  it("parses typed scalar and dynamic JSON values without making persistence decisions", () => {
    const base64 = base64Workbook([
      ["Field", "Description", "Value"],
      ["noUpdates", "No updates?", "Yes"],
      ["narrative", "Final assessment", "Ready"],
      ["manpower", "Dynamic manpower rows", '[{"department":"Quality","count":4,"approvalRequired":false,"approved":0,"rejected":0}]'],
    ]);
    const result = parseQaqcReportingWorkbook({ reportType: "monthly", base64, validate });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      noUpdates: true,
      narrative: "Ready",
      manpower: [{ department: "Quality", count: 4, approvalRequired: false, approved: 0, rejected: 0 }],
    });
  });

  it("imports human-editable repeated rows from monthly and daily dynamic worksheets", () => {
    const monthly = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(monthly, XLSX.utils.aoa_to_sheet([
      ["Field", "Description", "Value"], ["narrative", "Assessment", "Complete"],
    ]), "Report Data");
    XLSX.utils.book_append_sheet(monthly, XLSX.utils.aoa_to_sheet([
      ["Type", "Last meeting date (YYYY-MM-DD)", "Next meeting date (YYYY-MM-DD)"],
      ["Internal Meeting", "2026-08-01", "2026-09-01"],
    ]), "Meetings");
    XLSX.utils.book_append_sheet(monthly, XLSX.utils.aoa_to_sheet([
      ["Department", "Headcount", "Client approval required (Yes/No)", "Approved", "Rejected"],
      ["Quality", 3, "Yes", 2, 1],
    ]), "Manpower");
    const monthlyBytes = XLSX.write(monthly, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const monthlyResult = parseQaqcReportingWorkbook({
      reportType: "monthly", base64: monthlyBytes.toString("base64"), validate: () => [],
    });
    expect(monthlyResult.data.meetings).toEqual([{ type: "Internal Meeting", lastDate: "2026-08-01", nextDate: "2026-09-01" }]);
    expect(monthlyResult.data.manpower).toEqual([{ department: "Quality", count: 3, approvalRequired: true, approved: 2, rejected: 1 }]);

    const daily = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(daily, XLSX.utils.aoa_to_sheet([["Field", "Description", "Value"]]), "Report Data");
    XLSX.utils.book_append_sheet(daily, XLSX.utils.aoa_to_sheet([
      ["Document type (Drawings or Submittals)", "Revision name (e.g. Rev 00)", "Approved status count"],
      ["Drawings", "Rev 00", 7],
    ]), "Revisions");
    const dailyResult = parseQaqcReportingWorkbook({
      reportType: "daily", base64: (XLSX.write(daily, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64"),
      validate: () => [],
    });
    expect(dailyResult.data.revisions).toEqual({ drawings: [{ name: "Rev 00", value: 7 }], submittals: [] });
  });

  it("returns worksheet and row-specific errors for malformed, duplicate, and unrecognized fields", () => {
    const base64 = base64Workbook([
      ["Field", "Description", "Value"],
      ["noUpdates", "", "maybe"],
      ["notAField", "", "value"],
      ["narrative", "", "One"],
      ["narrative", "", "Two"],
    ]);
    const result = parseQaqcReportingWorkbook({ reportType: "monthly", base64, validate });
    expect(result.errors.map((error) => [error.sheet, error.row, error.field])).toEqual([
      ["Report Data", 2, "noUpdates"],
      ["Report Data", 3, "notAField"],
      ["Report Data", 5, "narrative"],
    ]);
  });

  it("rejects missing required sheets and invalid workbook base64 before import preview", () => {
    expect(parseQaqcReportingWorkbook({
      reportType: "daily", base64: base64Workbook([["x"]], "Other"), validate: () => [],
    }).errors[0]?.message).toMatch(/worksheet is missing/);
    expect(() => parseQaqcReportingWorkbook({ reportType: "csat", base64: "not a workbook", validate: () => [] }))
      .toThrow(/base64-encoded/);
  });
});