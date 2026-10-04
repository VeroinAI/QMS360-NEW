import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDevelopment, applySafePlan } from "./push-safety";

test("production and overrides are refused before connecting", () => {
  assert.throws(() => assertDevelopment({ NODE_ENV: "production" }, []), /development-only/);
  assert.throws(() => assertDevelopment({ REPLIT_DEPLOYMENT: "1" }, []), /development-only/);
  assert.throws(() => assertDevelopment({}, ["--force"]), /no arguments/);
  assert.throws(() => assertDevelopment({}, ["--url=other"]), /no arguments/);
  assert.doesNotThrow(() => assertDevelopment({ NODE_ENV: "development" }, []));
});

test("additive changes and repeated no-op pushes apply", async () => {
  let applied = 0;
  for (const statements of [
    ['ALTER TABLE "shared"."application_access" ADD COLUMN "application_reviews" jsonb DEFAULT \'{}\'::jsonb NOT NULL;'],
    [],
  ]) {
    await applySafePlan({ hasDataLoss: false, warnings: [], statementsToExecute: statements }, async () => { applied++; });
  }
  assert.equal(applied, 1);
});

test("destructive plans never apply, even for empty tables", async () => {
  for (const statement of [
    'DROP TABLE "app3_audit"."audits";',
    'ALTER TABLE "shared"."users" DROP COLUMN "name";',
    'DROP SCHEMA "app2_lessons";',
    'DROP TYPE "app1_qaqc"."evidence_status";',
    'TRUNCATE TABLE "shared"."users";',
    'ALTER TABLE "shared"."users" ALTER COLUMN "name" TYPE integer;',
    'UPDATE "shared"."users" SET "name" = NULL;',
  ]) {
    let applied = false;
    await assert.rejects(applySafePlan({ hasDataLoss: false, warnings: [], statementsToExecute: [statement] }, async () => { applied = true; }), /refused/);
    assert.equal(applied, false);
  }
  await assert.rejects(applySafePlan({ hasDataLoss: true, warnings: [], statementsToExecute: [] }, async () => assert.fail("must not apply")), /refused/);
});

test("SQL failures reject instead of reporting success", async () => {
  await assert.rejects(applySafePlan({ hasDataLoss: false, warnings: [], statementsToExecute: ['CREATE TYPE "app3_audit"."example" AS ENUM(\'one\');'] }, async () => { throw new Error("enum conflict"); }), /enum conflict/);
});

test("unrelated default/index/constraint maintenance is preserved, not applied", async () => {
  const addition = 'ALTER TABLE "shared"."users" ADD COLUMN "example" text;';
  const applied: string[] = [];
  await applySafePlan({
    hasDataLoss: false, warnings: [],
    statementsToExecute: [
      'DROP INDEX "shared"."custom_index";',
      'ALTER TABLE "shared"."users" ALTER COLUMN "name" SET DEFAULT \'Unknown\';',
      'ALTER TABLE "shared"."users" DROP CONSTRAINT "existing_name";',
      'ALTER TABLE "shared"."users" ADD CONSTRAINT "existing_name_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON UPDATE no action;',
      addition,
    ],
  }, async (statement) => { applied.push(statement); });
  assert.deepEqual(applied, [addition]);
});

test("new tables, enums, enum labels, indexes, public columns and FKs are additive", async () => {
  const statements = [
    'CREATE SCHEMA "app3_audit";',
    'CREATE TYPE "app3_audit"."example" AS ENUM(\'one\');',
    'ALTER TYPE "app3_audit"."example" ADD VALUE \'two\';',
    'CREATE TABLE "app3_audit"."example" ("id" uuid PRIMARY KEY);',
    'CREATE UNIQUE INDEX "example_idx" ON "app3_audit"."example" ("id");',
    'ALTER TABLE "replit_provisioning_probe" ADD COLUMN "example" text;',
    'ALTER TABLE "shared"."users" ADD CONSTRAINT "new_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON UPDATE no action;',
  ];
  const applied: string[] = [];
  await applySafePlan({ hasDataLoss: false, warnings: [], statementsToExecute: statements }, async (statement) => { applied.push(statement); });
  assert.deepEqual(applied, statements);
});

test("index replacement preserves existing index and applies the later column", async () => {
  for (const unique of ["", "UNIQUE "]) {
    const addition = 'ALTER TABLE "shared"."users" ADD COLUMN "example" text;';
    const statements = [
      'DROP INDEX "shared"."existing_idx";',
      `CREATE ${unique}INDEX "existing_idx" ON "shared"."users" USING btree ("id");`,
      addition,
    ];
    const applied: string[] = [];
    await applySafePlan({ hasDataLoss: false, warnings: [], statementsToExecute: statements }, async (statement) => {
      // Simulate PostgreSQL's already-existing relation failure if recreated.
      if (statement.startsWith("CREATE")) throw new Error("relation already exists");
      applied.push(statement);
    });
    assert.deepEqual(applied, [addition]);
  }
});

test("index replacement matching is schema-scoped, including public", async () => {
  const newIndex = 'CREATE UNIQUE INDEX "same_idx" ON "app2_lessons"."lesson_learned_forms" USING btree ("id");';
  const newPublicIndex = 'CREATE INDEX "new_idx" ON "replit_provisioning_probe" USING btree ("id");';
  const applied: string[] = [];
  await applySafePlan({
    hasDataLoss: false, warnings: [],
    statementsToExecute: [
      'DROP INDEX "app1_qaqc"."same_idx";',
      'CREATE UNIQUE INDEX "same_idx" ON "app1_qaqc"."qaqc_metric_entries" USING btree ("id");',
      newIndex,
      'DROP INDEX "public"."same_idx";',
      'CREATE INDEX "same_idx" ON "replit_provisioning_probe" USING btree ("id");',
      newPublicIndex,
    ],
  }, async (statement) => { applied.push(statement); });
  assert.deepEqual(applied, [newIndex, newPublicIndex]);
});