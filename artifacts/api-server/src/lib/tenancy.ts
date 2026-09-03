import { and, eq, isNull } from "drizzle-orm";
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
export const assertUserInOrg = (db: Db, orgId: string, userId: string) =>
  assertActiveOrgRow(db, users, orgId, userId, "User");
export const assertDisciplineInOrg = (db: Db, app: "qaqc" | "lessons", orgId: string, disciplineId: string) =>
  assertActiveOrgRow(db, app === "lessons" ? lessonsDisciplines : disciplines, orgId, disciplineId, "Discipline");