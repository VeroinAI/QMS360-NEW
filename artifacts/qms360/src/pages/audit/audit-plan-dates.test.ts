import { describe, expect, it } from "vitest";
import { auditPlanDateFields, getAuditPlanDateRange, validateAuditPlanDates } from "@workspace/field-controls";

const from = "2026-10-04"; const to = "2026-10-06";
describe("Audit Plan date boundaries", () => {
  it("uses the exact child audit range and includes both complete boundary days", () => {
    expect(getAuditPlanDateRange(from, to)).toEqual({
      from, to, label: "04/10/2026 to 06/10/2026 (inclusive)",
      min: "2026-10-04T00:00", max: "2026-10-06T23:59",
    });
    for (const value of ["2026-10-04T00:00", "2026-10-06T23:59:59.999Z"]) {
      expect(validateAuditPlanDates(Object.fromEntries(auditPlanDateFields.map(field => [field.key, value])), from, to)).toEqual({});
    }
  });
  it.each(auditPlanDateFields)("rejects early and late values for $label with the date range", ({ key, label }) => {
    for (const value of ["2026-10-03T23:59", "2026-10-07T00:00"]) {
      const errors = validateAuditPlanDates({ [key]: value }, from, to);
      expect(errors[key]).toContain(label);
      expect(errors[key]).toContain("04/10/2026 to 06/10/2026");
    }
  });
  it("handles missing ranges, invalid calendar dates, and native Date values explicitly", () => {
    expect(getAuditPlanDateRange(`${from}T00:00:00.000Z`, new Date(`${to}T00:00:00Z`))?.label).toBe("04/10/2026 to 06/10/2026 (inclusive)");
    expect(validateAuditPlanDates({}, "", to).scheduleId).toContain("From Date and To Date");
    expect(getAuditPlanDateRange("2026-02-30", to)).toBeNull();
    expect(validateAuditPlanDates({ startDateTime: "2026-02-30T10:00" }, "2026-02-01", "2026-03-05").startDateTime).toContain("valid date");
    expect(validateAuditPlanDates({ startDateTime: new Date("2026-10-04T00:00:00Z") }, from, to)).toEqual({});
  });
  it("does not shift naive local calendar dates across the boundary", () => {
    expect(validateAuditPlanDates({ startDateTime: "2026-10-04T00:05" }, from, to)).toEqual({});
    expect(validateAuditPlanDates({ startDateTime: "2026-10-06T23:59" }, from, to)).toEqual({});
  });
});