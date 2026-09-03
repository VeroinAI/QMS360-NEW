---
name: Drizzle multi-schema push/generate quirks
description: How to apply multi-pgSchema Drizzle changes to the dev DB when drizzle-kit generate/push fail non-interactively
---

When `lib/db` uses multiple `pgSchema()` schemas (QMS360: shared, app1_qaqc, app2_lessons, app3_audit), `drizzle-kit generate` and `push` are unreliable in this environment.

**Why:** `generate` blocks on interactive create-vs-rename prompts (needs a TTY; piping/`script` don't satisfy it). `push --force` fails with "schema does not exist" if schemas aren't pre-created, and with "type X already exists" if a previous partial push left enum types behind; it can also report "Changes applied" while creating nothing when its snapshot state mismatches.

**How to apply:**
1. Pre-create/drop schemas manually with pg (`CREATE SCHEMA` / `DROP SCHEMA ... CASCADE`) — also drop leftover enum types inside them.
2. Apply `pnpm exec drizzle-kit export --config ./drizzle.config.ts` output directly in one transaction. Note: enums declared inside a per-schema factory function (e.g. app-common.ts helper creating evidence_status/notification_channel per schema) may be MISSING from the export — inject their `CREATE TYPE` statements manually before applying, and strip `CREATE SCHEMA` lines if schemas already exist.
3. Never run `pkill -f drizzle-kit` from a shell whose own command line contains that string — pkill matches the invoking shell and kills it (silent exit -1, no output).
