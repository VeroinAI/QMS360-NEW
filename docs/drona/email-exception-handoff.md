# Drona email-only exception — GitHub/AWS handoff

## Approved scope and security limitation

The owner confirmed that Drona PRD and UAT use the same environment and approved
proceeding with profile email without Drona session or nonce validation.
This is **not verified SSO**. A caller who knows another user's email can attempt
to impersonate that user through the exception endpoint. Existing account,
mapping, approval and role checks limit what that identity can do; they do not
prove who the caller is. Restrict network exposure to the intended Drona users.

The exception is disabled by default. No workspace authentication settings, AWS
database, GitHub remote or live deployment were changed by this implementation.
The Replit DEV/QA environment remains separate from the shared Drona AWS target.

## Implemented behavior

- The browser obtains `profile.email` from the supplied Drona SDK. It sends only
  the normalized email to `POST /api/auth/drona`; no manual email input, password,
  profile UID, nonce or client-side nonce validation is used.
- The server matches that email against `public.user_master.user_email`.
  Missing, inactive and ambiguous source users are rejected.
- A reviewed, environment- and organization-specific link selects the existing
  QMS UUID. Its active QMS account must have the same email. Existing history,
  application approvals, usernames and role assignments are preserved.
- The server issues a signed QMS token valid for 30 minutes, explicitly marked
  `drona-email-exception` and bound to the source identity and environment.
  This is a QMS session, not a verified Drona session.
- Every protected request rechecks source/QMS account activity and identity
  linkage, and reads current active membership through
  `user_role_mapping → project_mapping → project_master`.
- Only linked, active QMS projects with an active source assignment and active
  source project survive the intersection with each operation's existing QMS
  project scope. Even global QMS grants cannot expand this project set.
  Unmapped projects are excluded. `enable_quality` and Drona role names grant
  no QMS privileges.
- Department-only Internal Process Audits retain their existing QMS approval
  and capability rules even when no Drona project is assigned. Only descendants
  of a confirmed Process schedule receive this projectless exception.
- Local sign-in, self-registration and the unrelated container bridge stay
  disabled in Drona mode. Old local tokens and tokens from another environment
  are rejected. Switching off the exception invalidates its sessions.
- Missing tables or unavailable source data fail closed; no startup DDL,
  automatic account creation, role conversion or silent fallback is performed.
- SDK login connects automatically when enabled, with a retry button on failure.
  A plain browser without the Drona SDK session cannot supply a profile.

## Before syncing through GitHub

Use the approved **private** repository. The workspace includes source-data
uploads and historical records that must not be copied to a public repository.
An ignore rule alone does not remove files already tracked in Git history.
Keep real identity mapping files, personal/signature datasets, credentials,
environment files and QA business data out of the handoff. Only code, schema
migrations and the supplied SDK asset are needed.

## Build

From the repository root, with its supported Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck:libs
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/qms360 run build
pnpm --filter @workspace/api-server run build
```

Serve `artifacts/qms360/dist/public` with SPA fallback and proxy `/api/` to
`artifacts/api-server/dist/index.mjs`, retaining its runtime/report assets.
Run the API from its artifact directory. Use HTTPS and the approved container,
proxy, CORS and frame policies; do not expose the backend directly to the public.
Verify file/evidence storage and existing SMTP configuration separately.

## Schema and reviewed mappings

1. Independently verify the target connection and inspect source/QMS schema and
   migration ledger. Drona owns the existing public master tables; never apply
   the DEV/QA mirror draft to AWS or run a broad schema push there.
2. The canonical additive migration is
   `lib/db/drizzle/0023_drona_identity_links.sql`. It adds two QMS link tables,
   composite tenant foreign keys and their prerequisite unique indexes.
   It does not alter Drona masters or replace existing QMS UUIDs.
   Use the existing operator migration process only after reconciling its
   baseline/ledger. Do not replay the entire history on a populated database or
   apply both this migration and the historical link-table draft.
3. Prepare a private reviewed JSON array. Each entry contains `environment`,
   `organizationId`, `kind` (`user`/`project`), `internalId`, `externalId`
   (decimal string, not a JavaScript number), and `reviewReference`.
   Existing internal users/projects must be inventoried first; new QMS records
   use the normal administrator workflow and receive no automatic role grants.
4. Use one environment key, for example `aws`, for the shared PRD/UAT target.
   Do not infer links from equal IDs or reuse Replit QA mappings on AWS.
5. Run the read-only preflight and mapping import dry-run:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/scripts/drona-preflight.ts --environment aws --mapping-file /secure/reviewed-links.json
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/scripts/drona-import-links.ts --environment aws --reviewer REVIEWER_UUID --mapping-file /secure/reviewed-links.json
```

The reviewer must be an active QMS platform administrator in each mapped
organization. User links require exactly one matching source email. The import
refuses conflicts and is idempotent; it never reassigns an existing link.
After reviewing the counts and database target, append
`--apply --ack-target aws` to the import command. All additions commit together
or none commit. Neither command prints private mapping contents.

## Explicit activation settings (AWS owner)

Configure these on the server, not in browser code or committed environment files:

```text
AUTH_STRATEGY=drona
DRONA_EMAIL_EXCEPTION_ENABLED=true
DRONA_MAPPING_REVIEWED=true
DRONA_ENVIRONMENT=aws
DRONA_ORGANIZATION_ID=<existing QMS organization UUID>
```

The existing database and JWT/session secrets must already be configured through
the secure environment mechanism. No new Drona secret is required for this
exception. The flags acknowledge owner review; they do not prove schema or
mapping correctness. Login still rejects missing or mismatched data.

## Target acceptance and disabling

After the team syncs, test a real Drona login, preserved application access,
allowed and denied projects, Lessons/Audit/QAQC writes, PDFs/evidence and VerionAI.
Test inactive users/projects/assignments, deleted links, ambiguous emails,
old local sessions and the same numeric IDs in different environments.
QMS source deactivation/link removal revokes subsequent API requests; Drona
logout alone cannot revoke a QMS token under this unverified exception.

To disable it, set `DRONA_EMAIL_EXCEPTION_ENABLED=false` and restart the API.
Drona routes then fail closed. Do not enable local login on AWS as a fallback.
Once a supported backend verifier is available, replace the exception in a
separate reviewed change and invalidate outstanding exception tokens.

No live Drona SDK session, AWS data migration or delivery was verified from
this workspace. The team must complete target acceptance before releasing access.
