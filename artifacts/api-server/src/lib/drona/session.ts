import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { dronaId } from "./ids";
import { ensureDronaProjects, provisionDronaEmail } from "./provisioning";
import { DronaAccessError } from "./errors";
export { DronaAccessError } from "./errors";

type Identity = { id: string; organizationId: string; externalUserId: string };

export async function resolveDronaEmail(email: string): Promise<Identity> {
  return provisionDronaEmail(email);
}

/** Recheck source activity, identity linkage and project membership on every
 * request. No caching that could preserve a revoked membership or old link. */
export async function dronaSessionProjects(identity: Identity): Promise<string[]> {
  const externalUserId = dronaId(identity.externalUserId);
  const result = await db.execute(sql`
    SELECT u.id FROM shared.drona_user_links l
    JOIN shared.users u ON u.id = l.user_id AND u.organization_id = l.organization_id
    JOIN public.user_master s ON s.user_id = l.external_user_id
    WHERE l.environment_key = ${process.env.DRONA_ENVIRONMENT!}
      AND l.organization_id = ${identity.organizationId}::uuid
      AND l.user_id = ${identity.id}::uuid
      AND l.external_user_id = ${externalUserId}::bigint
      AND s.is_active = true AND lower(btrim(s.user_email)) = lower(btrim(u.email))
      AND u.deleted_at IS NULL AND u.access_status = 'active' AND u.status = 'active'
  `);
  if (result.rows.length !== 1) throw new DronaAccessError(401, "Drona account or identity mapping is no longer active");
  await ensureDronaProjects(identity);
  const projects = await db.execute(sql`
    SELECT DISTINCT q.id
    FROM public.user_role_mapping a
    JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
    JOIN public.project_master p ON p.project_id = m.project_id
    JOIN shared.drona_project_links l ON l.external_project_id = p.project_id
      AND l.environment_key = ${process.env.DRONA_ENVIRONMENT!}
      AND l.organization_id = ${identity.organizationId}::uuid
    JOIN shared.projects q ON q.id = l.project_id AND q.organization_id = l.organization_id
    WHERE a.user_id = ${externalUserId}::bigint AND a.is_active = true
      AND p.is_active = true AND q.deleted_at IS NULL AND q.status = 'active'
  `);
  return (projects.rows as Array<{ id: string }>).map(row => row.id);
}

export function restrictDronaProjects(
  allowed: string[] | undefined,
  scope: { unrestricted: boolean; projectIds: string[]; processAuditsAllowed?: boolean },
  preserveProcessAudits = false,
) {
  if (allowed === undefined) return scope;
  return {
    unrestricted: false,
    projectIds: allowed.filter(id => scope.unrestricted || scope.projectIds.includes(id)),
    ...(preserveProcessAudits ? {
      // Department-only Process audits retain the existing QMS capability.
      // This flag never grants a project or a generic projectless record.
      processAuditsAllowed: scope.processAuditsAllowed === true || scope.unrestricted || scope.projectIds.length > 0,
    } : {}),
  };
}
