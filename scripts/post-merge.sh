#!/bin/bash
set -e

# Dependencies must install cleanly — a stale lockfile fails the merge.
pnpm install --frozen-lockfile

# Sync the development database to lib/db/src/schema. Best-effort: a push failure
# must not fail the merge, and the drift guard below reports what was missed.
pnpm --filter @workspace/db run push || echo "WARNING: drizzle-kit push did not complete cleanly; schema sync skipped. Investigate the DRIFT lines below."

# Schema drift guard: compares the live development database and the versioned
# migrations in lib/db/drizzle against lib/db/src/schema (enum types/labels,
# tables, columns). This is the check that stops enum types from slipping past
# database change scripts — investigate any DRIFT lines before promoting.
#
# Note: the production database schema is applied by Replit's Publish flow, which
# diffs development against production. Nothing here writes to production.
if ! pnpm --filter @workspace/scripts run check-drift; then
  echo "WARNING: schema drift detected (see DRIFT lines above). Regenerate migrations with 'pnpm --filter @workspace/db run generate' before promoting."
fi
