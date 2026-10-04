import type { DronaSourceSnapshot, DronaAssignment } from "./source";

export type ReviewedDronaProjectLink = {
  environment: string; organizationId: string; externalProjectId: string; internalProjectId: string;
};
export type DronaMembershipReview = {
  projectIds: string[];
  unrestricted: false;
  blockedAssignmentCount: number;
  unresolvedProjectCount: number;
};

/** Pure, restricted intersection. The caller must supply a reviewed rule for
 * modules/role/tenant/department; there is intentionally no permissive default.
 * This is not wired into middleware while session/policy activation is blocked.
 * QMS capability-specific scope (and full-vs-own ownership) remains authoritative
 * inside this membership boundary; it is never replaced by Drona role names. */
export function reviewDronaProjectIntersection(input: {
  snapshot: DronaSourceSnapshot | null;
  environment: string;
  organizationId: string;
  projectLinks: ReviewedDronaProjectLink[];
  qmsScope: { unrestricted: boolean; projectIds: string[] };
  assignmentAllowed: (assignment: Readonly<DronaAssignment>) => boolean;
}): DronaMembershipReview {
  const result: DronaMembershipReview = {
    projectIds: [], unrestricted: false, blockedAssignmentCount: 0, unresolvedProjectCount: 0,
  };
  if (!input.snapshot?.userActive) return result;
  const links = new Map<string, string>();
  const internalLinks = new Set<string>();
  for (const link of input.projectLinks) {
    if (link.environment !== input.environment || link.organizationId !== input.organizationId) {
      throw new Error("Project links must belong to the selected environment and organization");
    }
    if (links.has(link.externalProjectId) || internalLinks.has(link.internalProjectId)) {
      throw new Error("Project links require one-to-one reconciliation");
    }
    links.set(link.externalProjectId, link.internalProjectId);
    internalLinks.add(link.internalProjectId);
  }
  const allowed = new Set<string>();
  for (const assignment of input.snapshot.assignments) {
    // Null activity is not interpreted as true.
    if (assignment.assignmentActive !== true || assignment.projectActive !== true
      || input.assignmentAllowed({ ...assignment }) !== true) {
      result.blockedAssignmentCount++;
      continue;
    }
    const projectId = links.get(assignment.projectId);
    if (!projectId) {
      result.unresolvedProjectCount++;
      continue;
    }
    if (input.qmsScope.unrestricted || input.qmsScope.projectIds.includes(projectId)) allowed.add(projectId);
  }
  result.projectIds = [...allowed];
  return result;
}