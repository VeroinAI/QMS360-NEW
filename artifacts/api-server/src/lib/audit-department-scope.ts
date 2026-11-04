import type { EffectiveProjectScope } from "../middlewares/rbac";

export type DepartmentIdentity = { id: string; code: string; name: string };

/** Historical schedules store a master value, not necessarily a UUID.
 * Never guess when a legacy label matches multiple departments. */
export function auditDepartmentId(value: unknown, departments: DepartmentIdentity[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim();
  const exact = departments.filter(row => row.id === key || row.code === key);
  if (exact.length) return exact.length === 1 ? exact[0]!.id : null;
  const labels = departments.filter(row => row.name === key);
  return labels.length === 1 ? labels[0]!.id : null;
}

export function processDepartmentAllowed(scope: EffectiveProjectScope, departmentId: string | null): boolean {
  if (scope.unrestricted || scope.allDepartmentsAllowed) return true;
  // Preserve legacy project-role Process access, without converting explicit
  // department assignments into this broader legacy grant.
  if (scope.projectIds.length || scope.processAuditsAllowed) return true;
  return !!departmentId && !!scope.departmentIds?.includes(departmentId);
}

export function intersectAuditScopes(left: EffectiveProjectScope, right: EffectiveProjectScope): EffectiveProjectScope {
  if (left.unrestricted) return right;
  if (right.unrestricted) return left;
  const allProcess = (scope: EffectiveProjectScope) => !!scope.allDepartmentsAllowed || !!scope.processAuditsAllowed || scope.projectIds.length > 0;
  const departments = allProcess(left) ? right.departmentIds ?? [] : allProcess(right) ? left.departmentIds ?? []
    : (left.departmentIds ?? []).filter(id => right.departmentIds?.includes(id));
  return { unrestricted: false, projectIds: left.projectIds.filter(id => right.projectIds.includes(id)),
    departmentIds: departments, allDepartmentsAllowed: allProcess(left) && allProcess(right) };
}
