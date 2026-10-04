import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { applicationAccess, db, users, userWorkspaceRoles, workspaceRoles } from "@workspace/db";
import { canManageAssignmentScope } from "../middlewares/rbac";

type Access = typeof applicationAccess.$inferSelect;
type Member = {
  id: string; username: string; fullName: string; email: string; roleId: string;
  projectIds: string[]; businessUnitIds: string[]; updatedAt: Date;
};
export type QaqcAccessRequest = {
  id: string; userId: string; username: string; fullName: string; email: string;
  requestedRoleId: string; status: "pending"; requestedAt: Date;
  persistedId?: string; projectId: string | null;
};
export function pendingQaqcRequests(
  access: Access[], members: Member[], visible: (projects: string[], units?: string[]) => boolean,
): QaqcAccessRequest[] {
  const result: QaqcAccessRequest[] = [];
  const grouped = new Map<string, Member[]>();
  for (const member of members) {
    const rows = grouped.get(member.username) ?? [];
    rows.push(member); grouped.set(member.username, rows);
  }
  for (const [username, assignments] of grouped) {
    const managed = assignments.filter(row => visible(row.projectIds, row.businessUnitIds));
    if (!managed.length) continue;
    const records = access.filter(row => row.username === username);
    if (records.some(row => row.canOpenQaqc)) continue;
    const pending = records.find(row => row.status === "pending" && visible(row.projectId ? [row.projectId] : []));
    const rejected = records.filter(row => row.status === "rejected").sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const latestAssignment = Math.max(...assignments.map(row => row.updatedAt.getTime()));
    if (!pending && rejected && latestAssignment <= rejected.updatedAt.getTime()) continue;
    const existing = pending ?? records.find(row => visible(row.projectId ? [row.projectId] : []));
    const member = managed[0]!;
    result.push({
      id: pending?.id ?? `missing:${member.id}`, persistedId: existing?.id,
      userId: member.id, username, fullName: member.fullName, email: member.email,
      requestedRoleId: member.roleId, status: "pending",
      requestedAt: pending?.createdAt ?? new Date(latestAssignment),
      projectId: existing?.projectId ?? member.projectIds[0] ?? null,
    });
  }
  // Preserve previously imported pending requests, including those awaiting a role.
  for (const record of access) {
    if (record.status !== "pending" || record.canOpenQaqc || grouped.has(record.username)
      || !visible(record.projectId ? [record.projectId] : [])) continue;
    result.push({ id: record.id, persistedId: record.id, userId: "", username: record.username,
      fullName: record.username, email: "", requestedRoleId: "", status: "pending",
      requestedAt: record.createdAt, projectId: record.projectId });
  }
  return result.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
}
export async function loadPendingQaqcRequests(req: Request, executor: Pick<typeof db, "select"> = db) {
  const orgId = req.currentUser!.organizationId;
  const [access, members] = await Promise.all([
    executor.select().from(applicationAccess).where(and(eq(applicationAccess.organizationId, orgId), isNull(applicationAccess.deletedAt))),
    executor.select({
      id: users.id, username: users.username, fullName: users.fullName, email: users.email,
      roleId: workspaceRoles.id, projectIds: userWorkspaceRoles.projectIds,
      businessUnitIds: userWorkspaceRoles.businessUnitIds, updatedAt: userWorkspaceRoles.updatedAt,
    }).from(userWorkspaceRoles)
      .innerJoin(users, and(eq(users.id, userWorkspaceRoles.userId), eq(users.organizationId, orgId), isNull(users.deletedAt), eq(users.accessStatus, "active")))
      .innerJoin(workspaceRoles, and(eq(workspaceRoles.id, userWorkspaceRoles.workspaceRoleId), eq(workspaceRoles.organizationId, orgId),
        eq(workspaceRoles.status, "active"), isNull(workspaceRoles.deletedAt)))
      .where(and(eq(userWorkspaceRoles.organizationId, orgId), eq(userWorkspaceRoles.status, "active"), isNull(userWorkspaceRoles.deletedAt))),
  ]);
  return pendingQaqcRequests(access, members, (projects, units) => canManageAssignmentScope(req, projects, units));
}