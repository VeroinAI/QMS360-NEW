import { and, eq, isNull } from "drizzle-orm";
import { db, permissions, workspaceRoles, workspaceRolePermissions } from "@workspace/db";
import { qaqcPermissionCatalog, qaqcPermissionMatches } from "@workspace/field-controls";
import { HttpError } from "./workspace";

type RoleInput = { name: string; description?: string | null; active: boolean; permissions: Array<{ key: string; name: string }> };
const labels = new Map(qaqcPermissionCatalog.map(p => [p.key, p.name]));
const legacy = new Set(["create_edit", "view_own", "configure_masters", "manage_ai_settings", "delegate", "manage_integrations", "memo_circulation"]);
export async function saveQaqcRole(organizationId: string, input: RoleInput, id?: string) {
  const requested = [...new Map(input.permissions.map(p => [p.key, p])).values()];
  if (requested.some(p => !labels.has(p.key) && !legacy.has(p.key))) throw new HttpError(422, "Unsupported QA/QC activity permission");
  return db.transaction(async tx => {
    let before: typeof workspaceRoles.$inferSelect | undefined;
    if (id) {
      [before] = await tx.select().from(workspaceRoles).where(and(eq(workspaceRoles.id, id),
        eq(workspaceRoles.organizationId, organizationId), isNull(workspaceRoles.deletedAt))).for("update");
      if (!before) throw new HttpError(404, "Role not found");
      if (before.isSystem && (input.name !== before.name || (input.description ?? "") !== (before.description ?? "")
        || input.active !== (before.status === "active"))) {
        throw new HttpError(409, "Default role name, description and enabled status are protected. Its permissions can be edited.");
      }
    }
    const values = { name: before?.isSystem ? before.name : input.name,
      description: before?.isSystem ? before.description : input.description,
      status: before?.isSystem ? before.status : input.active ? "active" : "inactive", updatedAt: new Date() };
    const [role] = before
      ? await tx.update(workspaceRoles).set(values).where(eq(workspaceRoles.id, before.id)).returning()
      : await tx.insert(workspaceRoles).values({ organizationId, isSystem: false, ...values }).returning();
    await tx.update(workspaceRolePermissions).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workspaceRolePermissions.workspaceRoleId, role!.id), eq(workspaceRolePermissions.organizationId, organizationId), isNull(workspaceRolePermissions.deletedAt)));
    for (const p of requested) {
      let [permission] = await tx.select().from(permissions).where(and(eq(permissions.organizationId, organizationId),
        eq(permissions.key, p.key), isNull(permissions.deletedAt))).limit(1);
      if (!permission) [permission] = await tx.insert(permissions).values({ organizationId, key: p.key, label: labels.get(p.key) ?? p.name, category: "qaqc" }).returning();
      const module = /^qaqc\.([^.]+)\./.exec(p.key)?.[1];
      const recordAction = /(?:^|[._])(create_edit|data_entry|delete|submit|approve_reject|import|export|ai)$/.test(p.key);
      const hasFullView = requested.some(r => module
        ? qaqcPermissionMatches(r.key, module, "view_all") : r.key === "view_all");
      const own = /(?:^|[._])view_own(?:_scope)?$/.test(p.key) || (recordAction && !hasFullView);
      await tx.insert(workspaceRolePermissions).values({ organizationId, workspaceRoleId: role!.id,
        permissionId: permission!.id, grant: own ? "own" : "full" });
    }
    return { before, role: role! };
  });
}