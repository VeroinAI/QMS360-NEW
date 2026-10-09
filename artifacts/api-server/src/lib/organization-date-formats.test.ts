import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  DATE_FORMATS, detectSpreadsheetDateOptions, formatDate, formatDateTime, formatPresentationData,
  getDateFormat, getExcelDateNumberFormat, parseSpreadsheetDate,
} from "@workspace/spreadsheet-dates";
import { applyExcelDateFormats, spreadsheetWorkbookDateOptions } from "./excel-date-cells";
import { invalidateOrganizationDateFormat, withOrganizationDateFormat } from "./date-format";

const { limit } = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
  organizationSettings: { organizationId: "organizationId", branding: "branding", deletedAt: "deletedAt" },
}));
afterEach(() => { limit.mockReset(); });

describe("organization date formats", () => {
  it.each([
    ["DD/MM/YYYY", "03/04/2026"], ["MM/DD/YYYY", "04/03/2026"], ["YYYY-MM-DD", "2026-04-03"],
    ["DD-MM-YYYY", "03-04-2026"], ["MM-DD-YYYY", "04-03-2026"],
  ] as const)("round-trips %s without changing its calendar date", (dateFormat, display) => {
    expect(formatDate("2026-04-03", dateFormat)).toBe(display);
    expect(parseSpreadsheetDate(display, { dateFormat })).toBe("2026-04-03");
    expect(parseSpreadsheetDate("2026-04-03", { dateFormat })).toBe("2026-04-03");
    expect(formatDateTime("2026-04-03T12:30:45Z", dateFormat, "UTC")).toBe(`${display} 12:30:45`);
  });

  it("does not guess ambiguous slash dates or accept impossible calendar dates", () => {
    expect(parseSpreadsheetDate("03/04/2026", { dateFormat: "DD/MM/YYYY" })).toBe("2026-04-03");
    expect(parseSpreadsheetDate("03/04/2026", { dateFormat: "MM/DD/YYYY" })).toBe("2026-03-04");
    expect(parseSpreadsheetDate("31/02/2026", { dateFormat: "DD/MM/YYYY" })).toBeNull();
    expect(parseSpreadsheetDate("02/29/2026", { dateFormat: "MM/DD/YYYY" })).toBeNull();
    expect(parseSpreadsheetDate("03/04/2026", { dateFormat: "DD-MM-YYYY" })).toBeNull();
    expect(parseSpreadsheetDate("02/29/2024", { dateFormat: "MM/DD/YYYY" })).toBe("2024-02-29");
  });

  it("respects an older workbook declaration and rejects conflicting declarations", () => {
    expect(detectSpreadsheetDateOptions(["From date (DD/MM/YYYY)"], { dateFormat: "MM/DD/YYYY" }).dateFormat).toBe("DD/MM/YYYY");
    expect(() => detectSpreadsheetDateOptions(["From date (DD/MM/YYYY)", "To date (MM/DD/YYYY)"])).toThrow("conflicting");
  });

  it("keeps native Excel date systems and the fake 1900 leap day correct", () => {
    expect(parseSpreadsheetDate(0, { date1904: true, dateFormat: "MM/DD/YYYY" })).toBe("1904-01-01");
    expect(parseSpreadsheetDate(60, { date1904: false })).toBeNull();
    expect(parseSpreadsheetDate(61, { dateFormat: "YYYY-MM-DD" })).toBe("1900-03-01");
  });

  it.each(DATE_FORMATS)("serializes native and blank XLSX date cells in %s", async dateFormat => {
    const org = `excel-${dateFormat}`;
    invalidateOrganizationDateFormat(org);
    limit.mockResolvedValueOnce([{ branding: { dateFormat } }]);
    await withOrganizationDateFormat(org, () => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ["Date (DD/MM/YYYY)", "Title"], ["2026-04-03", "Do not rewrite 2026-04-03"], ["", "Blank"],
      ]), "Records");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Date format", "DD/MM/YYYY"]]), "Instructions");
      applyExcelDateFormats(book);
      const saved = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx", sheetStubs: true }), { cellNF: true, sheetStubs: true });
      expect(saved.Sheets.Records.A1.v).toBe(`Date (${dateFormat})`);
      expect(saved.Sheets.Records.A2.t).toBe("n");
      expect(saved.Sheets.Records.A2.z).toBe(getExcelDateNumberFormat(dateFormat));
      expect(parseSpreadsheetDate(saved.Sheets.Records.A2.v)).toBe("2026-04-03");
      expect(saved.Sheets.Records.B2.v).toBe("Do not rewrite 2026-04-03");
      expect(saved.Sheets.Records.A3?.v ?? "").toBe("");
      expect(saved.Sheets.Records.A3?.z).toBe(getExcelDateNumberFormat(dateFormat));
      expect(spreadsheetWorkbookDateOptions(saved).dateFormat).toBe(dateFormat);
    });
  });

  it("keeps concurrent organizations isolated across asynchronous export work", async () => {
    limit.mockResolvedValueOnce([{ branding: { dateFormat: "DD/MM/YYYY" } }]);
    limit.mockResolvedValueOnce([{ branding: { dateFormat: "MM/DD/YYYY" } }]);
    const [dayFirst, monthFirst] = await Promise.all([
      withOrganizationDateFormat("concurrent-day-first", async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
        return formatDate("2026-04-03");
      }),
      withOrganizationDateFormat("concurrent-month-first", async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return formatDate("2026-04-03");
      }),
    ]);
    expect(dayFirst).toBe("03/04/2026");
    expect(monthFirst).toBe("04/03/2026");
    expect(getDateFormat()).toBe("DD/MM/YYYY");
  });

  it("preserves PDF timestamp times and ordinary text without changing source data", async () => {
    limit.mockResolvedValueOnce([{ branding: { dateFormat: "MM/DD/YYYY" } }]);
    await withOrganizationDateFormat("presentation-month-first", () => {
      const input = { submittedAt: "2026-04-03T12:30:45Z", reportFrom: "2026-04-03", title: "2026-04-03", count: 3 };
      const output = formatPresentationData(input);
      expect(output.reportFrom).toBe("04/03/2026");
      expect(output.submittedAt).toMatch(/^04\/03\/2026 \d{2}:\d{2}:45$/);
      expect(output.title).toBe("2026-04-03");
      expect(output.count).toBe(3);
      expect(input.reportFrom).toBe("2026-04-03");
      expect(formatPresentationData({ startDateTime: "2026-04-03T00:30:00+03:00" }).startDateTime).toBe("04/03/2026 00:30:00");
    });
  });
});
