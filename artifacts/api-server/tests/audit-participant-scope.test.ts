import { describe, expect, it } from "vitest";
import { participantAssignmentMatches, processTeamAssignmentMatches } from "../src/lib/audit-participant-scope";
import { standardAuditCategories } from "../src/lib/audit-category-rule";

const assignment = (projectIds: string[] = [], departmentIds: string[] = [], businessUnitIds: string[] = []) =>
  ({ projectIds, departmentIds, businessUnitIds });
describe("Audit participant assignment scope", () => {
  it("limits Process teams to matching department owner grants and organization-wide Audit grants", () => {
    expect(processTeamAssignmentMatches(assignment(), "dept", false)).toBe(true);
    expect(processTeamAssignmentMatches(assignment([], ["dept"]), "dept", true)).toBe(true);
    expect(processTeamAssignmentMatches(assignment([], ["dept"]), "dept", false)).toBe(false);
    expect(processTeamAssignmentMatches(assignment([], ["other"]), "dept", true)).toBe(false);
    expect(processTeamAssignmentMatches(assignment(["project"]), "dept", true)).toBe(false);
    expect(processTeamAssignmentMatches(assignment([], [], ["bu"]), "dept", true)).toBe(false);
    expect(processTeamAssignmentMatches(assignment([], ["dept"]), null, true)).toBe(false);
  });
  it("uses the standard audit category split without changing custom audit types", () => {
    expect(standardAuditCategories("Quality Internal Product Audit")).toEqual(["project"]);
    expect(standardAuditCategories("Quality Internal Process Audit")).toEqual(["business unit", "regional office", "warehouse"]);
    expect(standardAuditCategories("Operational Audit")).toBeUndefined();
  });
  it("fails closed without authoritative context or a project", () => {
    expect(participantAssignmentMatches(assignment())).toBe(false);
    expect(participantAssignmentMatches(assignment(), { projectIds: [] })).toBe(false);
  });
  it("admits organization-wide, matching and multi-project assignments only", () => {
    const context = { projectIds: ["a"] };
    expect(participantAssignmentMatches(assignment(), context)).toBe(true);
    expect(participantAssignmentMatches(assignment(["a"]), context)).toBe(true);
    expect(participantAssignmentMatches(assignment(["a", "b"]), context)).toBe(true);
    expect(participantAssignmentMatches(assignment(["b"]), context)).toBe(false);
    expect(participantAssignmentMatches(assignment([], ["dept"]), context)).toBe(false);
    expect(participantAssignmentMatches(assignment([], [], ["bu"]), context)).toBe(false);
  });
  it("keeps department identity and legacy project-role Process participation separate", () => {
    const context = { projectIds: [], process: true, departmentId: "dept" };
    expect(participantAssignmentMatches(assignment(), context)).toBe(true);
    expect(participantAssignmentMatches(assignment(["a"]), context)).toBe(true);
    expect(participantAssignmentMatches(assignment([], ["dept"]), context)).toBe(true);
    expect(participantAssignmentMatches(assignment([], ["other"]), context)).toBe(false);
    expect(participantAssignmentMatches(assignment([], [], ["bu"]), context)).toBe(false);
  });
});
