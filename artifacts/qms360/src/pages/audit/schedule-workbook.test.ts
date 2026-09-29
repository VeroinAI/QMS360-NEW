import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { AuditSchedule } from "@workspace/api-client-react";
import { createScheduleWorkbook, resolveScheduleProject, scheduleFieldForHeader, scheduleImportHeaders } from "./schedule-workbook";

const options = {
  auditTypes: [{ value: "Quality Internal Process Audit", label: "Quality Internal Process Audit" }],
  auditCategories: [{ value: "Internal", label: "Internal" }],
  departments: [{ value: "Operations", label: "Operations" }],
  projects: [{ id: "project-1", code: "PR-1", name: "Plant A" }, { id: "project-2", code: "PR-2", name: "Plant B" }],
  processOwners: [{ value: "Eligible Owner", label: "Eligible Owner" }],
};

describe("audit schedule spreadsheet", () => {
  it("writes headers and usable dropdowns even when there are no schedules", async () => {
    const workbook = await createScheduleWorkbook([], options);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    const sheet = reopened.getWorksheet("Audit Schedules")!;
    expect(sheet.getRow(1).values?.slice(1)).toEqual(scheduleImportHeaders);
    expect(sheet.getCell("G1").value).toBe("From Date (YYYY-MM-DD)");
    expect(sheet.getCell("H1").value).toBe("To Date (YYYY-MM-DD)");
    expect(sheet.getColumn(7).width).toBeGreaterThanOrEqual(24);
    expect(sheet.getColumn(8).width).toBeGreaterThanOrEqual(24);
    expect(sheet.getCell("A2").dataValidation.formulae).toEqual(["AuditTypes"]);
    expect(sheet.getCell("B2").dataValidation.formulae).toEqual(["AuditCategories"]);
    expect(sheet.getCell("C2").dataValidation.formulae).toEqual([
      'IF($A2="Quality Internal Process Audit",Departments,Projects)',
    ]);
    expect(sheet.getCell("F2").dataValidation.formulae).toEqual(["ProcessOwners"]);
    expect(sheet.getCell("E2").value).toBeNull();
    const upload = XLSX.read(bytes, { type: "array" });
    expect(XLSX.utils.sheet_to_json(upload.Sheets["Audit Schedules"], { defval: "" })).toHaveLength(0);
    expect(reopened.getWorksheet("Dropdown Values")?.state).toBe("veryHidden");
    expect(reopened.getWorksheet("Dropdown Values")?.getCell("A2").value).toBe("Quality Internal Process Audit");
    const projects = reopened.getWorksheet("Dropdown Values")!;
    expect(projects.getCell("D2").value).toBe("PR-1 — Plant A");
    expect(projects.getCell("D3").value).toBe("PR-2 — Plant B");
    expect(projects.getCell("E2").value).toBe("Eligible Owner");
    expect(projects.getCell("D4").value).toBeNull();
    expect(resolveScheduleProject(options.projects, "PR-1 — Plant A")?.id).toBe("project-1");
    expect(resolveScheduleProject(options.projects, "PR-1")?.id).toBe("project-1");
    expect(resolveScheduleProject(options.projects, "Plant A")?.id).toBe("project-1");
  });

  it("keeps existing schedule data and dropdowns on the next empty row", async () => {
    const row = {
      auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
      departmentProject: "Operations", title: "Plant review", location: "Site 1",
      processProductOwner: "Quality", plannedStartDate: "2026-10-01",
      plannedEndDate: "2026-10-02", remarks: "Check",
    } as AuditSchedule;
    const workbook = await createScheduleWorkbook([row], options);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    const sheet = reopened.getWorksheet("Audit Schedules")!;
    expect(sheet.getCell("E2").value).toBe("Plant review");
    expect(sheet.getCell("G2").value).toBe("2026-10-01");
    const loaded = XLSX.read(bytes, { type: "array" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(loaded.Sheets["Audit Schedules"]);
    expect(scheduleFieldForHeader("From Date (YYYY-MM-DD)")).toBe("plannedStartDate");
    expect(scheduleFieldForHeader("To Date (YYYY-MM-DD)")).toBe("plannedEndDate");
    expect(data[0]["From Date (YYYY-MM-DD)"]).toBe("2026-10-01");
    expect(data[0]["To Date (YYYY-MM-DD)"]).toBe("2026-10-02");
    expect(scheduleFieldForHeader("From Date")).toBe("plannedStartDate");
    expect(scheduleFieldForHeader("To Date")).toBe("plannedEndDate");
    expect(sheet.getCell("C3").dataValidation.formulae).toEqual([
      'IF($A3="Quality Internal Process Audit",Departments,Projects)',
    ]);
  });

  it("links the category dropdown to the selected type without offering old incompatible values", async () => {
    const linkedOptions = {
      ...options,
      auditTypes: [
        { value: "Quality Internal Process Audit", label: "Process" },
        { value: "Quality Internal Product Audit", label: "Product" },
        { value: "Unlinked Audit", label: "Unlinked" },
      ],
      auditCategories: [
        { value: "Business Unit", label: "Business Unit", metadata: { auditTypeValues: ["Quality Internal Process Audit"] } },
        { value: "Regional Office", label: "Regional Office", metadata: { auditTypeValues: ["Quality Internal Process Audit", "Quality Internal Product Audit"] } },
        { value: "Project", label: "Project", metadata: { auditTypeValues: ["Quality Internal Product Audit"] } },
        { value: "Old Category", label: "Old Category", metadata: {} },
      ],
    };
    const previous = {
      auditTypes: ["Quality Internal Product Audit"], auditCategory: "Old Category",
      departmentProject: "Plant A", title: "Older schedule",
      plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-02",
    } as AuditSchedule;
    const workbook = await createScheduleWorkbook([previous], linkedOptions);
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = reopened.getWorksheet("Audit Schedules")!;
    const lists = reopened.getWorksheet("Dropdown Values")!;

    expect(sheet.getCell("B2").value).toBe("Old Category");
    expect(sheet.getCell("B2").dataValidation.formulae).toEqual([
      'INDIRECT("AuditCategoryType"&MATCH($A2,AuditTypes,0))',
    ]);
    expect(sheet.getCell("B3").dataValidation.formulae).toEqual([
      'INDIRECT("AuditCategoryType"&MATCH($A3,AuditTypes,0))',
    ]);
    expect(lists.state).toBe("veryHidden");
    expect(lists.getCell("E2").value).toBe("Eligible Owner");
    expect(lists.getCell("E3").value).toBeNull();
    expect([lists.getCell("F2").value, lists.getCell("F3").value, lists.getCell("F4").value])
      .toEqual(["Business Unit", "Regional Office", null]);
    expect([lists.getCell("G2").value, lists.getCell("G3").value, lists.getCell("G4").value])
      .toEqual(["Regional Office", "Project", null]);
    expect(lists.getCell("H2").value).toBeNull();
    expect(reopened.definedNames.getRanges("AuditCategoryType1").ranges)
      .toEqual(["'Dropdown Values'!$F$2:$F$3"]);
    expect(reopened.definedNames.getRanges("AuditCategoryType2").ranges)
      .toEqual(["'Dropdown Values'!$G$2:$G$3"]);
    expect(reopened.definedNames.getRanges("AuditCategoryType3").ranges)
      .toEqual(["'Dropdown Values'!$H$2"]);
    expect(reopened.getWorksheet("Instructions")?.getCell("B4").value).toContain("reselect the category");
  });

  it("exports an existing project as one code-and-name choice without duplicating its name", async () => {
    const row = {
      auditTypes: ["Quality Internal Product Audit"], auditCategory: "Internal",
      departmentProject: "Plant A", projectIds: ["project-1"], title: "Product audit",
      processProductOwner: "Quality", plannedStartDate: "2026-10-01",
      plannedEndDate: "2026-10-02",
    } as AuditSchedule;
    const workbook = await createScheduleWorkbook([row], options);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    expect(reopened.getWorksheet("Audit Schedules")?.getCell("C2").value).toBe("PR-1 — Plant A");
    const projects = reopened.getWorksheet("Dropdown Values")!;
    expect(projects.getCell("D2").value).toBe("PR-1 — Plant A");
    expect(projects.getCell("D3").value).toBe("PR-2 — Plant B");
    expect(projects.getCell("D4").value).toBeNull();
    const loaded = XLSX.read(bytes, { type: "array" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(loaded.Sheets["Audit Schedules"]);
    expect(resolveScheduleProject(options.projects, data[0]["Department / Project"])?.id).toBe("project-1");
  });
});