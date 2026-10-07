import type { Request, Response, NextFunction } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, applicationAccess, users, permissions, userWorkspaceRoles, workspaceRoles, workspaceRolePermissions } from "@workspace/db";
import { qaqcActivityGroups, qaqcPermissionMatches, type QaqcOperation } from "@workspace/field-controls";
import { getAuthorizedProjectScope, requirePermission } from "../middlewares/rbac";
import { getUserContext } from "./auth";
export async function canQaqcUserReview(organizationId: string, userId: string, module: string, projectId: string) {
  const user = await getUserContext(userId);
  if (!user || user.organizationId !== organizationId) return false;
  const [active] = await db.select({ status: users.accessStatus }).from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt), eq(users.accessStatus, "active")));
  if (!active) return false;
  const administrator = ["Super Admin", "Org Admin"].includes(user.platformRole);
  if (!administrator) {
    const [access] = await db.select({ id: applicationAccess.id }).from(applicationAccess)
      .where(and(eq(applicationAccess.organizationId, organizationId), eq(applicationAccess.username, user.username),
        eq(applicationAccess.canOpenQaqc, true), isNull(applicationAccess.deletedAt)));
    if (!access) return false;
  }
  const scope = await getAuthorizedProjectScope({ currentUser: user } as Request, "qaqc", { module, action: "own", operation: "review" });
  return scope.unrestricted || scope.projectIds.includes(projectId);
}
export async function activeQaqcCapabilities(req: Request) {
  const rows = await db.select({ key: permissions.key })
    .from(userWorkspaceRoles)
    .innerJoin(workspaceRoles, eq(userWorkspaceRoles.workspaceRoleId, workspaceRoles.id))
    .innerJoin(workspaceRolePermissions, eq(workspaceRolePermissions.workspaceRoleId, workspaceRoles.id))
    .innerJoin(permissions, eq(workspaceRolePermissions.permissionId, permissions.id))
    .where(and(eq(userWorkspaceRoles.organizationId, req.currentUser!.organizationId), eq(userWorkspaceRoles.userId, req.currentUser!.id),
      eq(userWorkspaceRoles.status, "active"), isNull(userWorkspaceRoles.deletedAt),
      eq(workspaceRoles.organizationId, req.currentUser!.organizationId), eq(workspaceRoles.status, "active"), isNull(workspaceRoles.deletedAt),
      eq(workspaceRolePermissions.status, "active"), isNull(workspaceRolePermissions.deletedAt),
      eq(permissions.status, "active"), isNull(permissions.deletedAt)));
  return { administrator: ["Super Admin", "Org Admin"].includes(req.currentUser!.platformRole), keys: [...new Set(rows.map(r => r.key))] };
}
export function requireQaqcTask(operation: QaqcOperation) {
  return requirePermission("qaqc", "administration", "full", { qaqcOperation: operation });
}
export async function qaqcAdminTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = req.path;
  const task: QaqcOperation = path.startsWith("/roles") || path.startsWith("/users") ? "manage_roles"
    : path.startsWith("/access-queue") ? "manage_access" : path.startsWith("/delegations") ? "delegate"
    : path.startsWith("/ai-settings") ? "manage_ai_settings" : path.startsWith("/audit-log") ? "view_audit_log" : "configure_masters";
  // Entry forms need a scoped user/approver picker, not permission management.
  if (path === "/users" && req.method === "GET") {
    const capabilities = await activeQaqcCapabilities(req);
    if (!capabilities.administrator && !capabilities.keys.some(k => qaqcPermissionMatches(k, "administration", "manage_roles"))) {
      const pickerTask = (["manage_access", "delegate"] as const).find(op => capabilities.keys.some(k => qaqcPermissionMatches(k, "administration", op)));
      if (pickerTask) return requireQaqcTask(pickerTask)(req, res, next);
      const module = qaqcActivityGroups.find(g => capabilities.keys.some(k =>
        qaqcPermissionMatches(k, g.module, "view_all") || qaqcPermissionMatches(k, g.module, "view_own_scope")));
      if (module) return requirePermission("qaqc", module.module, "select")(req, res, next);
    }
  }
  return requireQaqcTask(task)(req, res, (error?: unknown) => {
    if (error) return next(error);
    const organizationWide = path.startsWith("/roles") && req.method !== "GET"
      || path.startsWith("/field-controls") && req.method !== "GET"
      || path.startsWith("/ai-settings") && req.method !== "GET"
      || path.startsWith("/notification-templates") && req.method !== "GET"
      || path.startsWith("/escalation-rules") && req.method !== "GET";
    // Platform Super Admin may define organization roles without personal
    // Drona membership. Other organization-wide settings retain their scope.
    const superAdminRoleDefinition = path.startsWith("/roles") && req.currentUser?.platformRole === "Super Admin";
    if (organizationWide && !superAdminRoleDefinition && !req.permissionAdminBypass && !req.permissionProjectScope?.unrestricted) {
      res.status(403).json({ error: "Organization-wide configuration requires an organization-wide role assignment" }); return;
    }
    next();
  });
}