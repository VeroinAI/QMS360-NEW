import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Records the versioned migrations in lib/db/drizzle as already applied in the
 * target database's drizzle.__drizzle_migrations table.
 *
 * Run this ONCE against any database that was brought up to date via
 * scripts/production-schema.sql (or by applying the migration files manually),
 * so future `drizzle-kit migrate` runs apply only genuinely new migrations
 * instead of replaying the baseline against live data.
 *
 *   pnpm --filter @workspace/scripts run record-baseline
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../lib/db/drizzle");
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id serial PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

let recorded = 0;
for (const entry of journal.entries) {
  const filePath = join(migrationsDir, `${entry.tag}.sql`);
  const hash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  const result = await db.execute(sql`
    INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
    SELECT ${hash}, ${entry.when}
    WHERE NOT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = ${entry.when})
  `);
  if ((result as { rowCount?: number }).rowCount) recorded++;
}

console.log(`Baseline recorded: ${recorded} new row(s); ${journal.entries.length} migration(s) in journal.`);
process.exit(0);
