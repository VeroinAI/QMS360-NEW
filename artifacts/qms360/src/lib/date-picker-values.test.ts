import { describe, expect, it } from "vitest";
import { calendarPickerValue, pickerTimeBounds } from "./date-picker-values";

const day = new Date(2026, 9, 9, 12);
describe("QMS360 date and time picker contracts", () => {
  it("returns only a date for date-only fields, even if the old value contains time", () => {
    expect(calendarPickerValue(day, false, "2026-10-08T18:15")).toBe("2026-10-09");
  });
  it("preserves the selected time when choosing another calendar date", () => {
    expect(calendarPickerValue(day, true, "2026-10-08T18:15")).toBe("2026-10-09T18:15");
  });
  it("provides a complete date/time value when selecting the first date", () => {
    expect(calendarPickerValue(day, true, null)).toBe("2026-10-09T00:00");
  });
  it("uses minimum and maximum times only on their matching calendar dates", () => {
    expect(pickerTimeBounds("2026-10-09", "2026-10-09T10:30", "2026-10-10T18:15"))
      .toEqual({ min: "10:30", max: undefined });
    expect(pickerTimeBounds("2026-10-10", "2026-10-09T10:30", "2026-10-10T18:15"))
      .toEqual({ min: undefined, max: "18:15" });
    expect(pickerTimeBounds("2026-10-11", "2026-10-09T10:30", "2026-10-10T18:15"))
      .toEqual({ min: undefined, max: undefined });
  });
  it("does not invent time limits for date-only boundaries", () => {
    expect(pickerTimeBounds("2026-10-09", "2026-10-09", "2026-10-09")).toEqual({ min: undefined, max: undefined });
  });
  it("moves a preserved time forward to the lower boundary", () => {
    expect(calendarPickerValue(day, true, "2026-10-08T08:15", "2026-10-09T10:30")).toBe("2026-10-09T10:30");
  });
  it("moves a preserved time back to the upper boundary", () => {
    expect(calendarPickerValue(day, true, "2026-10-08T18:15", undefined, "2026-10-09T16:30")).toBe("2026-10-09T16:30");
  });
});
