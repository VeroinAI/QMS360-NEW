import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSemanticFixtures } from "./schema-semantics.regression";

/**
 * Regression test for the drift guard's parsing of the versioned migrations in
 * lib/db/drizzle. Proves the check exits 1 when a column or enum label goes
 * missing from the migration SQL — including the scoped-matching case where the
 * label still exists on OTHER enums (which naive global substring matching would
 * silently pass).
 *
 *   pnpm --filter @workspace/scripts run test-drift-guard
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "../../lib/db/drizzle");

const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ tag: string }>;
};
const migrationSql = journal.entries
  .map((e) => readFileSync(join(MIGRATIONS_DIR, `${e.tag}.sql`), "utf8"))
  .join("\n");

function runCheck(sqlText: string): { status: number; output: string } {
  const directory = mkdtempSync(join(tmpdir(), "drift-guard-"));
  const file = join(directory, "schema.sql");
  writeFileSync(file, sqlText);
  try {
    const res = spawnSync("pnpm", ["exec", "tsx", "src/check-schema-drift.ts", "--migration-only", file], {
      cwd: join(here, ".."), encoding: "utf8",
      // Offline fixtures need only schema exports; the pool is never connected.
      env: { ...process.env, DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture" },
    });
    return { status: res.status ?? 1, output: `${res.stdout}\n${res.stderr}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectCase(name: string, sqlText: string, expectedStatus: number, expectInOutput?: string) {
  const { status, output } = runCheck(sqlText);
  if (status !== expectedStatus || (expectInOutput && !output.includes(expectInOutput))) {
    console.error(`FAIL: ${name} — expected exit ${expectedStatus}, got ${status}`);
    console.error(output.slice(-2000));
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

/** Rewrites a single CREATE TABLE block, leaving identically-named columns on other tables intact. */
function editTableBlock(sql: string, qualifiedTable: string, edit: (block: string) => string): string {
  const start = sql.indexOf(`CREATE TABLE ${qualifiedTable} (`);
  if (start === -1) throw new Error(`could not locate CREATE TABLE ${qualifiedTable}`);
  const end = sql.indexOf("\n);", start);
  if (end === -1) throw new Error(`could not locate end of ${qualifiedTable}`);
  const block = sql.slice(start, end);
  return sql.slice(0, start) + edit(block) + sql.slice(end);
}

await runSemanticFixtures();

// 1. The real migration set must pass, independently of development catalog drift.
expectCase("untampered migration SQL passes", migrationSql, 0);

// 2. Removing a column from one table must fail — even though other tables keep a
//    column of the same name (scoped, not global, matching).
const noColumn = editTableBlock(migrationSql, '"app1_qaqc"."qaqc_metric_entries"', (block) =>
  block.split("\n").filter((line) => !/^"approver_id"\s/.test(line.trim())).join("\n"),
);
if (noColumn === migrationSql) { console.error("FAIL: column tamper did not change the SQL"); process.exit(1); }
if (!noColumn.includes('"approver_id" uuid,')) { console.error("FAIL: tamper removed approver_id from every table, not just one"); process.exit(1); }
expectCase("removed approver_id column detected", noColumn, 1, "qaqc_metric_entries.approver_id");

// 3. Removing 'email' from ONE enum must fail even though 'email' remains on the
//    other two notification_channel enums.
const noLabel = migrationSql.replace(
  `CREATE TYPE "app1_qaqc"."notification_channel" AS ENUM('in_app', 'email')`,
  `CREATE TYPE "app1_qaqc"."notification_channel" AS ENUM('in_app')`,
);
if (noLabel === migrationSql) { console.error("FAIL: label tamper did not change the SQL"); process.exit(1); }
expectCase("label removed from one enum detected despite others keeping it", noLabel, 1, "'email' on app1_qaqc.notification_channel");

console.log("All drift-guard regressions pass.");
process.exit(0);
