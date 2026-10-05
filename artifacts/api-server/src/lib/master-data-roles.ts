import { and, asc, eq, isNull } from "drizzle-orm";
import { db, workspaceRoles, lessonsWorkspaceRoles, auditWorkspaceRoles } from "@workspace/db";
import { HttpError } from "./workspace";

const tables = [
  { application: "qaqc" as const, table: workspaceRoles },
  { application: "lessons" as const, table: lessonsWorkspaceRoles },
  { application: "audit" as const, table: auditWorkspaceRoles },
];
type Assignment = { application: "qaqc" | "lessons" | "audit"; roleId: string };
export async function masterDataRoleOptions(organizationId: string) {
  const groups = await Promise.all(tables.map(async ({ application, table }) => {
    const roles = await db.select({ id: table.id, name: table.name, status: table.status }).from(table)
      .where(and(eq(table.organizationId, organizationId), isNull(table.deletedAt))).orderBy(asc(table.name));
    return roles.map(role => ({ id: role.id, name: role.name, application, active: role.status === "active" }));
  }));
  return groups.flat();
}

/** Informational references only. Never use these assignments as authorization grants or dropdown filters. */
export async function masterDataMetadata(
  organizationId: string, scope: string, incoming?: Record<string, unknown>, previous?: Record<string, unknown>,
) {
  const metadata = { ...previous, ...incoming };
  if (!incoming || !Object.hasOwn(incoming, "assignedRoles")) return metadata;
  const raw = incoming.assignedRoles;
  if (!Array.isArray(raw) || raw.length > 200) throw new HttpError(422, "Select up to 200 valid application roles");
  const roles = raw as Assignment[];
  const options = roles.length ? await masterDataRoleOptions(organizationId) : [];
  const valid = new Set(options.filter(role => role.active).map(role => `${role.application}:${role.id}`));
  if (roles.some(role => !role || !valid.has(`${role.application}:${role.roleId}`)
    || (scope !== "global" && role.application !== scope))) {
    throw new HttpError(422, "Select active roles from this organization's matching application");
  }
  metadata.assignedRoles = [...new Map(roles.map(role =>
    [`${role.application}:${role.roleId}`, { application: role.application, roleId: role.roleId }])).values()];
  return metadata;
}