import type { Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { canManageAssignmentScope } from "../middlewares/rbac";

type Assignment = {
  userId: string;
  projectIds: string[] | null;
  businessUnitIds?: string[] | null;
};

/** Discover identities, not privileges. Existing role and approval writes retain
 * their own authorization. Never list an unassigned identity outside live scope. */
export async function visibleAdminUsers<T extends { id: string }>(
  req: Request, users: T[], assignments: Assignment[],
): Promise<T[]> {
  if (req.permissionAdminBypass && req.dronaProjectIds === undefined) return users;
  const manageableProjects = (req.dronaProjectIds ?? [])
    .filter(id => canManageAssignmentScope(req, [id]));
  const discoverable = new Set<string>();
  if (manageableProjects.length) {
    const result = await db.execute(sql`
      SELECT DISTINCT u.id
      FROM shared.users u
      JOIN shared.drona_user_links ul ON ul.user_id = u.id
        AND ul.organization_id = u.organization_id
      JOIN public.user_master s ON s.user_id = ul.external_user_id
      JOIN public.user_role_mapping a ON a.user_id = s.user_id
      JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
      JOIN public.project_master p ON p.project_id = m.project_id
      JOIN shared.drona_project_links pl ON pl.external_project_id = p.project_id
        AND pl.organization_id = u.organization_id AND pl.environment_key = ul.environment_key
      JOIN shared.projects q ON q.id = pl.project_id AND q.organization_id = u.organization_id
      WHERE u.organization_id = ${req.currentUser!.organizationId}::uuid
        AND ul.environment_key = ${process.env.DRONA_ENVIRONMENT}
        AND u.deleted_at IS NULL AND u.status = 'active' AND u.access_status = 'active'
        AND s.is_active = true AND lower(btrim(s.user_email)) = lower(btrim(u.email))
        AND a.is_active = true AND p.is_active = true
        AND q.deleted_at IS NULL AND q.status = 'active'
        AND q.id IN (SELECT value::uuid FROM jsonb_array_elements_text(
          ${JSON.stringify(manageableProjects)}::jsonb) AS allowed(value))
    `);
    for (const row of result.rows as Array<{ id: string }>) discoverable.add(row.id);
  }
  return users.filter(user => {
    if (user.id === req.currentUser!.id) return true;
    const existing = assignments.filter(a => a.userId === user.id);
    // Do not use discovery to expose users whose existing assignments are outside scope.
    return existing.length
      ? existing.some(a => canManageAssignmentScope(req, a.projectIds, a.businessUnitIds))
      : discoverable.has(user.id);
  });
}
