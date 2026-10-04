import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, auditPermissions, auditUserWorkspaceRoles, auditWorkspaceRoles, auditWorkspaceRolePermissions } from "@workspace/db";

/** UI hints only. Every record request must still enforce its own assignment scope. */
export async function activeAuditCapabilities(req: Request) {
  const user = req.currentUser!;
  if (["Super Admin", "Org Admin"].includes(user.platformRole)) return { keys: [], administrator: true };
  const rows = await db.select({ roleName: auditWorkspaceRoles.name, key: auditPermissions.key })
    .from(auditUserWorkspaceRoles)
    .innerJoin(auditWorkspaceRoles, eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId))
    .leftJoin(auditWorkspaceRolePermissions, and(
      eq(auditWorkspaceRolePermissions.workspaceRoleId, auditWorkspaceRoles.id),
      eq(auditWorkspaceRolePermissions.organizationId, user.organizationId), isNull(auditWorkspaceRolePermissions.deletedAt),
    ))
    .leftJoin(auditPermissions, and(eq(auditPermissions.id, auditWorkspaceRolePermissions.permissionId),
      eq(auditPermissions.organizationId, user.organizationId), isNull(auditPermissions.deletedAt)))
    .where(and(eq(auditUserWorkspaceRoles.userId, user.id), eq(auditUserWorkspaceRoles.organizationId, user.organizationId),
      eq(auditWorkspaceRoles.organizationId, user.organizationId), eq(auditUserWorkspaceRoles.status, "active"),
      eq(auditWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt), isNull(auditWorkspaceRoles.deletedAt)));
  return {
    keys: [...new Set(rows.flatMap(row => row.key ? [row.key] : []))],
    administrator: rows.some(row => /\b(admin|administrator)\b/i.test(row.roleName)),
  };
}