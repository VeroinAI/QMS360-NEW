import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildTemplateFile, parseImportFile } from "./source-sync";

const template = {
  entity: "projects", name: "Project dates",
  columns: [
    { header: "Start Date", field: "custom_fields.startDate", required: true },
    { header: "Name", field: "name", required: true },
  ],
};

function workbookBytes(headers: string[], values: unknown[], date1904 = false) {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904 } };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, values]), "Template");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("integration Excel date boundaries", () => {
  it("annotates date columns without changing non-date headers", () => {
    const file = buildTemplateFile(template);
    const book = XLSX.read(Buffer.from(file.contentBase64, "base64"), { type: "buffer" });
    expect(XLSX.utils.sheet_to_json(book.Sheets.Template, { header: 1, blankrows: false }))
      .toEqual([["Start Date (DD/MM/YYYY)", "Name"]]);
  });
  it.each(["Start Date", "Start Date (DD/MM/YYYY)", "Start Date (YYYY-MM-DD)"])(
    "loads day-first dates from %s and keeps names untouched", header => {
      expect(parseImportFile(workbookBytes([header, "Name"], ["04/05/2026", "2026-05-04"]), template))
        .toEqual([{ "custom_fields.startDate": "2026-05-04", name: "2026-05-04" }]);
    },
  );
  it("accepts older ISO dates", () => {
    expect(parseImportFile(workbookBytes(["Start Date", "Name"], ["2026-05-04", "Project"]), template)[0]["custom_fields.startDate"])
      .toBe("2026-05-04");
  });
  it("honors a date heading when the custom field name does not identify its type", () => {
    const custom = { columns: [{ header: "Go-live Date", field: "custom_fields.goLive", required: true }] };
    expect(parseImportFile(workbookBytes(["Go-live Date"], ["04/05/2026"]), custom))
      .toEqual([{ "custom_fields.goLive": "2026-05-04" }]);
  });
  it("reads native dates from a 1904 workbook", () => {
    expect(parseImportFile(workbookBytes(["Start Date", "Name"], [0, "Project"], true), template)[0]["custom_fields.startDate"])
      .toBe("1904-01-01");
  });
  it("rejects impossible dates with row feedback before returning import rows", () => {
    expect(() => parseImportFile(workbookBytes(["Start Date", "Name"], ["31/02/2026", "Project"]), template))
      .toThrow("Row 2: custom_fields.startDate: enter a valid date as DD/MM/YYYY");
  });
});