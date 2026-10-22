import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { DronaProjectMasterRecord, ProjectAdditionalData, ProjectAdditionalDataInput, ProjectClosureTargets } from "@workspace/api-zod";

const closureTargetKeys = ["external_ncr", "internal_ncr", "rfi", "rmi", "pqi"] as const;
function closureTargets(value: unknown): ProjectClosureTargets {
  const fields = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(closureTargetKeys.flatMap(key => {
    const value = fields[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? [[key, value]] : [];
  }));
}

// Reuse existing project-owned targets, including older reporting-only saves.
// Do not migrate or reset any responsible-person / distribution settings.
function projectTargetsSql() {
  return sql`CASE WHEN jsonb_typeof(p.custom_fields->'targets') = 'object' THEN p.custom_fields->'targets'
    WHEN jsonb_typeof(p.custom_fields->'qaqcReporting'->'targets') = 'object'
      THEN p.custom_fields->'qaqcReporting'->'targets' ELSE '{}'::jsonb END`;
}

const additionalDataKeys = ["name", "client", "contractor", "contractProjectNumber", "contractSigned", "contractPeriod", "tcc", "pac", "fac", "email", "phone"] as const;
function additionalData(value: unknown): ProjectAdditionalData {
  const fields = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: ProjectAdditionalData = {
    client: null, contractor: null, contractProjectNumber: null, contractSigned: null,
    contractPeriod: null, tcc: null, pac: null, fac: null, email: null, phone: null, name: null,
  };
  for (const key of additionalDataKeys) {
    const field = fields[key];
    result[key] = typeof field === "string" ? field : null;
  }
  return result;
}

export type ProjectMasterInput = {
  organizationId: string;
  page: number;
  limit: number;
  search?: string;
  projectId?: string;
  scope: { unrestricted: boolean; projectIds: string[] };
  environment?: string;
};

/** Raw SQL timestamp values can be strings rather than driver-decoded Dates. */
function timestampIso(value: Date | string, field: string): string {
  if (!(value instanceof Date) && (typeof value !== "string" || !value.trim())) {
    throw new Error(`Invalid Project Master timestamp: ${field}`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid Project Master timestamp: ${field}`);
  }
  return date.toISOString();
}

/** Shared read/write boundary: all saved projects inside current tenant/project access. */
async function projectMasterWhere(input: ProjectMasterInput) {
  const metadata = await db.execute(sql`SELECT to_regclass('shared.drona_project_links') IS NOT NULL AS available`);
  const linkMetadataAvailable = (metadata.rows[0] as { available: boolean }).available;
  const linkWhere = sql`l.organization_id = p.organization_id AND l.project_id = p.id
    ${input.environment ? sql`AND l.environment_key = ${input.environment}` : sql``}`;
  const search = input.search?.trim().toLowerCase() ?? "";
  const matches = search
    ? sql`AND (strpos(lower(concat_ws(' ', p.code, p.name, p.location,
          CASE WHEN p.source = 'drona' THEN p.external_id ELSE NULL END)), ${search}) > 0
        ${linkMetadataAvailable ? sql`OR EXISTS (SELECT 1 FROM shared.drona_project_links l
          WHERE ${linkWhere} AND strpos(l.external_project_id::text, ${search}) > 0)` : sql``})`
    : sql``;
  const where = sql`p.organization_id = ${input.organizationId}::uuid AND p.deleted_at IS NULL
    ${input.scope.unrestricted ? sql`` : input.scope.projectIds.length
      ? sql`AND p.id IN (${sql.join(input.scope.projectIds.map(id => sql`${id}::uuid`), sql`, `)})`
      : sql`AND false`}
    ${input.projectId ? sql`AND p.id = ${input.projectId}::uuid` : sql``}
    ${matches}`;
  return { linkMetadataAvailable, linkWhere, where };
}

/** Read saved QMS records only. Never create tables, pull source data or change links. */
export async function readDronaProjectMaster(input: ProjectMasterInput) {
  const { linkMetadataAvailable, linkWhere, where } = await projectMasterWhere(input);
  const links = linkMetadataAvailable
    ? sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'externalProjectId', l.external_project_id::text,
        'environment', l.environment_key, 'linkedAt', l.reviewed_at)
        ORDER BY l.environment_key, l.external_project_id)
      FROM shared.drona_project_links l WHERE ${linkWhere}), '[]'::jsonb)`
    : sql`'[]'::jsonb`;
  const [records, totals] = await Promise.all([
    db.execute(sql`SELECT p.id, p.code, p.name, p.location, p.status,
        COALESCE(p.custom_fields->>'costCentre', p.custom_fields->>'cost_centre') AS "costCentre",
        p.custom_fields->'qmsAdditionalData' AS "additionalData",
        ${projectTargetsSql()} AS "closureTargets",
        p.source AS "recordSource", p.external_id AS "externalId",
        p.created_at AS "createdAt", p.updated_at AS "updatedAt",
        b.name AS "businessUnit", ${links} AS "dronaLinks"
      FROM shared.projects p LEFT JOIN shared.business_units b
        ON b.id = p.business_unit_id AND b.organization_id = p.organization_id AND b.deleted_at IS NULL
      WHERE ${where} ORDER BY p.code, p.name, p.id
      LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`),
    db.execute(sql`SELECT count(*)::int AS total FROM shared.projects p WHERE ${where}`),
  ]);
  const items = (records.rows as Array<Omit<DronaProjectMasterRecord, "createdAt" | "updatedAt"> & {
    createdAt: Date | string; updatedAt: Date | string;
  }>).map(row => ({
    ...row,
    additionalData: additionalData(row.additionalData),
    closureTargets: closureTargets(row.closureTargets),
    createdAt: timestampIso(row.createdAt, "createdAt"),
    updatedAt: timestampIso(row.updatedAt, "updatedAt"),
    dronaLinks: row.dronaLinks.map(link => ({ ...link, linkedAt: timestampIso(link.linkedAt, "linkedAt") })),
  }));
  return {
    items, total: Number((totals.rows[0] as { total: number }).total),
    page: input.page, limit: input.limit, linkMetadataAvailable,
  };
}

/** QMS-owned extension only; atomic JSON merge preserves all unrelated master fields. */
export async function saveDronaProjectCostCentre(input: ProjectMasterInput, projectId: string, costCentre: string | null) {
  const { where } = await projectMasterWhere(input);
  const result = await db.execute(sql`UPDATE shared.projects p
    SET custom_fields = (p.custom_fields - 'cost_centre') || jsonb_build_object('costCentre', ${costCentre}::text),
        updated_at = now()
    WHERE ${where} AND p.id = ${projectId}::uuid
    RETURNING p.id, p.custom_fields->>'costCentre' AS "costCentre", p.updated_at AS "updatedAt"`);
  const record = result.rows[0] as { id: string; costCentre: string | null; updatedAt: Date | string } | undefined;
  return record ? { ...record, updatedAt: timestampIso(record.updatedAt, "updatedAt") } : null;
}

/** QMS-owned data only; one atomic merge preserves source fields and unrelated JSON metadata. */
export async function saveProjectAdditionalData(input: ProjectMasterInput, projectId: string, data: ProjectAdditionalDataInput) {
  const { where } = await projectMasterWhere(input);
  // A blank target removes only that override. Preserve unknown existing target
  // keys and merge under the UPDATE row lock so unrelated settings survive.
  const mergedTargets = sql`jsonb_strip_nulls((${projectTargetsSql()}) || ${JSON.stringify(data.closureTargets ?? {})}::jsonb)`;
  const targetPatch = data.closureTargets === undefined ? sql`` : sql`
    || jsonb_build_object('targets', ${mergedTargets},
      'qaqcReporting', (CASE WHEN jsonb_typeof(p.custom_fields->'qaqcReporting') = 'object'
        THEN p.custom_fields->'qaqcReporting' ELSE '{}'::jsonb END)
        || jsonb_build_object('targets', ${mergedTargets}))`;
  const result = await db.execute(sql`UPDATE shared.projects p
    SET custom_fields = (COALESCE(p.custom_fields, '{}'::jsonb) - 'cost_centre')
      || jsonb_build_object('costCentre', ${data.costCentre}::text,
        'qmsAdditionalData', (CASE WHEN jsonb_typeof(p.custom_fields->'qmsAdditionalData') = 'object'
          THEN p.custom_fields->'qmsAdditionalData' ELSE '{}'::jsonb END) || ${JSON.stringify(data.additionalData)}::jsonb)
      ${targetPatch},
      updated_at = now()
    WHERE ${where} AND p.id = ${projectId}::uuid
    RETURNING p.id, p.custom_fields->>'costCentre' AS "costCentre",
      p.custom_fields->'qmsAdditionalData' AS "additionalData",
      ${projectTargetsSql()} AS "closureTargets", p.updated_at AS "updatedAt"`);
  const record = result.rows[0] as { id: string; costCentre: string | null; additionalData: unknown; closureTargets?: unknown; updatedAt: Date | string } | undefined;
  return record ? { ...record, additionalData: additionalData(record.additionalData), closureTargets: closureTargets(record.closureTargets), updatedAt: timestampIso(record.updatedAt, "updatedAt") } : null;
}
