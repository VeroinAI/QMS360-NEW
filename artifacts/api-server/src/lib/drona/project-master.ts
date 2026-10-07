import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { DronaProjectMasterRecord } from "@workspace/api-zod";

export type ProjectMasterInput = {
  organizationId: string;
  page: number;
  limit: number;
  search?: string;
  scope: { unrestricted: boolean; projectIds: string[] };
  environment?: string;
};

/** Read saved QMS records only. Never create tables, pull source data or change links. */
export async function readDronaProjectMaster(input: ProjectMasterInput) {
  const metadata = await db.execute(sql`SELECT to_regclass('shared.drona_project_links') IS NOT NULL AS available`);
  const linkMetadataAvailable = (metadata.rows[0] as { available: boolean }).available;
  const linkWhere = sql`l.organization_id = p.organization_id AND l.project_id = p.id
    ${input.environment ? sql`AND l.environment_key = ${input.environment}` : sql``}`;
  const transferred = linkMetadataAvailable
    ? sql`(p.source = 'drona' OR EXISTS (SELECT 1 FROM shared.drona_project_links l WHERE ${linkWhere}))`
    : sql`p.source = 'drona'`;
  const search = input.search?.trim().toLowerCase() ?? "";
  const matches = search
    ? sql`AND (strpos(lower(concat_ws(' ', p.code, p.name, p.location,
          CASE WHEN p.source = 'drona' THEN p.external_id ELSE NULL END)), ${search}) > 0
        ${linkMetadataAvailable ? sql`OR EXISTS (SELECT 1 FROM shared.drona_project_links l
          WHERE ${linkWhere} AND strpos(l.external_project_id::text, ${search}) > 0)` : sql``})`
    : sql``;
  const where = sql`p.organization_id = ${input.organizationId}::uuid AND p.deleted_at IS NULL
    AND ${transferred}
    ${input.scope.unrestricted ? sql`` : input.scope.projectIds.length
      ? sql`AND p.id IN (${sql.join(input.scope.projectIds.map(id => sql`${id}::uuid`), sql`, `)})`
      : sql`AND false`}
    ${matches}`;
  const links = linkMetadataAvailable
    ? sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'externalProjectId', l.external_project_id::text,
        'environment', l.environment_key, 'linkedAt', l.reviewed_at)
        ORDER BY l.environment_key, l.external_project_id)
      FROM shared.drona_project_links l WHERE ${linkWhere}), '[]'::jsonb)`
    : sql`'[]'::jsonb`;
  const [records, totals] = await Promise.all([
    db.execute(sql`SELECT p.id, p.code, p.name, p.location, p.status,
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
    createdAt: Date; updatedAt: Date;
  }>).map(row => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    dronaLinks: row.dronaLinks.map(link => ({ ...link, linkedAt: new Date(link.linkedAt).toISOString() })),
  }));
  return {
    items, total: Number((totals.rows[0] as { total: number }).total),
    page: input.page, limit: input.limit, linkMetadataAvailable,
  };
}
