import { and, eq, inArray, isNull } from "drizzle-orm";
import { disciplines, lessonsDisciplines, projects, users } from "@workspace/db";
import { HttpError } from "./workspace";

type Db = typeof import("@workspace/db").db;

async function assertActiveOrgRow(db: Db, table: any, orgId: string, id: string, label: string) {
  const [row] = await db.select({ id: table.id }).from(table).where(and(
    eq(table.id, id), eq(table.organizationId, orgId), isNull(table.deletedAt),
  )).limit(1);
  if (!row) throw new HttpError(422, `${label} does not belong to this organization`);
}

export const assertProjectInOrg = (db: Db, orgId: string, projectId: string) =>
  assertActiveOrgRow(db, projects, orgId, projectId, "Project");
export async function assertProjectScopeInOrg(db: Db, orgId: string, projectIds: unknown): Promise<string[]> {
  if (!Array.isArray(projectIds) || projectIds.length === 0) throw new HttpError(422, "At least one project is required for project scope");
  const ids = [...new Set(projectIds.filter((id): id is string => typeof id === "string"))];
  if (ids.length !== projectIds.length || ids.length === 0) throw new HttpError(422, "Project scope must contain unique project IDs");
  const rows = await db.select({ id: projects.id }).from(projects).where(and(
    inArray(projects.id, ids), eq(projects.organizationId, orgId), eq(projects.status, "active"), isNull(projects.deletedAt),
  ));
  if (rows.length !== ids.length) throw new HttpError(422, "Every selected project must be active and belong to this organization");
  return ids;
}
export const assertUserInOrg = (db: Db, orgId: string, userId: string) =>
  assertActiveOrgRow(db, users, orgId, userId, "User");
export const assertDisciplineInOrg = (db: Db, app: "qaqc" | "lessons", orgId: string, disciplineId: string) =>
  assertActiveOrgRow(db, app === "lessons" ? lessonsDisciplines : disciplines, orgId, disciplineId, "Discipline");