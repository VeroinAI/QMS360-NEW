# Customer frontend/backend repository delivery

The existing combined GitHub repository remains the authoring source and keeps
its current Drona/AWS delivery. This additional workflow exports independently
buildable workspaces to two customer-owned **vendor-sync** branches. It never
pushes to their main branches, opens PRs, deploys, or runs migrations.

## One-time GitHub setup

1. Ask the customer to create two **private** repositories with a README and a
   `vendor-sync` branch in each. Keep their deployment configuration on their
   own deployment branches, or in files the export does not own.
2. Create a fine-grained GitHub token, owned by an account with access, restricted
   to these two repositories, with **Contents: Read and write**. Both repositories
   must be selectable under that token's resource owner. Obtain any required
   organization approval; if they have different owners, use separately scoped
   credentials and adapt the workflow rather than broadening access silently.
3. In the **source** GitHub repository, Settings → Secrets and variables → Actions,
   add secret `CUSTOMER_REPO_TOKEN`. Never put its value in code or chat.
4. Add repository **variables** (not secrets):

   | Variable | Value |
   |---|---|
   | `CUSTOMER_FRONTEND_REPO` | actual `customer-owner/frontend-repo` |
   | `CUSTOMER_BACKEND_REPO` | actual `customer-owner/backend-repo` |
   | `CUSTOMER_SYNC_ENABLED` | Leave unset for manual-only; set `true` after acceptance to enable pushes |

5. Commit this workflow, scripts and guide to the existing source repository.
   This workspace change does **not** itself push to GitHub. Source branch is
   assumed to be `main`; if different, change both `on.push.branches` and the
   job's `github.ref` guard together.
6. Ensure GitHub Actions allows the referenced actions and the customer branch
   rules permit this account to push normally to `vendor-sync`. No force push or
   branch-protection bypass is used.

## First run and acceptance

On the source repository: Actions → **Sync customer repos** → Run workflow, branch
`main`. It tests ownership safeguards, exports frontend/backend, installs each
with a frozen lockfile, typechecks and builds both, and only then checks out the
customer branches and applies the changes.

Inspect both branch diffs and build logs. Create a PR from `vendor-sync` into each
customer deployment branch and let their existing deployment process handle the
release. Frontend delivery retains Drona mode; backend includes runtime report
templates, fonts and migration resources. API routing, environment configuration,
storage and production data are not transferred by this workflow.

## Source push rejected for missing `workflow` scope

If GitHub says an OAuth App cannot create/update
`.github/workflows/sync-customer-repos.yml` without `workflow` scope, this is an
authorization failure, not evidence of divergent branches. The customer
`CUSTOMER_REPO_TOKEN` does not authenticate Replit's push to the source repository.
Do not force-push, reset history or broaden the customer token to address it.

GitHub documents an exception: an OAuth token without this scope can commit a
workflow if the **same path and exact contents** already exist on another branch
in the same repository.

1. On the **source repository's GitHub website**, create a temporary branch such
   as `workflow-permission-bootstrap` from its current `main`. Do not change
   `main` on the website, so the local source branch does not need reconciliation.
2. On that temporary branch, use Add file → Create new file, enter
   `.github/workflows/sync-customer-repos.yml`, and paste the complete, unchanged
   contents of the prepared local file. Commit to the temporary branch only.
3. Retry the normal Replit push to `main`. The identical workflow now exists on
   another branch, satisfying GitHub's documented exception.
4. After the push succeeds, confirm the workflow is on `main`; the temporary
   branch can then be removed through the normal GitHub UI.

This does not grant Replit's OAuth credential additional scopes. Future workflow
content changes may require repeating the exact-content bootstrap, or using a
source push credential explicitly authorized to write workflows. Ordinary source
code changes do not need a new workflow permission.

Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
(`workflow` scope).

## File ownership and safety

- Only tracked files in the selected app and its workspace dependency closure
  are exported. Backend additionally includes the operator migration tooling.
- No whole-repository mirror, `.env`, private keys, `.git`, customer workflows,
  uploaded attachments, development databases, seed scripts, node_modules or
  build output is copied. Generated build output is for validation only.
- `.qms360-customer-export.json` records managed paths and checksums. Files
  removed upstream are deleted **only if previously owned by this manifest**.
- The customer README, `.github/` workflows and other unowned files are retained.
  Delivery instructions use `QMS360-DELIVERY.md`, not the customer's README.
- A first-run collision with a different customer file aborts instead of
  overwriting it. A manual modification/deletion of an already managed file on
  `vendor-sync` also aborts; reconcile it explicitly before rerunning. Do not
  manually delete/edit the ownership manifest.
- This is one-way source delivery, not bidirectional Git history synchronization.
  Customer changes to exported application code should be coordinated upstream.
- Both exports build before pushing, but GitHub cannot atomically push across
  two repositories. If the second push fails, resolve the error and rerun; the
  first repository will be unchanged if already synced. Do not release until
  both branches identify the intended source commit.
- Cross-repository token pushes can trigger workflows on the customer's branch.
  Their deployment workflows should deploy only their approved release branches,
  not `vendor-sync`.
- Token expiration, missing branches and permission/protection failures cause
  explicit failures; they do not silently fall back to another branch.

## Local verification (no customer access required)

```sh
node --test scripts/customer-repos/customer-repos.test.mjs
node scripts/customer-repos/export.mjs frontend /tmp/qms360-customer-frontend
node scripts/customer-repos/export.mjs backend /tmp/qms360-customer-backend
cd /tmp/qms360-customer-frontend
pnpm install --frozen-lockfile
pnpm run build
# Repeat install/build inside the backend export.
```

Destinations must be empty. Durable local exports belong under the already
ignored `generated-artifacts/` directory. The export retains original dependency
specifiers and a lockfile that can contain unused monorepo importer metadata;
unrelated application source is not included. Future new `workspace:*`
dependencies are followed automatically; unsupported layouts fail explicitly.
After dependency, asset or workspace changes, validate exports again before
releasing. Do not replace frozen installs with non-frozen installs to hide drift.
