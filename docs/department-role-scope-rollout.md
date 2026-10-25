# Department role scope rollout

Audit and QA/QC assignments now store Department Master UUIDs in `department_ids`,
separately from `project_ids`. Existing assignments receive an empty department
array and keep their previous meaning. No data reassignment or historical
schedule rewriting is part of this change.

## Required schema order

The generated tracked migration `lib/db/drizzle/0027_department_role_scopes.sql`
adds only the two non-null UUID arrays with empty defaults. Apply the additive
development setup using the existing post-merge process. Verify both custom
schemas have the columns before starting the new API version.

Custom-schema production rollout requires an explicitly authorized,
operator-reviewed schema reconciliation through the existing deployment process.
Do not assume Publish migrates these custom schemas. Do not add startup DDL,
deploy/build migration hooks, or force-push the database. This task makes no
production data or schema changes.

Deploy this API version only after the target's two columns are confirmed.
If a target is missing either column, block the rollout; never discard department
IDs or retry an assignment as organization-wide. Older application versions must
not run after department assignments have been created: they do not understand
the new boundary and could interpret an empty project array as organization-wide.

## Identity and access

Department options use the existing tenant Department Master and each
application's role-administration scope, not Lessons application access.
Historical Process schedules are matched read-only against exact master IDs,
values or uniquely matching labels. Unknown or ambiguous matches are denied to
department-only users. Existing project-scoped Process-audit access remains
unchanged; explicit department grants do not grant projects.

QA/QC reports remain project-based. A department role grants application entry
but cannot authorize project reports or project-based approval eligibility.
