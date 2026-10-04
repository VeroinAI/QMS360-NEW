# Independent application access reviews

QA/QC, Lessons, and Audit decisions apply only to the application being reviewed.
Existing `can_open_*` approvals remain authoritative, including on legacy records
whose shared status is pending or rejected. Primary platform roles and permission
grants are not changed.

## Legacy-data transition

The change adds one non-null JSON column, `shared.application_access.application_reviews`,
with an empty-object default. It does not replace or drop existing columns or
rewrite existing approval flags.

For an application without an explicit review, its own audit log is consulted:

- QA/QC: `app1_qaqc.audit_log_entries`, `access_approve` / `access_reject`.
- Lessons: `app2_lessons.audit_log_entries`, `access_approve` / `access_reject`
  (both legacy `access_request` and `application_access` entity names).
- Audit: `app3_audit.audit_log_entries`, `approve_access` / `reject_access` /
  `request_access`.

Only that application's latest review decision (or a request event when no review
decision exists) is used. No shared rejection is
copied to all applications. If the originating application cannot be identified,
an unapproved active role holder is offered for review without receiving access.
Explicit legacy pending QA/QC and Lessons requests awaiting roles remain visible
within the request's project scope. Audit continues to require active Audit roles.
Legacy Audit `request_access` events do not supersede an actual rejection: those
events lack assignment scope, so renewal must compare manageable role assignments
with the preserved rejection timestamp.

New decisions save the application's outcome and timestamp, alongside its audit
event, in one transaction. They do not change shared status or another application's
review or access flag. Repeated decisions are rejected until a fresh assignment
renews a rejected request. Renewal uses only that application's manageable role
assignments, compared with its own rejection timestamp, not shared `updated_at`.
New shared rows have no inherited project boundary: each application's decision
is authorized by its own assignments, which may cover different projects.
Existing explicitly project-scoped legacy rows retain their original boundaries.
Lessons role assignment now requests review rather than silently bypassing a
rejection or granting application access. Existing Lessons approvals remain valid.

## Deployment

Apply the additive development schema change before deploying the API. The normal
development Drizzle push currently hits the project's documented multi-schema enum
conflict; the missing column alone was applied and verified in development.

Production schema changes must use Replit's supported Publish process. Re-publish
after the development schema is available, and verify the new shared-schema column
is included/applied before serving this API version. If Publish omits this custom
schema (a previously reported project-specific limitation), resolve that through
the supported deployment/support process rather than introducing a build hook,
startup DDL, or a custom production migration script. Production queries remain
read-only. Do not overwrite production data from development.

Regression command:

```sh
pnpm --filter @workspace/api-server exec vitest run \
  src/lib/qaqc-access-requests.test.ts \
  src/lib/application-access-requests.test.ts \
  tests/application-access-decisions.test.ts \
  tests/audit-roles.test.ts \
  --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
```