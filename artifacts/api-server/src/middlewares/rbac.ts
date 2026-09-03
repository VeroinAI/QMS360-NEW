import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  applicationAccess,
  auditPermissions,
  auditUserWorkspaceRoles,
  auditWorkspaceRolePermissions,
  auditWorkspaceRoles,
  db,
  lessonsPermissions,
  lessonsUserWorkspaceRoles,
  lessonsWorkspaceRolePermissions,
  lessonsWorkspaceRoles,
  permissions,
  userWorkspaceRoles,
  workspaceRolePermissions,
  workspaceRoles,
} from "@workspace/db";

export type AppKey = "qaqc" | "lessons" | "audit";
export type PermissionAction = "full" | "own" | "select";

declare global {
  namespace Express {
    interface Request {
      permissionScope?: PermissionAction;
      permissionAdminBypass?: boolean;
    }
  }
}

const platformAdmins = new Set(["Super Admin", "Org Admin"]);
const isAdminName = (name: string) => /\b(admin|administrator)\b/i.test(name);

function appTables(appKey: AppKey) {
  if (appKey === "lessons") return {
    roles: lessonsWorkspaceRoles, userRoles: lessonsUserWorkspaceRoles,
    rolePermissions: lessonsWorkspaceRolePermissions, permissions: lessonsPermissions,
  };
  if (appKey === "audit") return {
    roles: auditWorkspaceRoles, userRoles: auditUserWorkspaceRoles,
    rolePermissions: auditWorkspaceRolePermissions, permissions: auditPermissions,
  };
  return { roles: workspaceRoles, userRoles: userWorkspaceRoles, rolePermissions: workspaceRolePermissions, permissions };
}

export function requireAppAccess(appKey: AppKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.currentUser;
    if (!user) return void res.status(401).json({ error: "Authentication required" });
    if (platformAdmins.has(user.platformRole)) {
      req.permissionAdminBypass = true;
      return next();
    }
    const column = appKey === "qaqc" ? applicationAccess.canOpenQaqc
      : appKey === "lessons" ? applicationAccess.canOpenLessons : applicationAccess.canOpenAudit;
    const [access] = await db.select({ allowed: column }).from(applicationAccess).where(and(
      eq(applicationAccess.organizationId, user.organizationId),
      eq(applicationAccess.username, user.username),
      eq(column, true),
      isNull(applicationAccess.deletedAt),
    )).limit(1);
    if (!access) return void res.status(403).json({ error: "You do not have access to this application" });
    next();
  };
}

export function requirePermission(appKey: AppKey, module: string, action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.currentUser;
    if (!user) return void res.status(401).json({ error: "Authentication required" });
    if (platformAdmins.has(user.platformRole)) {
      req.permissionScope = "full"; req.permissionAdminBypass = true; return next();
    }
    const t = appTables(appKey) as any;
    const rows = await db.select({ roleName: t.roles.name, key: t.permissions.key, grant: t.rolePermissions.grant })
      .from(t.userRoles)
      .innerJoin(t.roles, eq(t.userRoles.workspaceRoleId, t.roles.id))
      .leftJoin(t.rolePermissions, and(eq(t.rolePermissions.workspaceRoleId, t.roles.id), isNull(t.rolePermissions.deletedAt)))
      .leftJoin(t.permissions, and(eq(t.rolePermissions.permissionId, t.permissions.id), isNull(t.permissions.deletedAt)))
      .where(and(
        eq(t.userRoles.userId, user.id), eq(t.userRoles.organizationId, user.organizationId),
        isNull(t.userRoles.deletedAt), isNull(t.roles.deletedAt),
      ));
    if (rows.some((r: any) => isAdminName(r.roleName))) {
      req.permissionScope = "full"; req.permissionAdminBypass = true; return next();
    }
    const capability = req.method === "GET" || req.method === "HEAD"
      ? ["view_all", "view_own"]
      : /\/(review|decision)(?:\/|$)/.test(req.path) ? ["approve_reject"]
      : /\/submit(?:\/|$)/.test(req.path) ? ["submit"]
      : ["create_edit"];
    const matching = rows.filter((r: any) => {
      const key = String(r.key ?? "").toLowerCase();
      const normalized = module.toLowerCase();
      return capability.includes(key) || key === normalized
        || capability.some((primitive) => key === `${normalized}.${primitive}` || key === `${normalized}_${primitive}`);
    });
    const rank: Record<string, number> = { select: 1, own: 2, full: 3 };
    const granted = matching.reduce<PermissionAction | undefined>((best, row: any) => {
      const key = String(row.key ?? "").toLowerCase();
      const inferred = key.endsWith("view_own") ? "own" : key.endsWith("view_all") ? "full" : action;
      const grant = (["full", "own", "select"].includes(row.grant) ? row.grant : inferred) as PermissionAction;
      return !best || rank[grant] > rank[best] ? grant : best;
    }, undefined);
    if (!granted || rank[granted] < rank[action]) {
      return void res.status(403).json({ error: "This action is not permitted for your role" });
    }
    req.permissionScope = action === "own" ? "own" : granted;
    next();
  };
}

export function assertOwnerOrFull(req: Request, recordCreatorId: string | null | undefined): void {
  if (req.permissionAdminBypass || req.permissionScope === "full") return;
  if (req.permissionScope === "own" && recordCreatorId === req.currentUser?.id) return;
  const error = new Error("You may only modify records you created") as Error & { status?: number };
  error.status = 403;
  throw error;
}