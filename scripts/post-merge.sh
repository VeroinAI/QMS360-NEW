#!/bin/bash
set -e

# Dependencies must install cleanly — a stale lockfile fails the merge.
pnpm install --frozen-lockfile

# Schema sync is best-effort: drizzle-kit push needs an interactive TTY and
# re-creates factory-helper enums that already exist (42710), so a push
# failure must NOT fail the merge. The dev database schema is applied via the
# versioned baseline migration (lib/db/drizzle/) + scripts/production-schema.sql.
pnpm --filter db push || echo "WARNING: drizzle-kit push did not complete cleanly (known multi-schema enum quirk); schema sync skipped. Apply schema changes via lib/db/drizzle migrations instead."
