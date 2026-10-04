#!/bin/bash
set -euo pipefail

trap 'echo "ERROR: Development setup failed at line $LINENO. Do not Publish until setup and check-drift both pass. No production schema changes were attempted." >&2' ERR

# Dependencies must install cleanly — a stale lockfile fails the merge.
pnpm install --frozen-lockfile

# Sync additive development changes only. Never force destructive changes. Closed
# stdin prevents unattended rename/data-loss prompts from waiting for input.
pnpm --filter @workspace/db run push < /dev/null

# Schema drift guard: compares the live development database and the versioned
# migrations in lib/db/drizzle against lib/db/src/schema (enum types/labels,
# tables, columns). This is the check that stops enum types from slipping past
# database change scripts — investigate any DRIFT lines before promoting.
#
# Note: the production database schema is applied by Replit's Publish flow, which
# diffs development against production. Nothing here writes to production.
pnpm --filter @workspace/scripts run check-drift

echo "Development schema setup and drift checks passed. Production changes remain in Publish / Replit Support."
