import assert from "node:assert/strict";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { text, uniqueIndex } from "drizzle-orm/pg-core";
import { pool } from "../src/index";
import * as schema from "../src/schema";
import { managedSchemas } from "../src/managed-schemas";
import { applySafePlan, assertDevelopment } from "./push-safety";

assertDevelopment(process.env, process.argv.slice(2));
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Transaction-scoped fixtures: no production access, no persisted test data,
  // and no broad pushes. Fail if names exist rather than touching existing data.
  await client.query('CREATE TABLE "shared"."__development_push_regression" ("id" text PRIMARY KEY)');
  await client.query('CREATE UNIQUE INDEX "__development_push_regression_idx" ON "shared"."__development_push_regression" ("id")');
  await client.query('CREATE TYPE "app3_audit"."__development_push_enum" AS ENUM (\'one\')');
  const expected = {
    ...schema,
    fixtureTable: schema.sharedSchema.table("__development_push_regression", {
      id: text("id").primaryKey(),
      newColumn: text("new_column"),
    }, (table) => [uniqueIndex("__development_push_regression_idx").on(table.newColumn)]),
    fixtureEnum: schema.app3AuditSchema.enum("__development_push_enum", ["one", "two"]),
  };
  const db = drizzle(client);
  const plan = await pushSchema(expected, db, managedSchemas);
  // Without the multi-schema filter this would recreate all evidence_status
  // enums. The real database must recognize them as already present.
  assert.ok(!plan.statementsToExecute.some((statement) => /CREATE TYPE .*"evidence_status"/i.test(statement)));
  const count = await applySafePlan(plan, (statement) => db.execute(sql.raw(statement)));
  assert.equal(count, 2, "only the fixture column and enum label should be missing");
  const column = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3", ["shared", "__development_push_regression", "new_column"]);
  assert.equal(column.rowCount, 1);
  const preservedIndex = await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2", ["shared", "__development_push_regression_idx"]);
  assert.match(preservedIndex.rows[0].indexdef, /\(id\)$/, "the existing unique index must be preserved instead of recreated");
  const labels = await client.query("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname=$2 ORDER BY e.enumsortorder", ["app3_audit", "__development_push_enum"]);
  assert.deepEqual(labels.rows.map((row) => row.enumlabel), ["one", "two"]);
  const second = await pushSchema(expected, db, managedSchemas);
  assert.equal(await applySafePlan(second, (statement) => db.execute(sql.raw(statement))), 0, "repeated push should not reapply additions");
  console.log("PASS: live multi-schema enum introspection, additive column/enum updates, preserved replacement index, and repeated no-op push");
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}