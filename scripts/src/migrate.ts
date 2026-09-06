import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Applies the versioned migrations in lib/db/drizzle/ to a target PostgreSQL
 * database, recording each one in drizzle.__drizzle_migrations so reruns are
 * no-ops.
 *
 * OPERATOR-RUN ONLY — deliberately NOT wired into any build, deploy, or
 * application startup path.
 *
 *   - Replit's production database schema is owned by the Publish flow, which
 *     diffs development against production and applies the change itself.
 *     Running DDL from a deploy hook or from the server entrypoint fights that
 *     flow and is unsafe on every release.
 *   - This command exists for a Postgres instance Replit does not manage —
 *     specifically the Algihaz production database, where the four schemas
 *     (shared, app1_qaqc, app2_lessons, app3_audit) are created by applying
 *     this migration set.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL='postgresql://…' pnpm --filter @workspace/scripts run migrate
 *
 * Against an existing database that already has the schema, run record-baseline
 * first so the baseline is marked applied instead of replayed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "../../lib/db/drizzle");

const target = process.env.MIGRATE_DATABASE_URL;
if (!target) {
  console.error(
    "MIGRATE_DATABASE_URL is not set.\n\n" +
      "Set it to the connection string of the database you intend to migrate. This is\n" +
      "required explicitly — the script will not silently fall back to DATABASE_URL,\n" +
      "because that points at the workspace development database.",
  );
  process.exit(1);
}

/**
 * Connection identity for comparison, ignoring spellings that differ textually but
 * address the same server (default port, host casing, extra query parameters,
 * postgres:// vs postgresql://). Raw string equality would let those slip past.
 */
function identity(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    const database = parsed.pathname.replace(/^\//, "");
    return `${parsed.username}@${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}/${database}`;
  } catch {
    return null;
  }
}

// Guard against pointing this at the workspace development database by accident:
// dev schema changes belong in `drizzle-kit push`, not in a migration replay.
const devUrl = process.env.DATABASE_URL;
const targetIdentity = identity(target);
if (devUrl) {
  const devIdentity = identity(devUrl);
  const sameServer = targetIdentity && devIdentity ? targetIdentity === devIdentity : target === devUrl;
  if (sameServer) {
    console.error(
      "MIGRATE_DATABASE_URL resolves to the same database as DATABASE_URL (development).\n" +
        "Use `pnpm --filter @workspace/db run push` for development schema changes.",
    );
    process.exit(1);
  }
}

const redacted = targetIdentity
  ? targetIdentity.replace(/^[^@]*@/, "")
  : "(unparseable connection string)";

console.log(`Applying migrations from ${migrationsFolder}`);
console.log(`Target: ${redacted}`);

const pool = new pg.Pool({ connectionString: target });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("Migrations applied successfully.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
