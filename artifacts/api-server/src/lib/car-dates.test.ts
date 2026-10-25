import { describe, expect, it } from "vitest";
import { carDueDate, findingDateValue, validFindingDate, hasSavedCarResponse } from "./car-dates";

describe("CAR classification deadlines", () => {
  it.each([["Major NC", "2026-10-24"], ["Minor NC", "2026-10-25"], ["OFI", "2026-10-26"]])(
    "%s is based on Finding Date plus calendar days", (type, expected) => {
      expect(carDueDate(type, "2026-10-22")).toBe(expected);
    });
  it("handles month/year boundaries and leap days", () => {
    expect(carDueDate("Major NC", "2026-12-31")).toBe("2027-01-02");
    expect(carDueDate("Minor NC", "2028-02-27")).toBe("2028-03-01");
  });
  it("does not accept CAR timestamps as a substitute for Finding Date", () => {
    expect(carDueDate("Major NC", new Date("2026-10-22T22:00:00Z"))).toBeNull();
    expect(carDueDate("Major NC", "2026-10-22T22:00:00Z")).toBeNull();
    expect(carDueDate("Major NC", "2026-10-22", "2026-12-01")).toBe("2026-10-24");
  });
  it("does not invent a Moderate NC or Observation rule", () => {
    expect(carDueDate("Moderate NC", "2026-10-22")).toBeNull();
    expect(carDueDate("Observation", "2026-10-22", "2026-11-01")).toBe("2026-11-01");
  });
  it("preserves historical saved deadlines until an actual Finding Date is recorded", () => {
    expect(carDueDate("Major NC", null, "2026-11-01")).toBe("2026-11-01");
    expect(carDueDate("Major NC", null)).toBeNull();
    expect(carDueDate("Major NC", "invalid")).toBeNull();
  });
  it("validates actual calendar dates and reads checklist dates before legacy evidence", () => {
    for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "", "22-10-2026"]) expect(validFindingDate(value)).toBe(false);
    expect(validFindingDate("2028-02-29")).toBe(true);
    const finding = { evidence: { findingDate: "2026-10-01" } };
    expect(findingDateValue({ findingDate: "2026-10-22" }, finding)).toBe("2026-10-22");
    expect(findingDateValue(null, finding)).toBe("2026-10-01");
  });
  it("does not number an unanswered shell", () => {
    expect(hasSavedCarResponse({ workflowState: "open" })).toBe(false);
    expect(hasSavedCarResponse({ workflowState: "submitted" })).toBe(true);
    expect(hasSavedCarResponse({ workflowState: "open", correctiveAction: "Saved legacy response" })).toBe(true);
  });
});
