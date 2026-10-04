# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — apply additive DB schema changes (dev only; rejects destructive plans)
- `pnpm --filter @workspace/scripts run check-drift` — required live-development and migration check before Publish
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

- Post-merge setup must pass before Publish. Schema source is `lib/db/src/schema`; use `pnpm --filter @workspace/db run generate` for versioned migrations, not handwritten SQL. A missing migration needs generation; a missing live object needs a successful development push.
- Automatic development push preserves existing defaults/indexes and constraint replacements, reporting them as `MAINTENANCE`. These non-additive changes require separate review, not `push-force`. The drift check verifies expected tables, columns and enum labels; it is not a full definition/constraint comparison.
- Production remains managed by Publish. For custom-schema objects not covered by this project's Publish flow (per prior Replit Support guidance), request Support handling and verify the live catalog read-only. Never add schema writes to startup or deployment builds.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
