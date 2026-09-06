import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { db } from "@workspace/db";

/**
 * Schema drift guard. Fails loudly (exit 1) when the live database or
 * the versioned migrations in lib/db/drizzle have drifted from the drizzle schema in
 * lib/db/src/schema — the failure mode that used to let enum types declared in
 * app-common.ts factory helpers slip past database change scripts silently.
 *
 * Errors (exit 1):
 *   1. A drizzle enum type or label is missing from the live database.
 *   2. A drizzle table or column is missing from the live database.
 *   3. A drizzle enum type/label or table is missing from the migration SQL.
 * Warnings (printed, non-fatal): objects present in the database under our
 * managed schemas but not in the drizzle schema.
 *
 * Run before promoting schema changes to production:
 *   pnpm --filter @workspace/scripts run check-drift
 */

const SCHEMAS = ["public", "shared", "app1_qaqc", "app2_lessons", "app3_audit"];
const here = dirname(fileURLToPath(import.meta.url));

const errors: string[] = [];
const warnings: string[] = [];

// ---- Drizzle-side truth ---------------------------------------------------------
type EnumInfo = { schema: string; name: string; values: string[] };
const enums: EnumInfo[] = [];
const tables: Array<{ schema: string; name: string; columns: string[] }> = [];

for (const value of Object.values(schema)) {
  const v = value as unknown as Record<string, unknown> | null;
  // Drizzle pgEnum instances are callable function objects, not plain objects.
  if (v && (typeof v === "object" || typeof v === "function") && typeof v.enumName === "string" && Array.isArray(v.enumValues)) {
    enums.push({ schema: (v.schema as string) ?? "public", name: v.enumName as string, values: [...(v.enumValues as string[])] });
  } else if (v instanceof PgTable) {
    const config = getTableConfig(v);
    tables.push({ schema: config.schema ?? "public", name: config.name, columns: config.columns.map((c) => c.name) });
  }
}

// ---- Database-side truth --------------------------------------------------------
const schemaList = SCHEMAS.map((s) => `'${s}'`).join(", ");
const enumRows = await db.execute(sql.raw(`
  SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS label
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname IN (${schemaList})
`));
const dbEnumLabels = new Map<string, Set<string>>();
for (const row of enumRows.rows as Array<{ schema: string; name: string; label: string }>) {
  const key = `${row.schema}.${row.name}`;
  if (!dbEnumLabels.has(key)) dbEnumLabels.set(key, new Set());
  dbEnumLabels.get(key)!.add(row.label);
}

const columnRows = await db.execute(sql.raw(`
  SELECT table_schema, table_name, column_name
  FROM information_schema.columns
  WHERE table_schema IN (${schemaList})
`));
const dbColumns = new Map<string, Set<string>>();
for (const row of columnRows.rows as Array<{ table_schema: string; table_name: string; column_name: string }>) {
  const key = `${row.table_schema}.${row.table_name}`;
  if (!dbColumns.has(key)) dbColumns.set(key, new Set());
  dbColumns.get(key)!.add(row.column_name);
}

// ---- Live database comparisons --------------------------------------------------
for (const e of enums) {
  const key = `${e.schema}.${e.name}`;
  const labels = dbEnumLabels.get(key);
  if (!labels) { errors.push(`Enum type missing in database: ${key} (expects: ${e.values.join(", ")})`); continue; }
  for (const value of e.values) {
    if (!labels.has(value)) errors.push(`Enum label missing in database: ${key} value '${value}'`);
  }
}
for (const t of tables) {
  const key = `${t.schema}.${t.name}`;
  const columns = dbColumns.get(key);
  if (!columns) { errors.push(`Table missing in database: ${key}`); continue; }
  for (const column of t.columns) {
    if (!columns.has(column)) errors.push(`Column missing in database: ${key}.${column}`);
  }
}
for (const key of dbEnumLabels.keys()) {
  if (!enums.some((e) => `${e.schema}.${e.name}` === key)) warnings.push(`Enum type in database but not in drizzle schema: ${key}`);
}
for (const key of dbColumns.keys()) {
  if (!tables.some((t) => `${t.schema}.${t.name}` === key)) warnings.push(`Table in database but not in drizzle schema: ${key}`);
}

// ---- migration SQL comparisons ---------------------------------------------------
// Scoped parsing, not substring matching: every drizzle column must appear in that
// exact table's CREATE TABLE block or an ALTER TABLE ... ADD COLUMN for it, and
// every enum label inside that exact enum's CREATE TYPE list or an ALTER TYPE ...
// ADD VALUE for it. Global substring matching would let a label on one enum mask
// a missing label on another, and would never notice a missing column at all.
//
// The versioned migrations in lib/db/drizzle are the source of truth for standing
// up a database Replit does not manage (the Algihaz production Postgres). They are
// concatenated in journal order so a later ALTER counts towards the object an
// earlier CREATE introduced.
// An alternate SQL file can be passed as argv[2] (used by the regression test).
const MIGRATIONS_DIR = join(here, "../../lib/db/drizzle");

function readMigrationSql(): string {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  return journal.entries.map((e) => readFileSync(join(MIGRATIONS_DIR, `${e.tag}.sql`), "utf8")).join("\n");
}

const overridePath = process.argv[2];
const prodSql = (overridePath ? readFileSync(overridePath, "utf8") : readMigrationSql())
  // drizzle-kit emits `;--> statement-breakpoint` on the same line as the statement
  // terminator, so the marker has to go before statements are split on `;`.
  .replaceAll("--> statement-breakpoint", "")
  .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
const statements = prodSql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

const sqlEnumLabels = new Map<string, Set<string>>();
const sqlTableColumns = new Map<string, Set<string>>();
const collect = (map: Map<string, Set<string>>, key: string, value: string) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
};

for (const statement of statements) {
  let m = statement.match(/^CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\."([^"]+)"\s+AS\s+ENUM\s*\(([^)]*)\)/is);
  if (m) {
    for (const label of m[3]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)) collect(sqlEnumLabels, `${m[1]}.${m[2]}`, label[1]!);
    continue;
  }
  m = statement.match(/^ALTER\s+TYPE\s+"([^"]+)"\."([^"]+)"\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/i);
  if (m) { collect(sqlEnumLabels, `${m[1]}.${m[2]}`, m[3]!); continue; }
  m = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\."([^"]+)"\s*\(([\s\S]*)$/i);
  if (m) {
    // Column type may itself be quoted (enum-typed columns like "channel" "app1_qaqc"."notification_channel").
    for (const col of m[3]!.matchAll(/^\s*"([^"]+)"\s+[\w"]/gm)) collect(sqlTableColumns, `${m[1]}.${m[2]}`, col[1]!);
    continue;
  }
  // PostgreSQL's default namespace is public, and drizzle-kit emits public
  // tables without a schema qualifier.
  m = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s*\(([\s\S]*)$/i);
  if (m) {
    for (const col of m[2]!.matchAll(/^\s*"([^"]+)"\s+[\w"]/gm)) collect(sqlTableColumns, `public.${m[1]}`, col[1]!);
    continue;
  }
  m = statement.match(/^ALTER\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\."([^"]+)"\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i);
  if (m) collect(sqlTableColumns, `${m[1]}.${m[2]}`, m[3]!);
}

for (const e of enums) {
  const key = `${e.schema}.${e.name}`;
  const labels = sqlEnumLabels.get(key);
  if (!labels) { errors.push(`migrations have no CREATE TYPE for ${key}`); continue; }
  for (const value of e.values) {
    if (!labels.has(value)) errors.push(`migrations missing enum label '${value}' on ${key}`);
  }
}
for (const t of tables) {
  const key = `${t.schema}.${t.name}`;
  const columns = sqlTableColumns.get(key);
  if (!columns) { errors.push(`migrations missing table ${key}`); continue; }
  for (const column of t.columns) {
    if (!columns.has(column)) errors.push(`migrations missing column ${key}.${column}`);
  }
}

// ---- Report ---------------------------------------------------------------------
console.log(`Checked ${enums.length} enum type(s) and ${tables.length} table(s) across schemas: ${SCHEMAS.join(", ")}`);
for (const warning of warnings) console.log(`WARNING: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`DRIFT: ${error}`);
  console.error(`\n${errors.length} drift error(s) found. Reconcile the database and the lib/db/drizzle migrations before promoting.`);
  process.exit(1);
}
console.log("No schema drift detected.");
process.exit(0);
