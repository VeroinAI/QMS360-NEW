# Drona integration preparation — cutover not enabled

## Status and boundaries

This package prepares the source-reader and identity-linking portions of the
Drona integration. It is **not working Drona SSO or live access enforcement**.
The source reader and link/intersection validators are not connected to live
authorization, seeds or migration runners. Authentication configuration, the
Drona-specific browser SDK entry, and explicit blocked-activation endpoints are
now integrated; selecting Drona mode disables local/old-token access until the
real verification/policy implementation is ready. No environment switch has
been made here. Current DEV/QA login, user/project data, application approvals
and permissions remain unchanged. No SQL in this directory has been applied.

Replit development and the published Replit app are DEV/QA. Drona/AWS is the
real production environment; deployment there is through GitHub. The supplied
CSV data must not be loaded into QA, copied into examples, or sent to GitHub.
DEV/QA must ultimately use their **existing** users, projects and assignments,
not a synthetic replacement. Tests here use independent synthetic identifiers.

## Prepared components

- `artifacts/api-server/src/lib/drona/source.ts`: parameterized, SELECT-only
  source reader using user → assignment → project slot → project and role catalog.
  Preserves each assignment separately, inactive flags, nulls, module inputs and
  hierarchy identifiers. It selects no email, signature, telephone or credential.
  A source row is not proof of a logged-in session. Its result explicitly has
  `authorizationReady: false`; role names, coordinator flags and empty module
  arrays grant nothing. Missing users return null; broken joined references fail.
- `artifacts/api-server/src/lib/drona/links.ts`: pure validation of explicitly
  reviewed, environment-specific external IDs against existing internal UUIDs.
  No email matching, automatic merging, SQL execution, deletion, or role grants.
  Conflicting pairs, wrong organizations, cross-environment links and unavailable
  targets fail. Unmapped active/internal records are reported, not discarded.
  Inventories passed to this validator must belong to the explicitly selected
  environment. It cannot independently authenticate an inventory's provenance.
- `inspect-schema.sql`: read-only metadata queries for column definitions,
  actual array element types, defaults, identities, constraints, indexes,
  triggers and owned sequence names. This is an inspection aid, **not** a
  passed parity check or full schema dump. A Drona owner must also supply the
  full schema-only DDL (including functions/sequence properties) for review.
- `link-tables.review-only.sql`: unapplied draft of QMS-owned link storage.
  It preserves UUIDs and uses composite organization/user and
  organization/project foreign keys. No references into Drona-owned public
  tables are installed. Missing source records must deny future access without
  deleting historical internal identities.

## Confirmed source contract and unresolved items

The uploads describe four tables in a schema CSV and five in the DOCX.
The authoritative membership join is:

```
public.user_master.user_id
  → public.user_role_mapping.user_id
  → public.project_mapping.project_map_id
  → public.project_master.project_id

public.user_role_mapping.user_role_id
  → public.user_role_master.user_role_id
```

No membership means no Drona project access. The reader retains an empty list;
it never converts it into organization-wide access.

The minimum source SQL uses only documented columns. Full validation still
requires `user_role_master` DDL and role data, array element types, complete
sequence defaults, constraints, indexes, relevant triggers and active/deleted
role semantics. Hierarchy IDs retain zero/negative values for review because
their meaning is unconfirmed. Positive master/assignment IDs are represented as
canonical decimal strings bounded to PostgreSQL bigint; no JavaScript number
conversion is allowed.

The owner confirmed the project-access condition: an active user linked through
`user_role_mapping`/`project_mapping` to an active `project_master` record.
`project_master.is_active` determines project activity. Ignore `enable_quality`
for QMS360 access; module fields are retained as source metadata, not invented
additional project gates. Do not reopen this question with Drona.

Keep existing per-user QMS application access, separate application approvals
and capability-specific role/project permissions inside that membership boundary.
Inactive/ambiguous assignment activity does not become an active membership.
Coordinator or source role names do not automatically grant QMS privileges.
Reconcile reviewed environment/organization-specific identity and project links,
and preserve the existing department-scoped projectless Process audit policy.

Drona roles such as an HSE or Digital administrator must not automatically
become QMS platform/application administrators. Keep QMS-specific grants,
workflow markers, approval levels and the separate Audit application approval.

## Preservation and migration procedure — review required

1. Capture a backup and environment-specific schema/ledger report. Record the
   internal user/project UUIDs and all dependent references in that same
   environment, keeping personal data out of shared artifacts.
2. Obtain full Drona schema-only definitions and the approved access matrix.
   Review `inspect-schema.sql` and have an authorized owner run it with read-only
   credentials in DEV, QA and AWS. Compare definitions rather than numeric ID
   equality. Do not give schema inspection results SSO/permission significance.
3. Review the DEV/QA-only source candidate in
   `dev-qa-source-schema.review-only.sql` against complete definitions. Its
   text-array, identity-sequence and minimal role-catalog choices are unconfirmed,
   not certified AWS definitions. The corresponding AWS public tables already
   exist and must not be recreated, pushed, altered, or populated by QMS migrations.
4. Prepare reviewed mappings of existing DEV/QA users and projects to DEV/QA
   source IDs; preserve original UUIDs and their histories. Where no source
   record exists, an authorized migration owner must create a corresponding
   DEV/QA record using validated DDL, then record the pair. Do not copy production
   names, signatures or other personal/authentication material as fixtures.
5. Stage each existing application assignment against the correct source role
   and project slot. Retain its QMS-specific grants and approvals separately.
   Ambiguous roles, multi-slot membership, organization-wide or department roles
   require review; never use an empty project array as a Drona unrestricted grant.
6. Validate the full reviewed mapping against inventories with
   `prepareDronaLinks`. Resolve every conflict/unmapped record and compare
   pre/post counts and references. The current validator is preparation code,
   not a bulk database importer or persisted mapping API.
7. Review the draft QMS link DDL against the actual schema and ledger. Before
   applying it, add canonical QMS Drizzle definitions and a generated, tracked
   migration with matching snapshot state. Do not simply add this draft to the
   migration journal. Do not run schema push against AWS-owned public tables.
   Applying the draft manually without reconciliation would cause drift.
8. Use a reviewed transactional data package with before/after checks. Keep
   numeric-ID links specific to each environment. Do not export QA users,
   projects, memberships, generated IDs or application records into AWS.
9. For DEV/QA-only generated source IDs, compare sequence ownership, increment
   and current high-water values after backfill; only an authorized migration
   owner may perform reviewed sequence reconciliation. Never reset AWS sequences
   based on QA data. Reconcile previously executed manual migrations before
   starting any runner. Replit Publish is not proof of custom-schema parity.

## Integration surface inventory

These existing paths must be reconciled as one cutover, not just a login change:

| Surface | Existing integration points / required change |
|---|---|
| Authentication | `lib/auth.ts`, `routes/auth.ts`, `middlewares/auth.ts`: verify Drona's actual session before resolving the stable internal link; enforce inactive/deleted/revoked identities on each request |
| Authorization | `middlewares/rbac.ts`: intersect capability-coupled QMS grants with authoritative Drona membership; remove any local-admin membership bypass in Drona mode |
| Selectors/context | `routes/platform.ts` and application reference-data endpoints: restrict users/projects by approved membership and tenant boundaries |
| Masters/imports | `lib/source-sync.ts`, `routes/integrations.ts`, platform profile/password changes, application admin profile and assignment routes: block source-owned mutations once Drona mode is enabled |
| Business records | QA/QC, Lessons and Audit routes, approval actors, owner/creator fields, attendance IDs, notifications and signatures: retain internal UUID relationships and historical displays |
| Files/reports/AI | Attachment/object download authorization, report/export handlers, VerionAI transaction tools and capability helpers: use the same request identity and scoped permission intersection |
| Department audits | Projectless Process audit chain: enforce the reviewed department policy without fabricating a project |
| Browser | Existing shell login, app selector and access-request flows: no production signup/password login; keep DEV/QA simulation explicit and preserve application-specific approvals |

Stored UUID project arrays and non-FK JSON/history references also need review;
checking database foreign keys alone is insufficient.

## Session handoff request for the Drona technical owner

Please document how QMS360 can securely obtain the **current logged-in Drona
user_id** from the existing Drona session. Supply sanitized documentation or a
non-production integration example, not tokens or secrets. Include verification,
trusted issuer/audience or backend boundary, expiry, logout/revocation, replay
protection and a DEV/QA test method. The existing QMS container bridge is not
assumed to be Drona's protocol. Sharing a database or host is not authentication.

## Cutover and recovery gates

Do not enable cutover until schema, mappings, preserved QMS access, verified
session handoff and complete endpoint coverage are confirmed. Verify valid and
forged/expired sessions, inactive/revoked users and memberships, no assignments,
cross-project attempts, role changes, separate app approvals, multiple slots,
department audits, downloads and VerionAI scope. Require DEV/QA parity reports
and Drona-owner acceptance; do not claim AWS SSO was tested without access.

If preparation fails, stop before writes. If an approved cutover later fails,
deny Drona-mode access rather than silently falling back to local production
login or old cached memberships. Coordinate an explicit reviewed recovery with
the Drona owner; preserve link/history evidence and never drop existing source
tables. Destructive cleanup or removal of obsolete local masters requires
separate approval and completed reference checks.

## Verification of this preparation

Run the isolated regressions and existing backend type check:

```
pnpm --filter @workspace/api-server exec vitest run src/lib/drona/preparation.test.ts
pnpm --filter @workspace/api-server run typecheck
```

These checks do not establish live schema compatibility, migrated DEV/QA records,
session validity or authorization parity.

See `aws-handoff.md` for current authentication behavior, read-only preflight,
build instructions, repository privacy risks and outstanding activation gates.
The ready-to-send request is `email-to-drona-team.txt`.