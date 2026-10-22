# Lessons unavailable: department-schema repair

## Confirmed Quality-server cause

The deployed Lessons queries expect department support, but the Quality database
is missing `app2_lessons.lesson_learned_forms.department_id` and
`app2_lessons.user_workspace_roles.department_ids`. The project field also still
requires a value, and the department reference index is missing. PostgreSQL
reports `42703: column "department_id" does not exist`; the overview and Lessons
lists then return HTTP 500.

Development has these schema changes. The source migration already exists in
`lib/db/drizzle/0026_last_archangel.sql`. This is a database/code release mismatch,
not a reason to remove department authorization checks or grant wider access.

## Operator procedure

1. Confirm the exact target database and take a backup. Quality and Drona may
   have different databases; do not assume a repair to one affects the other.
2. Check the catalog using the read-only SQL below.
3. On a database confirmed to have the same gap, run the companion
   `repair-lessons-department-support.sql` with an authorized database operator.
   It is transactional and rerunnable, adds only the required schema support,
   and does not change existing Lesson values, users, roles, or permissions.
   It fails instead of coercing incompatible existing column/index definitions.
4. If a statement fails, issue `ROLLBACK` if your SQL client leaves the
   transaction open. Resolve that failure before retrying.
5. Repeat the catalog check, then open the Lessons overview and list with a
   normal authorized account. Confirm a project Lesson still opens and a
   department Lesson can be created with an authorized department role.
   Confirm `/api/apps/lessons/overview` and `/api/lessons/log` no longer return
   missing-column errors.

```sql
SELECT table_name, column_name, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'app2_lessons'
  AND ((table_name = 'lesson_learned_forms'
        AND column_name IN ('project_id', 'department_id'))
       OR (table_name = 'user_workspace_roles'
           AND column_name = 'department_ids'));

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'app2_lessons'
  AND indexname = 'lesson_department_reference_active_idx';
```

Expected: `department_id` is nullable UUID, `department_ids` is non-null UUID
array with an empty-array default, `project_id` is nullable, and the unique
partial department-reference index exists.

## Migration-history warning

The Quality migration ledger is also behind the source journal. Do not blindly
run all migrations, record the entire baseline, or add only the newest ledger row:
older changes may already exist manually, and advancing the high-water mark can
cause genuinely missing older migrations to be skipped.

This targeted repair intentionally does not write migration history. Reconcile
the complete catalog against the source journal separately, then record only
verified applied migrations using the project's existing operator procedure.
Do not overwrite production with development data, add startup DDL, or treat
another Publish by itself as database repair.

## Drona impact

The QMS Lessons APIs use these same tables when accessed through Drona.
An outdated Drona-hosted QMS database can therefore produce the same failures,
including role/project/department access resolution. Drona's native platform is
not proven to have this cause: its own database and error logs must be checked.
This repair does not change Drona source masters, authentication, environment
configuration, or external project membership.
