import { describe, expect, it } from "vitest";
import { reviewDronaProjectIntersection } from "./project-scope";
import type { DronaAssignment, DronaSourceSnapshot } from "./source";

const assignment: DronaAssignment = {
  assignmentId: "1", projectMapId: "2", projectId: "3", roleId: "4", roleName: "Digital Admin",
  assignmentActive: true, projectActive: true, qualityEnabled: true, coordinator: false,
  sbgId: "1", businessUnitId: "2", divisionId: "3", departmentId: null,
  assignmentModule: null, assignmentModules: [], projectMappingModules: [],
  projectModule: null, projectModules: [],
};
const snapshot: DronaSourceSnapshot = { userId: "5", userActive: true, assignments: [assignment], authorizationReady: false };
function review(overrides: Partial<Parameters<typeof reviewDronaProjectIntersection>[0]> = {}) {
  return reviewDronaProjectIntersection({
    snapshot, environment: "dev", organizationId: "org",
    projectLinks: [{ environment: "dev", organizationId: "org", externalProjectId: "3", internalProjectId: "stable-project-uuid" }],
    qmsScope: { unrestricted: true, projectIds: [] },
    assignmentAllowed: () => false,
    ...overrides,
  });
}
describe("Drona membership intersection preparation", () => {
  it("does not turn administrator names, quality flags or empty arrays into permission", () => {
    expect(review().projectIds).toEqual([]);
    expect(review().unrestricted).toBe(false);
  });
  it("requires an explicit assignment policy and preserves a restricted UUID scope", () => {
    expect(review({ assignmentAllowed: () => true })).toMatchObject({
      projectIds: ["stable-project-uuid"], unrestricted: false,
    });
  });
  it("intersects capability-specific QMS scope even when the source allows a project", () => {
    expect(review({ assignmentAllowed: () => true, qmsScope: { unrestricted: false, projectIds: ["other"] } }).projectIds).toEqual([]);
  });
  it("never treats inactive users or no membership as unrestricted access", () => {
    expect(review({ snapshot: { ...snapshot, userActive: false }, assignmentAllowed: () => true }).projectIds).toEqual([]);
    expect(review({ snapshot: { ...snapshot, assignments: [] }, assignmentAllowed: () => true }).projectIds).toEqual([]);
  });
  it.each([{ assignmentActive: null }, { assignmentActive: false }, { projectActive: false }])(
    "blocks inactive or ambiguous source membership", (overrides) => {
      expect(review({
        snapshot: { ...snapshot, assignments: [{ ...assignment, ...overrides }] },
        assignmentAllowed: () => true,
      }).projectIds).toEqual([]);
    },
  );
  it("reports missing project links without widening scope", () => {
    expect(review({ projectLinks: [], assignmentAllowed: () => true })).toMatchObject({ projectIds: [], unresolvedProjectCount: 1 });
  });
  it("rejects cross-organization/environment and ambiguous project links", () => {
    expect(() => review({ projectLinks: [{ environment: "aws", organizationId: "org", externalProjectId: "3", internalProjectId: "uuid" }] })).toThrow();
    expect(() => review({ projectLinks: [{ environment: "dev", organizationId: "other", externalProjectId: "3", internalProjectId: "uuid" }] })).toThrow();
    expect(() => review({ projectLinks: [
      { environment: "dev", organizationId: "org", externalProjectId: "3", internalProjectId: "uuid" },
      { environment: "dev", organizationId: "org", externalProjectId: "3", internalProjectId: "other" },
    ] })).toThrow();
  });
});