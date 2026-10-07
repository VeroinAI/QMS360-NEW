FROM node:22-slim AS build
WORKDIR /workspace
RUN corepack enable

# Workspace manifests first (cache-friendly) -- everything pnpm needs to
# resolve the graph, nothing that changes on every source edit.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/field-controls/package.json lib/field-controls/package.json
COPY lib/spreadsheet-dates/package.json lib/spreadsheet-dates/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."

COPY artifacts/api-server artifacts/api-server
COPY lib/db lib/db
COPY lib/api-zod lib/api-zod
COPY lib/api-client-react lib/api-client-react
COPY lib/field-controls lib/field-controls
COPY lib/spreadsheet-dates lib/spreadsheet-dates

RUN pnpm --filter @workspace/api-server run build

# `pnpm deploy` (not a manual node_modules copy) -- pnpm's per-package
# node_modules are relative symlinks whose targets only resolve correctly
# at their original nesting depth, so copying them into a differently-
# shaped runtime image silently breaks externalized deps (esbuild leaves
# nodemailer, etc. as real requires, not bundled -- see build.mjs's
# `external` list). deploy resolves everything into a flat, relocatable
# node_modules instead.
RUN pnpm --filter @workspace/api-server deploy --prod /deploy

FROM node:22-slim AS runtime
# Mirrors the build stage's own path (not /app) -- esbuild-plugin-pino
# bakes pino's worker-thread scripts (dist/thread-stream-worker.mjs etc.)
# in as absolute paths computed at build time from this exact location, so
# the runtime image has to reproduce it or those workers 404 at startup.
WORKDIR /workspace/artifacts/api-server
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /workspace/artifacts/api-server/dist ./dist

EXPOSE 8000
ENV PORT=8000
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
