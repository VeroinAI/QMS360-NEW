export type ParticipantContext = { projectIds: string[]; process?: boolean; departmentId?: string | null };
type Assignment = { projectIds: string[] | null; businessUnitIds: string[] | null; departmentIds: string[] | null };

/** Process Audit team membership requires an owner grant for its department,
 * or an organization-wide Audit assignment. Other participant lists are unchanged. */
export function processTeamAssignmentMatches(row: Assignment, departmentId: string | null | undefined, owner: boolean): boolean {
  const organizationWide = !row.projectIds?.length && !row.departmentIds?.length && !row.businessUnitIds?.length;
  return organizationWide || !!departmentId && owner && !!row.departmentIds?.includes(departmentId);
}

/** Evaluate each qualifying Audit assignment independently; never union unrelated grants. */
export function participantAssignmentMatches(row: Assignment, context?: ParticipantContext): boolean {
  if (!context) return false;
  const projects = row.projectIds ?? [], departments = row.departmentIds ?? [];
  const organizationWide = !projects.length && !departments.length && !row.businessUnitIds?.length;
  if (context.process) {
    // Preserve legacy project-role Process participation, but not department-only widening.
    return organizationWide || projects.length > 0 || !!context.departmentId && departments.includes(context.departmentId);
  }
  return context.projectIds.length > 0 && (organizationWide || context.projectIds.every(id => projects.includes(id)));
}
