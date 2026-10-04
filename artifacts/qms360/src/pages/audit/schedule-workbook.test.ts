import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { AuditSchedule } from "@workspace/api-client-react";
import { createScheduleWorkbook, resolveScheduleProject, scheduleCategoryLinkError, scheduleFieldForHeader, scheduleImportHeaders } from "./schedule-workbook";

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
    expect(sheet.getCell("G1").value).toBe("From Date (DD/MM/YYYY)");
    expect(sheet.getCell("H1").value).toBe("To Date (DD/MM/YYYY)");
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
    expect(sheet.getCell("G2").value).toBe("01/10/2026");
    expect(sheet.getCell("G2").numFmt).toBe("dd/mm/yyyy");
    const loaded = XLSX.read(bytes, { type: "array" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(loaded.Sheets["Audit Schedules"]);
    expect(scheduleFieldForHeader("From Date (YYYY-MM-DD)")).toBe("plannedStartDate");
    expect(scheduleFieldForHeader("To Date (YYYY-MM-DD)")).toBe("plannedEndDate");
    expect(data[0]["From Date (DD/MM/YYYY)"]).toBe("01/10/2026");
    expect(data[0]["To Date (DD/MM/YYYY)"]).toBe("02/10/2026");
    expect(scheduleFieldForHeader("From Date (DD/MM/YYYY)")).toBe("plannedStartDate");
    expect(scheduleFieldForHeader("To Date (DD/MM/YYYY)")).toBe("plannedEndDate");
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
      'INDIRECT(IFERROR(VLOOKUP($A2,AuditCategoryMap,2,FALSE),"EmptyAuditCategories"))',
    ]);
    expect(sheet.getCell("B3").dataValidation.formulae).toEqual([
      'INDIRECT(IFERROR(VLOOKUP($A3,AuditCategoryMap,2,FALSE),"EmptyAuditCategories"))',
    ]);
    expect(lists.state).toBe("veryHidden");
    expect(lists.getCell("E2").value).toBe("Eligible Owner");
    expect(lists.getCell("E3").value).toBeNull();
    expect([lists.getCell("I2").value, lists.getCell("I3").value, lists.getCell("I4").value])
      .toEqual(["Business Unit", "Regional Office", null]);
    expect([lists.getCell("J2").value, lists.getCell("J3").value, lists.getCell("J4").value])
      .toEqual(["Regional Office", "Project", null]);
    expect(lists.getCell("H4").value).toBe("EmptyAuditCategories");
    expect(reopened.definedNames.getRanges("EmptyAuditCategories").ranges).toEqual(["'Dropdown Values'!$G$5"]);
    expect(lists.getCell("G5").value).toBeNull();
    expect(reopened.definedNames.getRanges("ScheduleCategories1").ranges)
      .toEqual(["'Dropdown Values'!$I$2:$I$3"]);
    expect(reopened.definedNames.getRanges("ScheduleCategories2").ranges)
      .toEqual(["'Dropdown Values'!$J$2:$J$3"]);
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

  it("keeps unrestricted categories when links are absent, including historical values", async () => {
    const row = {
      auditTypes: ["Process"], auditCategory: "Historical", title: "Existing",
      plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-02",
    } as AuditSchedule;
    const workbook = await createScheduleWorkbook([row], {
      ...options, auditTypes: [{ value: "Process", label: "Process" }],
      auditCategories: [{ value: "Current", label: "Current", metadata: {} }],
    });
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(reopened.getWorksheet("Audit Schedules")!.getCell("B2").value).toBe("Historical");
    expect(reopened.getWorksheet("Audit Schedules")!.getCell("B3").dataValidation.formulae).toEqual(["AuditCategories"]);
    expect(reopened.getWorksheet("Dropdown Values")!.getCell("B3").value).toBe("Historical");
    expect(scheduleCategoryLinkError([{ value: "Current", label: "Current" }], ["Process"], "Historical")).toBeNull();
  });

  it("maps a multi-type export only to categories linked to every type", async () => {
    const categories = [
      { value: "Process only", label: "Process only", metadata: { auditTypeValues: ["Process"] } },
      { value: "Shared", label: "Shared", metadata: { auditTypeValues: ["Process", "Product"] } },
      { value: "Product only", label: "Product only", metadata: { auditTypeValues: ["Product"] } },
    ];
    const row = {
      auditTypes: ["Process", "Product"], auditCategory: "Shared", title: "Combined",
      plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-02",
    } as AuditSchedule;
    const workbook = await createScheduleWorkbook([row], {
      ...options, auditTypes: ["Process", "Product"].map(value => ({ value, label: value })),
      auditCategories: categories,
    });
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = reopened.getWorksheet("Audit Schedules")!;
    const lists = reopened.getWorksheet("Dropdown Values")!;
    expect(sheet.getCell("A2").value).toBe("Process, Product");
    expect(sheet.getCell("B2").value).toBe("Shared");
    expect(lists.getCell("G4").value).toBe("Process, Product");
    expect(lists.getCell("H4").value).toBe("ScheduleCategories3");
    expect(reopened.definedNames.getRanges("ScheduleCategories3").ranges).toEqual(["'Dropdown Values'!$K$2"]);
    expect(lists.getCell("K2").value).toBe("Shared");
    expect(lists.getCell("K3").value).toBeNull();
    expect(scheduleCategoryLinkError(categories, row.auditTypes, "Shared")).toBeNull();
    expect(scheduleCategoryLinkError(categories, row.auditTypes, "Process only")).toContain("Product");
  });
});