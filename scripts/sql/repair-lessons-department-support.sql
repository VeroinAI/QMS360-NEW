-- Operator-run, schema-only repair for Lessons department support.
-- Confirm the intended Quality / Drona QMS database and take a backup first.
-- This does NOT modify users, permissions, existing Lessons or master data.
-- Do not run through application startup or a read-only production connection.
-- Migration history requires separate reconciliation: see the companion README.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('qms360:lessons-department-schema-repair'));

DO $preflight$
BEGIN
  IF to_regclass('app2_lessons.lesson_learned_forms') IS NULL
     OR to_regclass('app2_lessons.user_workspace_roles') IS NULL THEN
    RAISE EXCEPTION 'Expected QMS Lessons tables are absent. Confirm the target database; no changes applied.';
  END IF;
END
$preflight$;

ALTER TABLE "app2_lessons"."lesson_learned_forms"
  ADD COLUMN IF NOT EXISTS "department_id" uuid;
ALTER TABLE "app2_lessons"."user_workspace_roles"
  ADD COLUMN IF NOT EXISTS "department_ids" uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

DO $types$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app2_lessons' AND table_name = 'lesson_learned_forms'
      AND column_name = 'department_id' AND udt_name = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app2_lessons' AND table_name = 'user_workspace_roles'
      AND column_name = 'department_ids' AND udt_name = '_uuid' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Existing department columns have an unexpected definition. Repair aborted; review the schema manually.';
  END IF;
END
$types$;

-- Project Lessons retain their project IDs. Department Lessons need no project.
ALTER TABLE "app2_lessons"."lesson_learned_forms"
  ALTER COLUMN "project_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "lesson_department_reference_active_idx"
  ON "app2_lessons"."lesson_learned_forms"
  USING btree ("organization_id", "department_id", "reference_number")
  WHERE "deleted_at" IS NULL AND "department_id" IS NOT NULL;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('app2_lessons.lesson_department_reference_active_idx')
      AND indrelid = to_regclass('app2_lessons.lesson_learned_forms')
      AND indisunique AND indisvalid AND indnkeyatts = 3
      AND pg_get_indexdef(indexrelid, 1, true) = 'organization_id'
      AND pg_get_indexdef(indexrelid, 2, true) = 'department_id'
      AND pg_get_indexdef(indexrelid, 3, true) = 'reference_number'
      AND regexp_replace(pg_get_expr(indpred, indrelid), '[[:space:]()]', '', 'g')
        = 'deleted_atISNULLANDdepartment_idISNOTNULL'
  ) THEN
    RAISE EXCEPTION 'Department reference index does not match the required definition. Repair aborted.';
  END IF;
END
$postflight$;
COMMIT;
