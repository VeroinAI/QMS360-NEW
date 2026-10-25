import { describe, expect, it } from "vitest";
import { participantAssignmentMatches } from "../src/lib/audit-participant-scope";

const assignment = (projectIds: string[] = [], departmentIds: string[] = [], businessUnitIds: string[] = []) =>
  ({ projectIds, departmentIds, businessUnitIds });
describe("Audit participant assignment scope", () => {
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
