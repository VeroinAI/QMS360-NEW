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
  it("documents DD/MM/YYYY in descriptions and instructions", () => {
    const workbook = XLSX.read(makeQaqcReportingTemplate("monthly"), { type: "buffer" });
    const descriptions = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Report Data"], { header: 1 }).flat().join(" ");
    const instructions = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Instructions, { header: 1 }).flat().join(" ");
    expect(descriptions).toContain("DD/MM/YYYY");
    expect(descriptions).not.toContain("YYYY-MM-DD");
    expect(instructions).toContain("DD/MM/YYYY");
  });

  it("normalizes day-first scalar, meeting and JSON dates to existing API dates", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Field", "Description", "Value"],
      ["pqpSubmittedDate", "", "04/05/2026"],
      ["reportFrom", "", "01/05/2026"],
      ["reportTo", "", "31/05/2026"],
      ["internalAudit", "", '{"conducted":true,"lastDate":"03/05/2026","nextDate":"03/06/2026"}'],
    ]), "Report Data");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Type", "Last meeting date (DD/MM/YYYY)", "Next meeting date (DD/MM/YYYY)"],
      ["Internal Meeting", "04/05/2026", "05/06/2026"],
    ]), "Meetings");
    const result = parseQaqcReportingWorkbook({
      reportType: "monthly",
      base64: (XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64"),
      validate: () => [],
    });
    expect(result.errors).toEqual([]);
    expect(result.data.pqpSubmittedDate).toBe("2026-05-04");
    expect(result.data.reportFrom).toBe("2026-05-01");
    expect(result.data.reportTo).toBe("2026-05-31");
    expect(result.data.internalAudit).toEqual({ conducted: true, lastDate: "2026-05-03", nextDate: "2026-06-03" });
    expect(result.data.meetings).toEqual([{ type: "Internal Meeting", lastDate: "2026-05-04", nextDate: "2026-06-05" }]);
  });

  it("rejects invalid calendar dates before persistence", () => {
    const result = parseQaqcReportingWorkbook({
      reportType: "monthly",
      base64: base64Workbook([["Field", "Description", "Value"], ["reportFrom", "", "31/02/2026"]]),
      validate: () => [],
    });
    expect(result.errors).toContainEqual({ sheet: "Report Data", row: 2, field: "reportFrom", message: "Enter a valid date as DD/MM/YYYY" });
    expect(result.data.reportFrom).toBeUndefined();
  });

  it("honors the workbook 1904 date system for native date values", () => {
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { WBProps: { date1904: true } };
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Field", "Description", "Value"], ["pqpSubmittedDate", "", 0],
    ]), "Report Data");
    const result = parseQaqcReportingWorkbook({
      reportType: "monthly",
      base64: (XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64"),
      validate: () => [],
    });
    expect(result.errors).toEqual([]);
    expect(result.data.pqpSubmittedDate).toBe("1904-01-01");
  });
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