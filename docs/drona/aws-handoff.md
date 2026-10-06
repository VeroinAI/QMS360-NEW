# QMS360 AWS handoff

**Current handoff:** [Drona email-only exception](email-exception-handoff.md).
The owner approved the exception for the shared Drona PRD/UAT environment.
Use that document for current automatic identity/project setup, one-time migrations and
activation. The notes below describe the earlier blocked-verifier preparation
and are retained as historical context, not current activation instructions.

## Historical preparation notes

The code can be built and reviewed now. It is **not yet an accepted live Drona
login/access integration**. Do not tell users that cloning alone enables SSO.

## Current behavior

- No authentication environment variable was changed in this workspace.
- Default local mode preserves current DEV/QA login and data.
- `AUTH_STRATEGY=drona` selects the Drona-only sign-in screen. It loads the
  supplied SDK and reads only `uid`/`nonce` from the profile in memory.
- `/api/auth/drona` validates input shape but returns HTTP 503 until real backend
  verification and access reconciliation are implemented. It never issues a
  token, creates a user, logs a nonce or looks up an unverified identity.
- In Drona mode, local login/register, the unrelated container bridge and old
  local/admin tokens cannot authorize access. Unknown strategies also fail closed.
- Selecting Drona is an intentional temporary lockout while incomplete. Do not
  enable it on a live environment expecting usable sign-in yet.
- The membership intersection helper is review/test code, not live RBAC wiring.
  It uses the confirmed active-user/mapped-active-project condition, intersects
  capability-specific QMS scope, excludes inactive memberships and never yields
  unrestricted scope. enable_quality is ignored for access.
- Local/legacy container JWT lifetimes and behavior are not changed. Drona
  session expiry/revocation must be implemented from the actual contract.

## Repository/privacy check BEFORE syncing

The supplied user/project/membership CSV uploads are currently tracked by Git.
They contain real source data; **do not send the current repository or history
to a public GitHub repository as-is**. An ignore rule alone cannot remove tracked
files or their history.

The owner must approve a sanitized handoff/export or appropriate repository
history cleanup. Keep the original private workspace files for reference.
Exclude production personal/signature datasets, private mapping files, secrets,
credentials and environment files. The app build imports only the supplied
SDK asset from these new uploads, not those CSV datasets.

## Build on the reviewed AWS target

Use a Node.js version compatible with the repository and a pnpm version
compatible with the committed lockfile. Do not substitute the generic guide's npm/server.js
examples for this monorepo.

From the workspace root:

```
pnpm install --frozen-lockfile
pnpm run typecheck:libs
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/qms360 run build
pnpm --filter @workspace/api-server run build
```

PORT and BASE_PATH above are frontend build inputs, not a request to expose
5173 publicly. If hosting under a prefix, use the approved prefix ending in `/`
instead of `/`, then test that API routing also remains correct for that layout.

Frontend output: `artifacts/qms360/dist/public`.
Backend output/entry: `artifacts/api-server/dist/index.mjs`.
Retain the backend dist worker/runtime assets and the packaged report/template
assets produced by its build. Do not deploy only index.mjs.

Have the AWS deployment owner configure the existing required server secrets,
database connection, PORT and environment securely. Do not copy secret values
into email, GitHub, this document or browser code. The backend listens on its
configured port; a private instance/security-group/proxy boundary must prevent
unintended direct public access.

Run the backend from its artifact directory with its existing `start` script.
The existing app also requires QMS business tables/templates and appropriate
evidence storage configuration; this work does not migrate storage or repair
unrelated reporting tables.

For a reviewed root-mounted deployment, the reverse proxy should:

- Terminate HTTPS using the organization's approved certificate setup.
- Serve the frontend build with SPA fallback to index.html for app navigation.
- Route `/api/` to the Node backend without stripping the `/api` prefix.
- Route the existing protected file paths to Node rather than SPA fallback
  (review `routes/files.ts` and `routes/feedback-files.ts` for the configured paths).
- Set appropriate forwarded headers and verify the application's proxy trust
  and CORS/frame/CSP policies against the actual infrastructure and container.
- Serve the emitted Drona SDK asset. Test container readiness in the supported
  Drona clients; availability in a plain browser is not assumed.

## Database preparation — no automatic SQL

Use the schema inspection and review drafts in this directory. The DEV/QA
source-mirror candidate has explicit unconfirmed choices and refuses to recreate
existing source tables. **Never apply it to AWS.**

The QMS link-table draft is also not a registered migration. Canonical
definitions/snapshot state and the actual ledger must be reconciled before a
reviewed migration is applied. No migration runner or startup DDL has been
added for this integration.

The read-only preflight can be run by an authorized owner:

```
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/scripts/drona-preflight.ts --environment dev
```

Replace the label with the intended environment. The label does NOT select or
prove a database target; the operator must independently verify the configured
connection. The report deliberately keeps `activationReady` false.

Once source/link tables exist under reviewed definitions, supply a private JSON
mapping array using `--mapping-file <private-file>`. Each object contains:
environment, organizationId, kind (`user` or `project`), internalId, externalId
(decimal string), reviewReference. Never commit that file. The validator performs
no data migration and emits only counts, not identities.

The preflight uses one READ ONLY transaction with a statement timeout and
reports source/link-table availability, actual module array types, internal
user/project and existing app-assignment counts, and mapping summary where
provided. It is not a substitute for full schema/history parity checks.

## Remaining acceptance gates

Send `email-to-drona-team.txt` to the Drona technical owner. Finish backend
verification, session revocation, preserved QMS application access, tenant/department
coverage, identity/assignment reconciliation and endpoint/UI coverage before
activating Drona. Then run the coherent critical-journey acceptance pass,
including downloads/reports and VerionAI.

No AWS configuration, production migration, live Drona session, or AWS deployment
was verified by this workspace change.