import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
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
      permissionProjectScope?: EffectiveProjectScope;
      permissionFullProjectScope?: EffectiveProjectScope;
    }
  }
}

const platformAdmins = new Set(["Super Admin", "Org Admin"]);
const isAdminName = (name: string) => /\b(admin|administrator)\b/i.test(name);

export type EffectiveProjectScope = { unrestricted: boolean; projectIds: string[] };
type PermissionTarget = { module: string; action: PermissionAction };

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

/** Resolve active assignment scope. An empty project assignment is organization-wide
 * for backwards compatibility; business-unit assignments are deliberately ignored. */
export async function getEffectiveProjectScope(userId: string, organizationId: string, appKey: AppKey): Promise<EffectiveProjectScope> {
  const t = appTables(appKey) as any;
  const rows = await db.select({
    roleName: t.roles.name, roleStatus: t.roles.status,
    projectIds: t.userRoles.projectIds, businessUnitIds: t.userRoles.businessUnitIds,
  }).from(t.userRoles)
    .innerJoin(t.roles, eq(t.userRoles.workspaceRoleId, t.roles.id))
    .where(and(
      eq(t.userRoles.userId, userId), eq(t.userRoles.organizationId, organizationId),
      isNull(t.userRoles.deletedAt), eq(t.userRoles.status, "active"), isNull(t.roles.deletedAt), eq(t.roles.status, "active"),
    ));
  if (rows.some((row: any) => !(row.projectIds?.length) && !(row.businessUnitIds?.length))) {
    return { unrestricted: true, projectIds: [] };
  }
  return { unrestricted: false, projectIds: [...new Set(rows.flatMap((row: any) => row.projectIds ?? []))] };
}

/** Platform project pickers combine all three application assignments. */
export async function getPlatformEffectiveProjectScope(userId: string, organizationId: string): Promise<EffectiveProjectScope> {
  const scopes = await Promise.all((["qaqc", "lessons", "audit"] as AppKey[]).map((app) =>
    getEffectiveProjectScope(userId, organizationId, app)));
  if (scopes.some((scope) => scope.unrestricted)) return { unrestricted: true, projectIds: [] };
  return { unrestricted: false, projectIds: [...new Set(scopes.flatMap((scope) => scope.projectIds))] };
}

export async function assertProjectAccess(req: Request, projectId: string): Promise<void> {
  if (req.permissionAdminBypass) return;
  const appKey = (req.baseUrl.match(/lessons|audit|qaqc/)?.[0] ?? "qaqc") as AppKey;
  const scope = await getAuthorizedProjectScope(req, appKey);
  if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
    const error = new Error("You do not have access to this project") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

const rank: Record<string, number> = { select: 1, own: 2, full: 3 };
function grantFor(appKey: AppKey, action: PermissionAction, row: any): PermissionAction {
  if (isAdminName(String(row.roleName ?? ""))) return "full";
  const key = String(row.key ?? "").toLowerCase();
  const isOwnView = /(?:^|[._])view_own(?:_scope)?$/.test(key)
    && (appKey === "lessons" || !key.endsWith("view_own_scope"));
  const inferred = isOwnView ? "own" : key.endsWith("view_all") ? "full" : action;
  return (isOwnView ? "own" : ["full", "own", "select"].includes(row.grant) ? row.grant : inferred) as PermissionAction;
}

function projectScopeFromRows(rows: any[]): EffectiveProjectScope {
  return rows.some((row) => !(row.projectIds?.length) && !(row.businessUnitIds?.length))
    ? { unrestricted: true, projectIds: [] }
    : { unrestricted: false, projectIds: [...new Set(rows.flatMap((row) => row.projectIds ?? []))] as string[] };
}

export function canManageAssignmentScope(req: Request, projectIds: string[] | null | undefined, businessUnitIds?: string[] | null): boolean {
  if (req.permissionAdminBypass) return true;
  const scope = req.permissionProjectScope;
  if (!scope) return false;
  if (scope.unrestricted) return true;
  if (businessUnitIds?.length || !projectIds?.length) return false;
  return projectIds.every((id) => scope.projectIds.includes(id));
}

export function assertCanManageAssignmentScope(req: Request, projectIds: string[] | null | undefined, businessUnitIds?: string[] | null): void {
  if (!canManageAssignmentScope(req, projectIds, businessUnitIds)) {
    const error = new Error("You may only manage role assignments within your assigned projects") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

export function requireAppAdmin(appKey: AppKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.currentUser;
    if (!user) return void res.status(401).json({ error: "Authentication required" });
    if (platformAdmins.has(user.platformRole)) {
      req.permissionScope = "full";
      req.permissionAdminBypass = true;
      return next();
    }
    const t = appTables(appKey) as any;
    const rows = await db.select({
      projectIds: t.userRoles.projectIds, businessUnitIds: t.userRoles.businessUnitIds,
    }).from(t.userRoles)
      .innerJoin(t.roles, eq(t.userRoles.workspaceRoleId, t.roles.id))
      .where(and(
        eq(t.userRoles.userId, user.id), eq(t.userRoles.organizationId, user.organizationId),
        isNull(t.userRoles.deletedAt), eq(t.userRoles.status, "active"),
        isNull(t.roles.deletedAt), eq(t.roles.status, "active"),
        sql`${t.roles.name} ~* ${"\\m(admin|administrator)\\M"}`,
      ));
    if (!rows.length) return void res.status(403).json({ error: "Application administrator access is required" });
    const scope = projectScopeFromRows(rows);
    req.permissionScope = "full";
    req.permissionProjectScope = scope;
    req.permissionFullProjectScope = scope;
    next();
  };
}

async function matchingPermissionRows(req: Request, appKey: AppKey, target: PermissionTarget) {
  const user = req.currentUser!;
  const t = appTables(appKey) as any;
  const rows = await db.select({
    roleName: t.roles.name, key: t.permissions.key, grant: t.rolePermissions.grant,
    projectIds: t.userRoles.projectIds, businessUnitIds: t.userRoles.businessUnitIds,
  }).from(t.userRoles)
    .innerJoin(t.roles, eq(t.userRoles.workspaceRoleId, t.roles.id))
    .leftJoin(t.rolePermissions, and(eq(t.rolePermissions.workspaceRoleId, t.roles.id), isNull(t.rolePermissions.deletedAt)))
    .leftJoin(t.permissions, and(eq(t.rolePermissions.permissionId, t.permissions.id), isNull(t.permissions.deletedAt)))
    .where(and(
      eq(t.userRoles.userId, user.id), eq(t.userRoles.organizationId, user.organizationId),
      isNull(t.userRoles.deletedAt), eq(t.userRoles.status, "active"), isNull(t.roles.deletedAt), eq(t.roles.status, "active"),
    ));
  const capabilities = target.action === "select"
    ? ["view_all", "view_own", ...(appKey === "lessons" ? ["view_own_scope"] : [])]
    : ["create_edit", ...(appKey === "lessons" ? ["data_entry"] : [])];
  const normalized = target.module.toLowerCase();
  return rows.filter((row: any) => {
    const key = String(row.key ?? "").toLowerCase();
    return isAdminName(String(row.roleName ?? "")) || capabilities.includes(key) || key === normalized
      || capabilities.some((primitive) => key === `${normalized}.${primitive}` || key === `${normalized}_${primitive}`);
  });
}

/** Resolve the projects covered by the role assignments that authorized this request.
 * Falls back to all active assignments for routes guarded only by application access. */
export async function getAuthorizedProjectScope(req: Request, appKey: AppKey, target?: PermissionTarget): Promise<EffectiveProjectScope> {
  if (req.permissionAdminBypass || platformAdmins.has(req.currentUser?.platformRole ?? "")) return { unrestricted: true, projectIds: [] };
  if (target) {
    const matching = await matchingPermissionRows(req, appKey, target);
    const rows = matching.filter((row) => rank[grantFor(appKey, target.action, row)] >= rank[target.action]);
    return projectScopeFromRows(rows);
  }
  if (req.permissionProjectScope) return req.permissionProjectScope;
  return getEffectiveProjectScope(req.currentUser!.id, req.currentUser!.organizationId, appKey);
}

export async function getAuthorizedFullProjectScope(req: Request, appKey: AppKey, target?: PermissionTarget): Promise<EffectiveProjectScope> {
  if (req.permissionAdminBypass || platformAdmins.has(req.currentUser?.platformRole ?? "")) return { unrestricted: true, projectIds: [] };
  if (target) {
    const matching = await matchingPermissionRows(req, appKey, target);
    const rows = matching.filter((row) => grantFor(appKey, target.action, row) === "full");
    return projectScopeFromRows(rows);
  }
  return req.permissionFullProjectScope ?? { unrestricted: false, projectIds: [] };
}

export function requireAppAccess(appKey: AppKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.currentUser;
    if (!user) return void res.status(401).json({ error: "Authentication required" });
    if (platformAdmins.has(user.platformRole)) {
      req.permissionAdminBypass = true;
      return next();
    }
    const scope = await getEffectiveProjectScope(user.id, user.organizationId, appKey);
    if (!scope.unrestricted && !scope.projectIds.length) {
      return void res.status(403).json({ error: "You do not have access to any projects in this application" });
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
    const rows = await db.select({
      roleName: t.roles.name, key: t.permissions.key, grant: t.rolePermissions.grant,
      projectIds: t.userRoles.projectIds, businessUnitIds: t.userRoles.businessUnitIds,
    })
      .from(t.userRoles)
      .innerJoin(t.roles, eq(t.userRoles.workspaceRoleId, t.roles.id))
      .leftJoin(t.rolePermissions, and(eq(t.rolePermissions.workspaceRoleId, t.roles.id), isNull(t.rolePermissions.deletedAt)))
      .leftJoin(t.permissions, and(eq(t.rolePermissions.permissionId, t.permissions.id), isNull(t.permissions.deletedAt)))
      .where(and(
        eq(t.userRoles.userId, user.id), eq(t.userRoles.organizationId, user.organizationId),
        isNull(t.userRoles.deletedAt), eq(t.userRoles.status, "active"), isNull(t.roles.deletedAt), eq(t.roles.status, "active"),
      ));
    const capability = req.method === "GET" || req.method === "HEAD"
      ? ["view_all", "view_own", ...(appKey === "lessons" ? ["view_own_scope"] : [])]
      : /\/(review|decision)(?:\/|$)/.test(req.path) ? ["approve_reject"]
      : /\/submit(?:\/|$)/.test(req.path) ? ["submit"]
      : ["create_edit", ...(appKey === "lessons" ? ["data_entry"] : [])];
    const matching = rows.filter((r: any) => {
      const key = String(r.key ?? "").toLowerCase();
      const normalized = module.toLowerCase();
      return isAdminName(String(r.roleName ?? "")) || capability.includes(key) || key === normalized
        || capability.some((primitive) => key === `${normalized}.${primitive}` || key === `${normalized}_${primitive}`);
    });
    const granted = matching.reduce<PermissionAction | undefined>((best, row: any) => {
      const grant = grantFor(appKey, action, row);
      return !best || rank[grant] > rank[best] ? grant : best;
    }, undefined);
    if (!granted || rank[granted] < rank[action]) {
      return void res.status(403).json({ error: "This action is not permitted for your role" });
    }
    const authorizingRows = matching.filter((row: any) => rank[grantFor(appKey, action, row)] >= rank[action]);
    req.permissionProjectScope = projectScopeFromRows(authorizingRows);
    req.permissionFullProjectScope = projectScopeFromRows(authorizingRows.filter((row: any) => grantFor(appKey, action, row) === "full"));
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