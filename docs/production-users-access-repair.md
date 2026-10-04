# Production Users & Access schema repair

## Confirmed diagnosis

Read-only inspection of the published QMS360 database confirmed that
`shared.application_access.application_reviews` is absent. The current
application-access queue selects and filters that column; Users & Access treats
a failed queue request as an administration-page error.

The existing canonical migration is `lib/db/drizzle/0021_long_meggan.sql`.
This is a production schema reconciliation issue, not a reason to grant more
permissions or change the administrator account.

No production write, role change, startup migration or application workaround
was performed during this investigation.

## Authorized operator procedure — NOT automatically executed

1. Independently verify the target is the affected published QMS360 database,
   not development or Drona/AWS. Follow the approved backup/change-review process.
2. Reconcile the production migration ledger and whether the canonical migration
   has already been recorded. Do not replay the baseline or all historical SQL.
3. Apply the narrowly scoped additive repair below through the approved
   production database administration/support process.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "shared"."application_access"
  ADD COLUMN IF NOT EXISTS "application_reviews"
  jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'shared'
      AND table_name = 'application_access'
      AND column_name = 'application_reviews'
      AND udt_name = 'jsonb'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'application_reviews definition requires review';
  END IF;
END $$;
COMMIT;
```

The empty object does not approve or reject any application. Existing access
flags, user/project/role assignments and approval audit history remain unchanged.
The application already handles legacy review evidence from the appropriate
application's audit log. This repair does not invent or backfill decisions.

Record the reconciliation through the approved migration-ledger process so a
later migration runner does not repeat the original non-idempotent ADD COLUMN.
Do not manually insert guessed hashes/timestamps into the ledger.

## Verify after the repair

```sql
SELECT table_schema, table_name, column_name, data_type,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'shared'
  AND table_name = 'application_access'
  AND column_name = 'application_reviews';
```

Expected: `jsonb`, `is_nullable = NO`, empty JSON object default.

Then reload Users & Access on the affected published URL. Check the user list,
roles, pending queue and delegation loading. Test an approved administrator's
approval/rejection workflow with an authorized test account, and verify no
unrelated application's access flag changes.

The live repair has not been applied or verified. Republishing alone is not a
confirmed remedy for this project's observed custom-schema synchronization gap.
Separate missing QA/QC reporting tables are not included in this repair.