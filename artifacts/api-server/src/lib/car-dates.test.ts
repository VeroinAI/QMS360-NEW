import { describe, expect, it } from "vitest";
import { carDueDate, hasSavedCarResponse } from "./car-dates";

describe("CAR classification deadlines", () => {
  it.each([["Major NC", "2026-10-24"], ["Minor NC", "2026-10-25"], ["OFI", "2026-10-26"]])(
    "%s is based on creation plus calendar days", (type, expected) => {
      expect(carDueDate(type, "2026-10-22T12:00:00Z")).toBe(expected);
    });
  it("handles month/year boundaries and leap days", () => {
    expect(carDueDate("Major NC", "2026-12-31T12:00:00Z")).toBe("2027-01-02");
    expect(carDueDate("Minor NC", "2028-02-27T12:00:00Z")).toBe("2028-03-01");
  });
  it("uses the local calendar creation date and preserves original creation time", () => {
    const created = new Date("2026-10-22T22:00:00Z");
    expect(carDueDate("Major NC", created)).toBe("2026-10-25");
    expect(created.toISOString()).toBe("2026-10-22T22:00:00.000Z");
  });
  it("does not invent a Moderate NC or Observation rule", () => {
    expect(carDueDate("Moderate NC", "2026-10-22")).toBeNull();
    expect(carDueDate("Observation", "2026-10-22", "2026-11-01")).toBe("2026-11-01");
  });
  it("rejects missing or invalid creation dates for a calculated deadline", () => {
    expect(carDueDate("Major NC", null)).toBeNull();
    expect(carDueDate("Major NC", "invalid")).toBeNull();
  });
  it("does not number an unanswered shell", () => {
    expect(hasSavedCarResponse({ workflowState: "open" })).toBe(false);
    expect(hasSavedCarResponse({ workflowState: "submitted" })).toBe(true);
    expect(hasSavedCarResponse({ workflowState: "open", correctiveAction: "Saved legacy response" })).toBe(true);
  });
});
