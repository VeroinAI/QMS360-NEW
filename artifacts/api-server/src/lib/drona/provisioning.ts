import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { DronaAccessError } from "./errors";
import { dronaId } from "./ids";

export type DronaIdentity = { id: string; organizationId: string; externalUserId: string };
export type ProvisionExecutor = Pick<typeof db, "execute">;
export type ProvisionTarget = { environment: string; organizationId: string };
type QmsUser = {
  id: string; email: string; access_status: string; status: string; deleted_at: unknown;
};

export function provisionTarget(): ProvisionTarget {
  const environment = process.env.DRONA_ENVIRONMENT ?? "";
  const organizationId = process.env.DRONA_ORGANIZATION_ID ?? "";
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(environment)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw new DronaAccessError(503, "Drona organization/environment configuration is unavailable");
  }
  return { environment, organizationId };
}

async function lockTarget(tx: ProvisionExecutor, target: ProvisionTarget) {
  // Serialize setup across users sharing projects. Live read-only authorization
  // does not take this lock. Database uniqueness also protects operator races.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`qms-drona-setup:${target.organizationId}:${target.environment}`}, 0))`);
  const org = await tx.execute(sql`SELECT id FROM shared.organizations
    WHERE id = ${target.organizationId}::uuid AND deleted_at IS NULL AND status = 'active'`);
  if (org.rows.length !== 1) throw new DronaAccessError(503, "The configured QMS organization is unavailable");
}

export async function rememberDronaLink(
  tx: ProvisionExecutor, target: ProvisionTarget, kind: "user" | "project", externalId: string, internalId: string,
) {
  await tx.execute(sql`INSERT INTO shared.drona_provisioning_history
    (environment_key, organization_id, kind, external_id, internal_id)
    VALUES (${target.environment}, ${target.organizationId}::uuid, ${kind}, ${externalId}::bigint, ${internalId}::uuid)
    ON CONFLICT DO NOTHING`);
  const rows = await tx.execute(sql`SELECT internal_id FROM shared.drona_provisioning_history
    WHERE environment_key = ${target.environment} AND organization_id = ${target.organizationId}::uuid
      AND kind = ${kind} AND external_id = ${externalId}::bigint`);
  if (rows.rows.length !== 1 || (rows.rows[0] as { internal_id: string }).internal_id !== internalId) {
    throw new DronaAccessError(409, "Drona linking conflicts with an existing identity; administrator review is required");
  }
}

function requireActiveUser(user: QmsUser, email: string) {
  if (user.deleted_at || user.access_status !== "active" || user.status !== "active"
    || user.email.trim().toLowerCase() !== email) {
    throw new DronaAccessError(403, "QMS identity mapping or account access is unavailable");
  }
}

/** Execute inside a transaction. Exported for rollback-only database tests. */
export async function provisionDronaIdentity(
  tx: ProvisionExecutor, email: string, target: ProvisionTarget,
): Promise<DronaIdentity> {
  await lockTarget(tx, target);
  const normalized = email.trim().toLowerCase();
  const source = await tx.execute(sql`SELECT user_id::text AS external_id, user_name, is_active AS active
    FROM public.user_master WHERE lower(btrim(user_email)) = ${normalized} LIMIT 2 FOR SHARE`);
  const rows = source.rows as Array<{ external_id: string; user_name: string; active: boolean }>;
  if (rows.length !== 1 || rows[0]!.active !== true) {
    throw new DronaAccessError(401, "Drona user is unavailable or ambiguous");
  }
  const externalUserId = dronaId(rows[0]!.external_id);
  const linked = await tx.execute(sql`SELECT u.id, u.email, u.access_status, u.status, u.deleted_at
    FROM shared.drona_user_links l
    LEFT JOIN shared.users u ON u.id = l.user_id AND u.organization_id = l.organization_id
    WHERE l.environment_key = ${target.environment} AND l.organization_id = ${target.organizationId}::uuid
      AND l.external_user_id = ${externalUserId}::bigint`);
  let user = linked.rows[0] as QmsUser | undefined;
  if (linked.rows.length) {
    if (linked.rows.length !== 1 || !user?.id) throw new DronaAccessError(403, "QMS identity mapping is unavailable");
    requireActiveUser(user, normalized);
  } else {
    const history = await tx.execute(sql`SELECT internal_id FROM shared.drona_provisioning_history
      WHERE environment_key = ${target.environment} AND organization_id = ${target.organizationId}::uuid
        AND kind = 'user' AND external_id = ${externalUserId}::bigint`);
    if (history.rows.length) throw new DronaAccessError(403, "QMS identity link was removed; administrator review is required");
    const candidates = await tx.execute(sql`SELECT id, email, access_status, status, deleted_at FROM shared.users
      WHERE organization_id = ${target.organizationId}::uuid AND lower(btrim(email)) = ${normalized} LIMIT 2 FOR UPDATE`);
    if (candidates.rows.length > 1) throw new DronaAccessError(409, "QMS email is ambiguous; administrator review is required");
    user = candidates.rows[0] as QmsUser | undefined;
    if (user) requireActiveUser(user, normalized);
    else {
      const fullName = rows[0]!.user_name?.trim();
      if (!fullName) throw new DronaAccessError(409, "Drona user details are incomplete; administrator review is required");
      const created = await tx.execute(sql`INSERT INTO shared.users
        (organization_id, email, username, full_name, auth_source, access_status)
        VALUES (${target.organizationId}::uuid, ${normalized}, ${`drona_${target.environment}_${externalUserId}`},
          ${fullName}, 'drona', 'active') ON CONFLICT DO NOTHING
        RETURNING id, email, access_status, status, deleted_at`);
      user = created.rows[0] as QmsUser | undefined;
      if (!user) throw new DronaAccessError(409, "QMS user details conflict; administrator review is required");
    }
    await rememberDronaLink(tx, target, "user", externalUserId, user.id);
    const link = await tx.execute(sql`INSERT INTO shared.drona_user_links
      (environment_key, organization_id, external_user_id, user_id, review_reference, reviewed_by)
      VALUES (${target.environment}, ${target.organizationId}::uuid, ${externalUserId}::bigint, ${user.id}::uuid,
        'automatic:email-exception', ${user.id}::uuid) ON CONFLICT DO NOTHING RETURNING user_id`);
    if (link.rows.length !== 1) throw new DronaAccessError(409, "QMS identity link conflicts; administrator review is required");
  }
  await rememberDronaLink(tx, target, "user", externalUserId, user.id);
  const identity = { id: user.id, organizationId: target.organizationId, externalUserId };
  await provisionAssignedProjects(tx, identity, target);
  return identity;
}

/** Only assigned, active source projects are eligible. Never grant QMS roles or app approvals. */
async function provisionAssignedProjects(tx: ProvisionExecutor, identity: DronaIdentity, target: ProvisionTarget) {
  const assigned = await tx.execute(sql`SELECT DISTINCT p.project_id::text AS external_id,
      p.project_code::text AS project_code, p.project_name,
      l.project_id AS linked_project_id, h.internal_id AS remembered_id
    FROM public.user_role_mapping a JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
    JOIN public.project_master p ON p.project_id = m.project_id
    LEFT JOIN shared.drona_project_links l ON l.external_project_id = p.project_id
      AND l.environment_key = ${target.environment} AND l.organization_id = ${target.organizationId}::uuid
    LEFT JOIN shared.drona_provisioning_history h ON h.external_id = p.project_id AND h.kind = 'project'
      AND h.environment_key = ${target.environment} AND h.organization_id = ${target.organizationId}::uuid
    WHERE a.user_id = ${identity.externalUserId}::bigint AND a.is_active = true AND p.is_active = true
    ORDER BY external_id`);
  for (const row of assigned.rows as Array<{
    external_id: string; project_code: string | null; project_name: string;
    linked_project_id: string | null; remembered_id: string | null;
  }>) {
    const externalId = dronaId(row.external_id);
    if (row.linked_project_id) {
      if (row.remembered_id && row.remembered_id !== row.linked_project_id) {
        throw new DronaAccessError(409, "QMS project link conflicts with retained history; administrator review is required");
      }
      if (!row.remembered_id) await rememberDronaLink(tx, target, "project", externalId, row.linked_project_id);
      continue;
    }
    if (row.remembered_id) continue; // Removed project links remain denied, not recreated.
    const name = row.project_name?.trim();
    if (!name) throw new DronaAccessError(409, "Drona project details are incomplete; administrator review is required");
    const sourceCode = row.project_code?.trim();
    const code = sourceCode || `DRONA-${target.environment}-${externalId}`;
    const found = await tx.execute(sql`SELECT id, name, code, source, external_id, deleted_at, status
      FROM shared.projects WHERE organization_id = ${target.organizationId}::uuid
        AND (lower(btrim(code)) = lower(${code})
          OR (${!sourceCode} AND lower(btrim(name)) = lower(${name}))) LIMIT 2 FOR UPDATE`);
    type Project = { id: string; name: string; code: string; source: string; external_id: string | null; status: string; deleted_at: unknown };
    let project = found.rows[0] as Project | undefined;
    if (found.rows.length > 1 || (project && (project.deleted_at || project.status !== "active"
      || project.code.trim().toLowerCase() !== code.toLowerCase()
      || project.name.trim().toLowerCase() !== name.toLowerCase()
      || (project.source === "drona" && project.external_id && project.external_id !== externalId)))) {
      throw new DronaAccessError(409, "QMS project match is ambiguous or unavailable; administrator review is required");
    }
    if (project) {
      // Numeric IDs alone do not establish identity across environments.
      const other = await tx.execute(sql`SELECT environment_key FROM shared.drona_project_links
        WHERE organization_id = ${target.organizationId}::uuid AND project_id = ${project.id}::uuid
          AND (environment_key <> ${target.environment} OR external_project_id <> ${externalId}::bigint)`);
      if (other.rows.length) throw new DronaAccessError(409, "QMS project is already linked differently; administrator review is required");
    } else {
      const created = await tx.execute(sql`INSERT INTO shared.projects (organization_id, code, name, source, external_id)
        VALUES (${target.organizationId}::uuid, ${code}, ${name}, 'drona', ${externalId})
        ON CONFLICT DO NOTHING RETURNING id`);
      project = created.rows[0] as Project | undefined;
      if (!project) throw new DronaAccessError(409, "QMS project details conflict; administrator review is required");
    }
    await rememberDronaLink(tx, target, "project", externalId, project.id);
    const link = await tx.execute(sql`INSERT INTO shared.drona_project_links
      (environment_key, organization_id, external_project_id, project_id, review_reference, reviewed_by)
      VALUES (${target.environment}, ${target.organizationId}::uuid, ${externalId}::bigint, ${project.id}::uuid,
        'automatic:email-exception', ${identity.id}::uuid) ON CONFLICT DO NOTHING RETURNING project_id`);
    if (link.rows.length !== 1) throw new DronaAccessError(409, "QMS project link conflicts; administrator review is required");
  }
}

export async function provisionDronaEmail(email: string): Promise<DronaIdentity> {
  const target = provisionTarget();
  return db.transaction(tx => provisionDronaIdentity(tx, email, target));
}

/** Missing project assignment discovered on a subsequent request: set it up
 * atomically, revalidating the account/link rather than trusting a stale token. */
export async function ensureDronaProjects(identity: DronaIdentity) {
  const target = provisionTarget();
  if (identity.organizationId !== target.organizationId) {
    throw new DronaAccessError(401, "Drona organization does not match this environment");
  }
  const missing = await db.execute(sql`SELECT p.project_id FROM public.user_role_mapping a
    JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
    JOIN public.project_master p ON p.project_id = m.project_id
    LEFT JOIN shared.drona_project_links l ON l.external_project_id = p.project_id
      AND l.environment_key = ${target.environment} AND l.organization_id = ${identity.organizationId}::uuid
    LEFT JOIN shared.drona_provisioning_history h ON h.external_id = p.project_id AND h.kind = 'project'
      AND h.environment_key = ${target.environment} AND h.organization_id = ${identity.organizationId}::uuid
    WHERE a.user_id = ${identity.externalUserId}::bigint AND a.is_active = true AND p.is_active = true
      AND l.project_id IS NULL AND h.internal_id IS NULL LIMIT 1`);
  if (!missing.rows.length) return;
  await db.transaction(async tx => {
    await lockTarget(tx, target);
    const active = await tx.execute(sql`SELECT u.id FROM shared.drona_user_links l
      JOIN shared.users u ON u.id = l.user_id AND u.organization_id = l.organization_id
      JOIN public.user_master s ON s.user_id = l.external_user_id
      WHERE l.environment_key = ${target.environment} AND l.organization_id = ${target.organizationId}::uuid
        AND l.user_id = ${identity.id}::uuid AND l.external_user_id = ${identity.externalUserId}::bigint
        AND u.access_status = 'active' AND u.status = 'active' AND u.deleted_at IS NULL AND s.is_active = true
        AND lower(btrim(s.user_email)) = lower(btrim(u.email))`);
    if (identity.organizationId !== target.organizationId || active.rows.length !== 1) {
      throw new DronaAccessError(401, "Drona account or identity mapping is no longer active");
    }
    await provisionAssignedProjects(tx, identity, target);
  });
}
