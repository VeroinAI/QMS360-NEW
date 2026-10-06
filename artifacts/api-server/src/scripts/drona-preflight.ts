import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { prepareDronaLinks, type DronaLink, type InternalLinkTarget, type SourceLinkTarget } from "../lib/drona/links";
import { environmentKey } from "../lib/drona/ids";

/** Manual READ-ONLY inventory. The label does NOT choose a database; it must
 * match the operator's independently verified DATABASE_URL configuration.
 * Never prints connection details, IDs, names, signatures or mapping contents.
 * Does not apply DDL, insert links, mutate identities, or migrate assignments. */
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 && args.length !== 4) throw new Error("Usage: drona-preflight --environment <label> [--mapping-file <private-json>]");
  if (args[0] !== "--environment" || (args.length === 4 && args[2] !== "--mapping-file")) throw new Error("Invalid arguments");
  const environment = environmentKey(args[1]!);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const sourceTables = ["user_master", "user_role_master", "user_role_mapping", "project_mapping", "project_master"];
    const { rows: columns } = await client.query<{ table_name: string; column_name: string; udt_name: string }>(
      `SELECT table_name, column_name, udt_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position`,
      [sourceTables],
    );
    const missingSourceTables = sourceTables.filter(table => !columns.some(column => column.table_name === table));
    const { rows: targets } = await client.query<InternalLinkTarget>(
      `SELECT 'user' AS kind, id::text AS id, organization_id::text AS "organizationId",
              deleted_at IS NOT NULL AS deleted FROM shared.users
       UNION ALL
       SELECT 'project', id::text, organization_id::text, deleted_at IS NOT NULL FROM shared.projects`,
    );
    const { rows: assignments } = await client.query<{ application: string; count: string }>(
      `SELECT 'qaqc' AS application, count(*)::text FROM app1_qaqc.user_workspace_roles
       UNION ALL SELECT 'lessons', count(*)::text FROM app2_lessons.user_workspace_roles
       UNION ALL SELECT 'audit', count(*)::text FROM app3_audit.user_workspace_roles`,
    );
    const { rows: linkTableRows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'shared'
       AND table_name = ANY($1::text[])`, [["drona_user_links", "drona_project_links", "drona_provisioning_history"]],
    );
    const missingLinkTables = ["drona_user_links", "drona_project_links", "drona_provisioning_history"]
      .filter(table => !linkTableRows.some(row => row.table_name === table));
    let mappingSummary: { additions: number; unresolved: number } | null = null;
    if (args[3]) {
      if (missingSourceTables.length || missingLinkTables.length) {
        throw new Error("Mapping review requires all source and link tables. No SQL has been applied.");
      }
      const parsed: unknown = JSON.parse(await readFile(args[3], "utf8"));
      if (!Array.isArray(parsed) || parsed.some(link => !link || typeof link !== "object")) {
        throw new Error("Private mapping file must contain an array of reviewed link objects");
      }
      const { rows: sources } = await client.query<SourceLinkTarget>(
        `SELECT 'user' AS kind, user_id::text AS id FROM public.user_master
         UNION ALL SELECT 'project', project_id::text FROM public.project_master`,
      );
      const { rows: existingLinks } = await client.query<DronaLink>(
        `SELECT environment_key AS environment, organization_id::text AS "organizationId",
                'user' AS kind, user_id::text AS "internalId", external_user_id::text AS "externalId",
                review_reference AS "reviewReference"
         FROM shared.drona_user_links WHERE environment_key = $1
         UNION ALL
         SELECT environment_key, organization_id::text, 'project', project_id::text,
                external_project_id::text, review_reference
         FROM shared.drona_project_links WHERE environment_key = $1`, [environment],
      );
      const review = prepareDronaLinks({
        environment, internalTargets: targets, sourceTargets: sources,
        existingLinks, reviewedLinks: parsed as DronaLink[],
      });
      mappingSummary = { additions: review.additions.length, unresolved: review.unresolved.length };
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({
      environmentLabel: environment,
      databaseTargetIndependentlyVerified: false,
      readOnly: true, activationReady: false,
      missingSourceTables, missingLinkTables,
      // Definition metadata only, never source row values.
      sourceArrayTypes: columns.filter(column => column.column_name === "modules"),
      internalUserCount: targets.filter(target => target.kind === "user").length,
      internalProjectCount: targets.filter(target => target.kind === "project").length,
      assignmentCounts: assignments, mappingSummary,
      outstanding: ["Backend session verification", "User/project linking and QMS application-access reconciliation", "Full schema parity", "Business/history reference parity"],
    }, null, 2));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

main().catch(() => {
  // Arbitrary parser/DB errors can contain real rows or connection details.
  console.error("Drona read-only preflight could not complete. Check arguments, schema availability and the private reviewed mapping file. No migration was performed.");
  process.exitCode = 1;
}).finally(() => pool.end());