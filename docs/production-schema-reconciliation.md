# Published QMS360 schema reconciliation

Read-only comparison after the reported republish confirms that the published
database still lacks these development definitions:

| Missing objects | Canonical migration |
| --- | --- |
| record_type (text) and record_id (uuid) on notifications in app1_qaqc, app2_lessons and app3_audit | lib/db/drizzle/0006_yummy_eddie_brock.sql |
| app1_qaqc.qaqc_report_delivery_runs and app1_qaqc.qaqc_report_submissions, including their foreign keys and unique indexes | lib/db/drizzle/0020_serious_talos.sql |
| shared.application_access.application_reviews (jsonb NOT NULL DEFAULT '{}'::jsonb) | lib/db/drizzle/0021_long_meggan.sql |

The inspection compared column presence, underlying type, nullability and
default definitions across public/shared/all three application schemas. There
were 37 missing column definitions: 30 within the two absent reporting tables
and seven on existing tables. This does not establish complete equality of
indexes, foreign keys, enum labels, triggers or migration-ledger state.

## Approved production process

The above three existing SQL files currently contain only the missing changes.
Have the authorized production database administration/Replit Support process
review them, verify the affected published database target, preserve a recovery
point, and reconcile the migration ledger before applying the targeted changes.
Apply as a reviewed transaction with bounded lock/statement timeouts.

Do not replay the baseline or every historical migration. Do not use overwrite
production data, force push, startup DDL, or development data import. Do not
apply the Drona DEV/QA mirror to this database or to AWS.

These changes add schema objects, not users, projects, reporting rows, passwords
or approval decisions. Empty application_reviews defaults preserve existing
access flags and legacy audit evidence; no approvals are fabricated.

If the target changes before execution (for example another operator has already
applied a subset), inspect it again and reconcile only the remaining statements.
The original migrations are not idempotent; blindly rerunning them is not safe.
Record what was applied through the approved ledger process, without guessed
migration hashes/timestamps.

After execution, compare the production schema again, including indexes and
foreign keys, and verify Users & Access and QA/QC reporting on the published app.

No production DDL was executed during this investigation.