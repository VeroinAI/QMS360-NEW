import { describe, expect, it } from "vitest";
import { reportDepartmentReferences, reportDisciplineReferences } from "./qaqc-reporting-department-policy";

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
  it("checks new master selections while retaining old free-text manpower", () => {
    expect(reportDepartmentReferences("monthly", { ...data, manpowerDepartmentInput: "text",
      manpower: [...data.manpower, { department: "QUALITY", departmentSource: "master" }],
    })).toEqual(["QUALITY", "Quality", "Safety"]);
  });
  it("does not add department checks to daily or CSAT", () => {
    expect(reportDepartmentReferences("daily", data)).toEqual([]);
    expect(reportDepartmentReferences("csat", data)).toEqual([]);
  });
  it("validates new manpower against Discipline Master, leaving NCR department checks unchanged", () => {
    const report = { ...data, manpower: [{ department: "CIV", departmentSource: "discipline_master" }] };
    expect(reportDepartmentReferences("monthly", report)).toEqual(["Quality", "Safety"]);
    expect(reportDisciplineReferences("monthly", report)).toEqual(["CIV"]);
    expect(reportDisciplineReferences("daily", report)).toEqual([]);
    expect(reportDisciplineReferences("csat", report)).toEqual([]);
  });
  it("keeps legacy Department Master and free-text entries distinct from discipline selections", () => {
    const report = { ...data, manpowerDepartmentInput: "text", manpower: [
      { department: "QUALITY", departmentSource: "master" },
      { department: "Legacy free text" },
      { department: "CIV", departmentSource: "discipline_master" },
    ] };
    expect(reportDepartmentReferences("monthly", report)).toEqual(["QUALITY", "Quality", "Safety"]);
    expect(reportDisciplineReferences("monthly", report)).toEqual(["CIV"]);
  });
});