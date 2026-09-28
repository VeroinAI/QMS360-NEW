import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { AuditSchedule } from "@workspace/api-client-react";
import { createScheduleWorkbook, resolveScheduleProject, scheduleImportHeaders } from "./schedule-workbook";

const options = {
  auditTypes: [{ value: "Quality Internal Process Audit", label: "Quality Internal Process Audit" }],
  auditCategories: [{ value: "Internal", label: "Internal" }],
  departments: [{ value: "Operations", label: "Operations" }],
  projects: [{ id: "project-1", code: "PR-1", name: "Plant A" }, { id: "project-2", code: "PR-2", name: "Plant B" }],
  processOwners: [{ value: "Quality", label: "Quality" }],
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
    expect(sheet.getCell("C3").dataValidation.formulae).toEqual([
      'IF($A3="Quality Internal Process Audit",Departments,Projects)',
    ]);
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