import { describe, expect, it } from "vitest";
import { reportDepartmentReferences } from "./qaqc-reporting-department-policy";

describe("Metrics entry department policy", () => {
  const data = {
    manpower: [{ department: "A user-defined department" }],
    metrics: { external_ncr: { ageing: [{ department: "Quality" }] }, internal_ncr: { ageing: [{ department: "Safety" }] } },
  };
  it("preserves all legacy monthly master-data checks", () => {
    expect(reportDepartmentReferences("monthly", data)).toEqual(["A user-defined department", "Quality", "Safety"]);
  });
  it("allows text manpower only for the new entry mode, keeping NCR checks", () => {
    expect(reportDepartmentReferences("monthly", { ...data, manpowerDepartmentInput: "text" })).toEqual(["Quality", "Safety"]);
  });
  it("does not opt out for unknown or boolean mode flags", () => {
    expect(reportDepartmentReferences("monthly", { ...data, manpowerDepartmentInput: true })).toHaveLength(3);
  });
  it("does not add department checks to daily or CSAT", () => {
    expect(reportDepartmentReferences("daily", data)).toEqual([]);
    expect(reportDepartmentReferences("csat", data)).toEqual([]);
  });
});