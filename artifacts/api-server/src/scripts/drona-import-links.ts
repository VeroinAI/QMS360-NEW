import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { environmentKey } from "../lib/drona/ids";
import { prepareDronaLinks, type DronaLink, type InternalLinkTarget, type SourceLinkTarget } from "../lib/drona/links";

/** Operator-only: dry-run by default. Does not create accounts, change UUIDs,
 * replace mappings, grant roles, or modify Drona's public master tables. */
async function main() {
  const args = process.argv.slice(2);
  const value = (key: string) => {
    const i = args.indexOf(key);
    if (i < 0 || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`Required argument: ${key}`);
    return args[i + 1]!;
  };
  const environment = environmentKey(value("--environment"));
  const reviewer = value("--reviewer");
  const reviewed: unknown = JSON.parse(await readFile(value("--mapping-file"), "utf8"));
  if (!/^[0-9a-f-]{36}$/.test(reviewer) || !Array.isArray(reviewed) || !reviewed.length) {
    throw new Error("A reviewer UUID and nonempty reviewed mapping array are required");
  }
  const apply = args.includes("--apply");
  if (apply && value("--ack-target") !== environment) throw new Error("Target acknowledgement must match the environment");
  const client = await pool.connect();
  try {
    await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    if (apply) await client.query("LOCK TABLE shared.drona_user_links, shared.drona_project_links IN SHARE ROW EXCLUSIVE MODE");
    const { rows: internalTargets } = await client.query<InternalLinkTarget>(`
      SELECT 'user' AS kind, id::text, organization_id::text AS "organizationId", deleted_at IS NOT NULL AS deleted FROM shared.users
      UNION ALL SELECT 'project', id::text, organization_id::text, deleted_at IS NOT NULL FROM shared.projects`);
    const { rows: sourceTargets } = await client.query<SourceLinkTarget>(`
      SELECT 'user' AS kind, user_id::text AS id FROM public.user_master
      UNION ALL SELECT 'project', project_id::text FROM public.project_master`);
    const { rows: existingLinks } = await client.query<DronaLink>(`
      SELECT environment_key AS environment, organization_id::text AS "organizationId", 'user' AS kind,
        user_id::text AS "internalId", external_user_id::text AS "externalId", review_reference AS "reviewReference"
      FROM shared.drona_user_links WHERE environment_key = $1
      UNION ALL SELECT environment_key, organization_id::text, 'project',
        project_id::text, external_project_id::text, review_reference
      FROM shared.drona_project_links WHERE environment_key = $1`, [environment]);
    const plan = prepareDronaLinks({
      environment, internalTargets, sourceTargets, existingLinks, reviewedLinks: reviewed as DronaLink[],
    });
    for (const link of reviewed as DronaLink[]) {
      const { rows } = await client.query(`
        SELECT u.id FROM shared.users u JOIN shared.platform_roles r ON r.id = u.platform_role_id
        WHERE u.id = $1::uuid AND u.organization_id = $2::uuid AND r.organization_id = u.organization_id
          AND u.deleted_at IS NULL AND u.access_status = 'active'
          AND r.deleted_at IS NULL AND r.name IN ('Super Admin', 'Org Admin')`, [reviewer, link.organizationId]);
      if (rows.length !== 1) throw new Error("Reviewer must be an active platform administrator in every mapped organization");
      if (link.kind === "user") {
        const { rows: matches } = await client.query(`
          SELECT s.user_id FROM public.user_master s JOIN shared.users u
            ON lower(btrim(s.user_email)) = lower(btrim(u.email))
          WHERE u.id = $1::uuid AND u.organization_id = $2::uuid AND u.deleted_at IS NULL`,
        [link.internalId, link.organizationId]);
        if (matches.length !== 1 || String(matches[0]!.user_id) !== link.externalId) {
          throw new Error("User mapping must have exactly one matching source email identity");
        }
      }
    }
    if (apply) {
      for (const link of plan.additions) {
        // Table/column selection is restricted to the already validated kind.
        const table = link.kind === "user" ? "drona_user_links" : "drona_project_links";
        const external = link.kind === "user" ? "external_user_id" : "external_project_id";
        const internal = link.kind === "user" ? "user_id" : "project_id";
        await client.query(`INSERT INTO shared.${table}
          (environment_key, organization_id, ${external}, ${internal}, review_reference, reviewed_by)
          VALUES ($1, $2::uuid, $3::bigint, $4::uuid, $5, $6::uuid)`,
        [environment, link.organizationId, link.externalId, link.internalId, link.reviewReference, reviewer]);
      }
      await client.query("COMMIT");
    } else await client.query("ROLLBACK");
    console.log(JSON.stringify({ environment, applied: apply, additions: plan.additions.length, unresolved: plan.unresolved.length }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

main().catch(() => {
  // JSON parser errors can quote private file contents, and driver errors can
  // include identity values. Never print arbitrary errors from this operator tool.
  console.error("Mapping import failed; no mappings were committed. Check arguments, target/schema, reviewer access and the private reviewed mapping file.");
  process.exitCode = 1;
}).finally(() => pool.end());
