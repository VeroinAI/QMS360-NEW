import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Records the versioned migrations in lib/db/drizzle as already applied in the
 * target database's drizzle.__drizzle_migrations table.
 *
 * Run this ONCE against any database that already has the schema — because it was
 * built by `drizzle-kit push` or from an equivalent schema export — so that a later
 * `migrate` applies only genuinely new migrations instead of replaying the baseline
 * against live data.
 *
 * Target selection matches src/migrate.ts: MIGRATE_DATABASE_URL wins, so both halves
 * of the operator flow address the same database. Without it, this falls back to the
 * development DATABASE_URL. The resolved target is always printed (credentials
 * stripped) — check it before trusting the result.
 *
 *   pnpm --filter @workspace/scripts run record-baseline
 *   MIGRATE_DATABASE_URL='postgresql://…' pnpm --filter @workspace/scripts run record-baseline
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../lib/db/drizzle");
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

const explicitTarget = process.env.MIGRATE_DATABASE_URL;
const target = explicitTarget ?? process.env.DATABASE_URL;
if (!target) {
  console.error("Neither MIGRATE_DATABASE_URL nor DATABASE_URL is set; no database to record against.");
  process.exit(1);
}

const redacted = (() => {
  try {
    const parsed = new URL(target);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
})();
console.log(`Recording against: ${redacted}${explicitTarget ? "" : "  (development DATABASE_URL)"}`);

const pool = new pg.Pool({ connectionString: target });
try {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  let recorded = 0;
  for (const entry of journal.entries) {
    const hash = createHash("sha256").update(readFileSync(join(migrationsDir, `${entry.tag}.sql`))).digest("hex");
    const result = await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
       SELECT $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = $2)`,
      [hash, entry.when],
    );
    if (result.rowCount) recorded++;
  }

  console.log(`Baseline recorded: ${recorded} new row(s); ${journal.entries.length} migration(s) in journal.`);
} finally {
  await pool.end();
}
