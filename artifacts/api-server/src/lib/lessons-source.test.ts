import { describe, expect, it } from "vitest";
import { lessonInScope, lessonSourceInput } from "./lessons-source";
import { projectScopeFromRows, restrictScope, canManageAssignmentScope } from "../middlewares/rbac";

describe("Lessons project / department isolation", () => {
  const project = { projectId: "p1", departmentId: null };
  const department = { projectId: null, departmentId: "d1" };
  it("retains legacy project requests and normalizes unused source", () => {
    expect(lessonSourceInput({ projectId: "p1" })).toEqual(project);
    expect(lessonSourceInput({ sourceType: "Department", departmentId: "d1", projectId: null })).toEqual(department);
  });
  it.each([
    { sourceType: "Department" }, { projectId: null }, { projectId: "p1", departmentId: "d1" },
    { sourceType: "Department", projectId: "p1", departmentId: "d1" }, { sourceType: "Other", projectId: "p1" },
  ])("rejects missing or mixed sources: %j", input => expect(() => lessonSourceInput(input)).toThrow());
  it("does not turn a department assignment into organization-wide project access", () => {
    const scope = projectScopeFromRows([{ projectIds: [], businessUnitIds: [], departmentIds: ["d1"] }]);
    expect(scope).toEqual({ unrestricted: false, projectIds: [], departmentIds: ["d1"] });
    expect(lessonInScope(scope, department)).toBe(true);
    expect(lessonInScope(scope, project)).toBe(false);
    expect(lessonInScope(scope, { projectId: null, departmentId: "d2" })).toBe(false);
  });
  it("does not let project roles grant department access", () => {
    const scope = projectScopeFromRows([{ projectIds: ["p1"], businessUnitIds: [] }]);
    expect(scope).toEqual({ unrestricted: false, projectIds: ["p1"] });
    expect(lessonInScope(scope, department)).toBe(false);
    expect(lessonInScope(scope, project)).toBe(true);
  });
  it("unions explicit scopes while preserving organization-wide legacy assignments", () => {
    const scope = projectScopeFromRows([{ projectIds: ["p1"] }, { departmentIds: ["d1"] }]);
    expect(lessonInScope(scope, department)).toBe(true);
    expect(lessonInScope(scope, project)).toBe(true);
    expect(projectScopeFromRows([{ projectIds: [], businessUnitIds: [] }])).toEqual({ unrestricted: true, projectIds: [] });
  });
  it("rejects corrupt mixed or projectless rows even in organization scope", () => {
    const scope = { unrestricted: true, projectIds: [] };
    expect(lessonInScope(scope, { projectId: null, departmentId: null })).toBe(false);
    expect(lessonInScope(scope, { projectId: "p1", departmentId: "d1" })).toBe(false);
  });
  it("preserves explicit department roles without widening Drona projects", () => {
    const req = { dronaProjectIds: ["p2"] } as any;
    const scope = restrictScope(req, "lessons", { unrestricted: false, projectIds: ["p1"], departmentIds: ["d1"] });
    expect(scope.projectIds).toEqual([]);
    expect(lessonInScope(scope, department)).toBe(true);
    expect(lessonInScope(scope, project)).toBe(false);
    expect(canManageAssignmentScope({ ...req, permissionProjectScope: scope }, [], [], ["d1"])).toBe(true);
    expect(canManageAssignmentScope({ ...req, permissionProjectScope: scope }, [], [], ["d2"])).toBe(false);
  });
  it("keeps organization-wide Lessons departments separate from fenced projects", () => {
    const scope = restrictScope({ dronaProjectIds: ["p2"] } as any, "lessons", { unrestricted: true, projectIds: [] });
    expect(scope).toEqual({ unrestricted: false, projectIds: ["p2"], allDepartmentsAllowed: true });
    expect(lessonInScope(scope, department)).toBe(true);
    expect(lessonInScope(scope, project)).toBe(false);
    expect(restrictScope({ dronaProjectIds: ["p2"] } as any, "qaqc", { unrestricted: true, projectIds: [] })).toEqual({ unrestricted: false, projectIds: ["p2"] });
  });
});
