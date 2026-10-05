import { HttpError } from "./workspace";
export type ActivityRoleAssignment = { roleId: string; userIds: string[] };

/** Schedule-local defaults, never organization role grants. */
export function normalizeActivityAssignments(
  assignments: ActivityRoleAssignment[], roleIds: Set<string>, userIds: Set<string>,
): ActivityRoleAssignment[] {
  const seen = new Set<string>();
  return assignments.map(item => {
    if (seen.has(item.roleId)) throw new HttpError(422, "Select each activity role only once");
    seen.add(item.roleId);
    if (!roleIds.has(item.roleId)) throw new HttpError(422, "Select active QMS Audit roles for activity assignments");
    const selected = [...new Set(item.userIds)];
    if (!selected.length || selected.some(id => !userIds.has(id))) throw new HttpError(422, "Assign one or more active QMS Audit users to each activity role");
    return { roleId: item.roleId, userIds: selected };
  });
}