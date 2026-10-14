import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { DronaAccessError } from "./errors";
import { dronaId } from "./ids";
import { provisionDronaIdentity, provisionTarget, type ProvisionExecutor } from "./provisioning";
import { writeAuditLog } from "../workspace";

function discoveryTarget(organizationId: string) {
  if (process.env.AUTH_STRATEGY !== "drona" || process.env.DRONA_MAPPING_REVIEWED !== "true") {
    throw new DronaAccessError(503, "Drona user search requires the reviewed Drona backend configuration.");
  }
  const target = provisionTarget();
  if (target.organizationId.toLowerCase() !== organizationId.toLowerCase()) {
    throw new DronaAccessError(403, "Drona user search is not available for this organization.");
  }
  // Source module fields exist, but their business values are deployment-owned.
  // Do not guess that every active Drona user has QMS360 access.
  const moduleValue = process.env.DRONA_QMS_MODULE_VALUE?.trim();
  if (!moduleValue || moduleValue.length > 255) {
    throw new DronaAccessError(503,
      "Drona QMS360 access mapping is not configured. Set DRONA_QMS_MODULE_VALUE to the exact QMS360 value in Drona user-role assignments.");
  }
  return { ...target, moduleValue };
}

export function normalizedDronaEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new DronaAccessError(422, "Enter a valid email address.");
  }
  return normalized;
}

async function candidate(tx: ProvisionExecutor, email: string, organizationId: string, lock = false) {
  const target = discoveryTarget(organizationId);
  const normalized = normalizedDronaEmail(email);
  const source = await tx.execute(sql`
    SELECT user_id::text AS external_id, user_name, user_email, is_active
    FROM public.user_master WHERE lower(btrim(user_email)) = ${normalized}
    LIMIT 2 ${lock ? sql`FOR SHARE` : sql``}
  `);
  type SourceUser = { external_id: string; user_name: string; user_email: string; is_active: boolean };
  const matches = source.rows as SourceUser[];
  if (!matches.length) throw new DronaAccessError(404, "No Drona user was found with this email address.");
  if (matches.length !== 1) throw new DronaAccessError(409, "Multiple Drona users match this email. Source administrator review is required.");
  const user = matches[0]!;
  if (user.is_active !== true) throw new DronaAccessError(403, "This Drona user is inactive.");
  const externalUserId = dronaId(user.external_id);
  if (!user.user_name?.trim()) throw new DronaAccessError(409, "The Drona user has no name. Update the Drona master first.");
  const eligible = await tx.execute(sql`
    SELECT a.user_role_map_id
    FROM public.user_role_mapping a
    JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
    JOIN public.project_master p ON p.project_id = m.project_id
    WHERE a.user_id = ${externalUserId}::bigint
      AND a.is_active = true AND p.is_active = true
      AND (
        lower(btrim(a.module)) = lower(${target.moduleValue})
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(to_jsonb(a.modules)) = 'array'
              THEN to_jsonb(a.modules) ELSE '[]'::jsonb END
          ) AS assigned(value) WHERE lower(btrim(assigned.value)) = lower(${target.moduleValue})
        )
      )
    LIMIT 1
  `);
  if (!eligible.rows.length) {
    throw new DronaAccessError(403, "This user has no active QMS360 assignment on an active Drona project.");
  }
  const existing = await tx.execute(sql`
    SELECT id FROM shared.users WHERE organization_id = ${organizationId}::uuid
      AND lower(btrim(email)) = ${normalized} LIMIT 2
  `);
  if (existing.rows.length > 1) throw new DronaAccessError(409, "Multiple QMS360 users match this email. Administrator review is required.");
  return {
    target, externalUserId, email: normalized, fullName: user.user_name.trim(),
    alreadyPresent: existing.rows.length === 1,
  };
}

/** Read-only discovery; no user/link/project/role changes occur on Search. */
export async function lookupDronaAdminUser(email: string, organizationId: string) {
  const { target: _target, ...result } = await candidate(db, email, organizationId);
  return result;
}

/** Revalidate source eligibility and reuse the established, idempotent identity linker. */
export async function addDronaAdminUser(input: {
  email: string; externalUserId: string; organizationId: string; actorId: string; ipAddress?: string;
}) {
  let expectedId: string;
  try { expectedId = dronaId(input.externalUserId); }
  catch { throw new DronaAccessError(422, "Invalid Drona user identifier. Search again."); }
  return db.transaction(async tx => {
    const found = await candidate(tx, input.email, input.organizationId, true);
    if (found.externalUserId !== expectedId) {
      throw new DronaAccessError(409, "The Drona identity changed. Search again before adding this user.");
    }
    const identity = await provisionDronaIdentity(tx, found.email, found.target, {
      actorId: input.actorId, reference: "admin:email-search",
    });
    for (const app of ["qaqc", "lessons", "audit"] as const) {
      await writeAuditLog(tx, app, {
        organizationId: input.organizationId, actorId: input.actorId,
        action: "add_drona_user", entityType: "user", entityId: identity.id,
        after: { externalUserId: found.externalUserId, alreadyPresent: found.alreadyPresent },
        ipAddress: input.ipAddress,
      }, { dispatch: false });
    }
    return { userId: identity.id, email: found.email, fullName: found.fullName, alreadyPresent: found.alreadyPresent };
  });
}
