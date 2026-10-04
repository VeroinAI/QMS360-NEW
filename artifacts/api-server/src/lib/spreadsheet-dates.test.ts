import { describe, expect, it } from "vitest";
import {
  formatSpreadsheetData, formatSpreadsheetDate, isSpreadsheetDateField,
  parseSpreadsheetData, parseSpreadsheetDate,
} from "@workspace/spreadsheet-dates";

describe("spreadsheet calendar dates", () => {
  it.each([
    ["04/05/2026", "2026-05-04"], ["05/04/2026", "2026-04-05"],
    ["31/12/2026", "2026-12-31"], ["29/02/2024", "2024-02-29"],
    ["2026-10-01", "2026-10-01"], [" 01/10/2026 ", "2026-10-01"],
  ])("parses %s without month/day ambiguity", (raw, expected) => {
    expect(parseSpreadsheetDate(raw)).toBe(expected);
  });
  it.each(["29/02/2026", "31/04/2026", "12/31/2026", "01/13/2026", "00/01/2026", "1/2/2026", "2026-02-30", "", "bad", 60, -1, NaN, Infinity])(
    "rejects impossible or unsupported dates: %s", raw => expect(parseSpreadsheetDate(raw)).toBeNull(),
  );
  it("supports native Excel dates in both date systems without timezone offsets", () => {
    expect(parseSpreadsheetDate(1)).toBe("1900-01-01");
    expect(parseSpreadsheetDate(59)).toBe("1900-02-28");
    expect(parseSpreadsheetDate(61)).toBe("1900-03-01");
    expect(parseSpreadsheetDate(0, { date1904: true })).toBe("1904-01-01");
    expect(parseSpreadsheetDate(1, { date1904: true })).toBe("1904-01-02");
    expect(parseSpreadsheetDate(new Date("2026-10-04T00:00:00.000Z"))).toBe("2026-10-04");
  });
  it.each(["2026-10-04", "2026-10-04T23:59:59.999Z", "2026-10-04T23:59:59+05:30"])(
    "formats date components consistently: %s", raw => expect(formatSpreadsheetDate(raw)).toBe("04/10/2026"),
  );
  it("does not alter non-date fields or mutate the source record", () => {
    const source = {
      period: "2026-10-01", createdAt: "2026-10-04T14:00:00.000Z",
      title: "2026-10-04", reference: "2026-10-04", candidate: "2026-10-04", count: 45,
      data: { meetings: [{ lastDate: "2026-10-03" }], remarks: "2026-10-03" },
      history: [{ at: "2026-10-04T14:00:00.000Z" }],
    };
    const result = formatSpreadsheetData(source);
    expect(result.period).toBe("01/10/2026");
    expect(result.createdAt).toBe("04/10/2026");
    expect(result.title).toBe(source.title);
    expect(result.reference).toBe(source.reference);
    expect(result.candidate).toBe(source.candidate);
    expect(result.count).toBe(45);
    expect(result.data.meetings[0].lastDate).toBe("03/10/2026");
    expect(result.data.remarks).toBe("2026-10-03");
    expect(result.history[0].at).toBe("04/10/2026");
    expect(source.data.meetings[0].lastDate).toBe("2026-10-03");
  });
  it("normalizes nested JSON date fields and preserves unrelated metrics", () => {
    expect(parseSpreadsheetData({ internalAudit: { lastDate: "04/05/2026", nextDate: "05/06/2026", count: 5 } }))
      .toEqual({ internalAudit: { lastDate: "2026-05-04", nextDate: "2026-06-05", count: 5 } });
    expect(() => parseSpreadsheetData({ lastDate: "31/02/2026" })).toThrow("DD/MM/YYYY");
  });
  it.each(["plannedStartDate", "custom_fields.joining_date", "feasibilityRecordedAt", "dateOfOccurrence", "Submitted at (DD/MM/YYYY)"])(
    "recognizes date field %s", field => expect(isSpreadsheetDateField(field)).toBe(true),
  );
});