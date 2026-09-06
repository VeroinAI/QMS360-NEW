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

## Who owns which database

- **Development** — `drizzle-kit push` (and the post-merge script). Fine to mutate.
- **Replit production** — owned by the Publish flow, which diffs dev against prod
  and applies the change itself. Never wire schema DDL into a deploy build hook,
  an artifact's `[services.production]`, or the server entrypoint; the database
  skill names all three as unsafe patterns.
- **A Postgres Replit does not manage** (the client's own production instance) —
  the versioned migrations are the source of truth, applied by an operator-run
  migrate command that requires an explicit target connection string and refuses
  to run against the development database.
