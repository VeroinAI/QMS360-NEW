import { describe, expect, it } from "vitest";
import { carFindingDisplay, carLandingOptions, carPendingWith, carProjectDepartmentKey, carRegisterDates, matchesCarLandingFilters } from "./car-register-presentation";

const entry = { projectId: "p1", department: null, projectName: "Shared name", classification: "Major NC",
  status: "Submitted", riskLevel: "High", actionTakerId: "u1", actionTakerName: "Owner", car: { carNumber: "CAR-1" } };

describe("CAR register display and filters", () => {
  it("uses actual finding fields without substituting a department for Audit Area", () => {
    const departmentOnly = { responsibleDepartment: "Quality Department", evidence: {} };
    expect(carFindingDisplay({}, departmentOnly)).toEqual({ findingNumber: null, riskLevel: null, auditArea: "" });
    expect(carFindingDisplay({}, { evidence: { findingNumber: "FND-1", auditArea: "design_engg" }, riskLevel: "High" }))
      .toEqual({ findingNumber: "FND-1", riskLevel: "High", auditArea: "design_engg" });
    expect(carFindingDisplay({ findingNumber: "FND-2", riskLevel: "Medium", auditArea: "pmo" },
      { evidence: { findingNumber: "FND-1", auditArea: "design_engg" }, riskLevel: "High" }))
      .toEqual({ findingNumber: "FND-2", riskLevel: "Medium", auditArea: "pmo" });
  });
  it("combines all new server filters and preserves literal source identifiers", () => {
    const filters = { carNumber: "CAR-1", projectDepartment: "project:p1", findingType: "Major NC", riskLevel: "High", actionTakerId: "u1" };
    expect(matchesCarLandingFilters(entry, filters)).toBe(true);
    for (const key of Object.keys(filters)) {
      expect(matchesCarLandingFilters(entry, { ...filters, [key]: "other" })).toBe(false);
    }
    expect(matchesCarLandingFilters(entry, {})).toBe(true);
  });
  it("distinguishes department and project sources with identical names", () => {
    const department = { ...entry, projectId: null, department: "Shared name" };
    expect(carProjectDepartmentKey(department)).toBe("department:Shared name");
    const options = carLandingOptions([entry, department]);
    expect(options.projectDepartments).toHaveLength(2);
    expect(options.carNumbers).toEqual([{ id: "CAR-1", name: "CAR-1" }]);
    expect(matchesCarLandingFilters(department, { projectDepartment: "project:p1" })).toBe(false);
  });
  it("leaves unrecorded risk and unissued numbers out of selectable options", () => {
    const options = carLandingOptions([{ ...entry, riskLevel: null, car: undefined, actionTakerId: null }]);
    expect(options.riskLevels).toEqual([]);
    expect(options.carNumbers).toEqual([]);
    expect(options.actionTakers).toEqual([]);
    expect(options.statuses).toEqual([{ id: "Submitted", name: "Submitted" }]);
  });
  it("uses only recorded initial assignment and actual final closure dates", () => {
    expect(carRegisterDates()).toEqual({ assignedAt: null, actualClosedAt: null });
    expect(carRegisterDates({ createdAt: "2026-10-01T10:00:00Z", workflowState: "submitted", closedAt: "2026-10-02T10:00:00Z" }))
      .toEqual({ assignedAt: "2026-10-01T10:00:00Z", actualClosedAt: null });
    expect(carRegisterDates({ workflowState: "closed", closedAt: "2026-10-03T10:00:00Z" }).actualClosedAt).toBe("2026-10-03T10:00:00Z");
    expect(carRegisterDates({ workflowState: "closed" }).actualClosedAt).toBeNull();
  });
  it("shows current-level eligible approvers only, not the owner or later levels", () => {
    expect(carPendingWith("submitted", "Owner", "Lead", true, ["Reviewer A", "Reviewer B", "Reviewer A"]))
      .toBe("Reviewer A, Reviewer B");
    expect(carPendingWith("submitted", "Owner", "Lead", true, [])).toBe("No eligible approver");
  });
  it("retains legacy lead routing, owner corrections, extension review and final closure semantics", () => {
    expect(carPendingWith("submitted", "Owner", "Lead", false, [])).toBe("Lead");
    expect(carPendingWith("rejected", "Owner", "Lead", true, [])).toBe("Owner");
    expect(carPendingWith("extension_requested", "Owner", "Lead", true, [])).toBe("Lead");
    expect(carPendingWith("closed", "Owner", "Lead", true, [])).toBeNull();
    expect(carPendingWith("open", null, null, false, [])).toBe("Not assigned");
  });
});
