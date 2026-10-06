---
name: Drizzle multi-schema migration quirks
description: How drizzle-kit tracks state in this multi-schema project, why hand-written migrations silently desync it, and who owns the production schema.
---

## drizzle-kit's state is meta/*_snapshot.json, NOT the .sql files

Adding a hand-written `.sql` file to the migrations folder (and a `_journal.json`
entry) does **not** teach drizzle-kit anything. Its diff engine reads only the
newest `meta/*_snapshot.json`. Hand-authored migrations therefore accumulate
invisibly: the folder grows, the snapshot stays frozen, and the next
`drizzle-kit generate` emits a migration that re-creates every object added since
the last real generate — objects that already exist in the database.

**Why:** this project reached 15 migration files with only a `0000` snapshot.
`generate` then wanted to create 7 enums and 5 tables that were already live.

**How to apply:** always create migrations with
`pnpm --filter @workspace/db run generate`. Never hand-write a `.sql` file into
`lib/db/drizzle/`. To check for this desync, run `generate` on a clean tree — a
healthy repo prints "No schema changes, nothing to migrate".

If the snapshot has already desynced, it cannot be repaired incrementally
(intermediate snapshots never existed). Squash: delete `drizzle/*.sql` and
`drizzle/meta/*`, write an empty journal (`{"version":"7","dialect":"postgresql","entries":[]}`
— `generate` errors with ENOENT without it), regenerate one baseline, then
re-record the ledger on every existing database via the `record-baseline` script
so the baseline is marked applied rather than replayed.

## Enums declared inside a per-schema factory ARE collected

An earlier version of this note claimed drizzle-kit misses enums created by a
factory helper (`schema.enum(...)` inside a shared `createAppAdministration`
function), requiring hand-maintained `CREATE TYPE` blocks. **That is no longer
true** on drizzle-kit 0.31.x — `generate` emits all 9 enums across the four
schemas correctly. Do not re-add manual enum blocks.

`generate` also does not need an interactive TTY; `--name <tag>` runs clean under
`< /dev/null`.

## New composite foreign keys need their unique indexes first

Check statement ordering when a generated migration adds both a composite
foreign key and its prerequisite unique index. The generator can emit the
foreign key before the index.

**Why:** PostgreSQL cannot install that foreign key until its referenced
columns have the matching uniqueness guarantee, even if the index appears
later in the same migration.

**How to apply:** Reorder the generated SQL statements so prerequisite indexes
precede foreign keys, without changing the generated schema snapshot/journal.
Validate the entire migration in a rollback-only transaction before handoff.

## Who owns which database

- **Development** — the development post-merge flow owns additive schema application. If a push reports an already-existing multi-schema enum, inspect the namespace filter before attempting any DDL repair; never blindly force a broad push.
- **Replit production** — Replit Support told the user Publish migrates `public`
  only for this project; custom schemas are not included. A support-reviewed
  manual schema-only reconciliation is required for missing custom-schema
  objects. Never wire schema DDL into a deploy build hook, an artifact's
  `[services.production]`, or the server entrypoint; the database skill names
  all three as unsafe patterns.
- **A Postgres Replit does not manage** (the client's own production instance) —
  the versioned migrations are the source of truth, applied by an operator-run
  migrate command that requires an explicit target connection string and refuses
  to run against the development database.

Publishing's diff for this project does not cover custom schemas, per the user's
Replit Support response. Even for covered schemas, a generated migration merged
without successful development-schema application does not produce a production
diff, so publishing new code can leave production missing a column it expects.

**Why:** a merged authentication column existed in both the Drizzle schema and
generated migration, but not in the live development database; repeated publishes
deployed code that queried the absent production column and all logins returned 500.

**How to apply:** after merges that add schema, verify the column or table in the
live development database, then plan a separate reviewed production reconciliation
for custom schemas. For rollout-sensitive reads, prefer a backward-compatible
query until production migration is confirmed.

Rollout-sensitive writes also need compatibility when a newly added column is not
yet present. Check column availability before constructing the update rather than
catching a failed transaction after it references the missing column.

**Why:** administrator-set temporary passwords failed entirely while production
lacked the password-reset flag column. The compatible fallback can still update
the password, but forced replacement cannot be enforced until Publish installs
the column.

**How to apply:** keep the fallback narrow and temporary, preserve full behavior
when the column exists, and complete a reviewed production schema reconciliation
as the durable fix.

## Verify reported production diffs against the live catalog

Do not treat a “no differences” schema report as proof that production matches
development when the deployed runtime reports missing relations or columns.
Confirm rollout-sensitive objects with a read-only production catalog query.

**Why:** the schema report returned no pending statements while both the live
request logs and `information_schema` showed two feedback tables absent from
production, even though they existed in development.

**How to apply:** use a reviewed schema-only reconciliation for custom-schema
objects, but keep narrow application compatibility for critical features until
the live production catalog confirms the required object exists. Never compensate
with startup DDL or a production-targeted migration hook.

## PostgreSQL push success can be misleading

Drizzle-kit 0.31.x's PostgreSQL CLI can catch an SQL error, print it, and still
return exit status zero. A shell's `set -e` alone does not prove schema application.
Multi-schema introspection also defaults to `public`; missing app namespaces in
the filter make already-present enums look new.

**Why:** an existing `evidence_status` conflict hid missing additive development
columns while setup reported success. Inspection of the installed kit confirmed
the error was caught without a failing exit status.

**How to apply:** treat namespace coverage and successful live-catalog checks as
required evidence after development schema updates. Preserve error propagation
when changing the push tooling; an apparently successful subprocess is not enough.
