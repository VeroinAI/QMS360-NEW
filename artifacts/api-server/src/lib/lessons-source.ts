import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, lessonLearnedForms, masterDataValues } from "@workspace/db";
import { resolveMasterDataGroupId } from "./lov";
import { HttpError } from "./workspace";
import type { EffectiveProjectScope } from "../middlewares/rbac";

export type LessonSource = { projectId: string | null; departmentId?: string | null };
export function lessonInScope(scope: EffectiveProjectScope, source: LessonSource): boolean {
  if (!!source.projectId === !!source.departmentId) return false;
  return scope.unrestricted || (source.departmentId
    ? !!scope.allDepartmentsAllowed || !!scope.departmentIds?.includes(source.departmentId)
    : scope.projectIds.includes(source.projectId!));
}
export function lessonScopeWhere(scope: EffectiveProjectScope) {
  return scope.unrestricted ? undefined : or(
    scope.projectIds.length ? inArray(lessonLearnedForms.projectId, scope.projectIds) : sql`false`,
    scope.allDepartmentsAllowed ? sql`${lessonLearnedForms.departmentId} IS NOT NULL`
      : scope.departmentIds?.length ? inArray(lessonLearnedForms.departmentId, scope.departmentIds) : sql`false`,
  );
}
export async function lessonDepartments(organizationId: string) {
  const groupId = await resolveMasterDataGroupId(db, organizationId, "departments");
  if (!groupId) return [];
  return db.select({ id: masterDataValues.id, name: masterDataValues.label, code: masterDataValues.value })
    .from(masterDataValues).where(and(eq(masterDataValues.organizationId, organizationId),
      eq(masterDataValues.groupId, groupId), eq(masterDataValues.active, true),
      eq(masterDataValues.status, "active"), isNull(masterDataValues.deletedAt)))
    .orderBy(asc(masterDataValues.sortOrder), asc(masterDataValues.label));
}
export function lessonSourceInput(body: { sourceType?: string; projectId?: string | null; departmentId?: string | null }): LessonSource {
  if (body.sourceType === "Department") {
    if (!body.departmentId || body.projectId) throw new HttpError(422, "Select a Department from Department Master; do not select a project.");
    return { projectId: null, departmentId: body.departmentId };
  }
  if (body.sourceType && body.sourceType !== "Project") throw new HttpError(422, "Select Project or Department.");
  if (!body.projectId || body.departmentId) throw new HttpError(422, "Select a Project; do not select a department.");
  return { projectId: body.projectId, departmentId: null };
}
