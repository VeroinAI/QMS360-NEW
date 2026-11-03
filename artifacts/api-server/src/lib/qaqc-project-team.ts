import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, users, userWorkspaceRoles, workspaceRoles } from "@workspace/db";

const fields = { pmName: "projectManager", peName: "projectEngineer", dcName: "documentController" } as const;
const roleName = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

/** Resolve only QA/QC User and Access assignments in the report's organization.
 * Saved labels from other applications do not imply a QA/QC assignment.
 */
export async function qaqcProjectTeam(organizationId: string, additionalData: Record<string, unknown>) {
  const selected = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, roleName(additionalData[field])]));
  const names = [...new Set(Object.values(selected).filter(Boolean))];
  const rows = names.length ? await db.select({
    roleName: workspaceRoles.name, userId: users.id, fullName: users.fullName,
  }).from(userWorkspaceRoles)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, userWorkspaceRoles.workspaceRoleId))
    .innerJoin(users, eq(users.id, userWorkspaceRoles.userId))
    .where(and(
      eq(userWorkspaceRoles.organizationId, organizationId),
      eq(workspaceRoles.organizationId, organizationId), eq(users.organizationId, organizationId),
      eq(userWorkspaceRoles.status, "active"), isNull(userWorkspaceRoles.deletedAt),
      eq(workspaceRoles.status, "active"), isNull(workspaceRoles.deletedAt),
      eq(users.status, "active"), isNull(users.deletedAt),
      inArray(sql`lower(trim(${workspaceRoles.name}))`, names),
    )) : [];
  return Object.fromEntries(Object.entries(selected).map(([key, selectedName]) => {
    const matches = new Map(rows.filter(row => selectedName && roleName(row.roleName) === selectedName && row.fullName.trim())
      .map(row => [row.userId, row.fullName.trim()]));
    return [key, [...matches.values()].sort((a, b) => a.localeCompare(b)).join(", ") || null];
  })) as { pmName: string | null; peName: string | null; dcName: string | null };
}
