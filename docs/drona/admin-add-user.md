# Super Admin: Add an existing Drona user before first launch

## User-facing change

In an application's **Settings → Users & Access**, a **Super Admin** can select
**Add user from Drona**, enter the exact email, search, confirm the returned name
and email, and click **Add user**. The existing role-assignment dialog then opens.
An existing QMS360 identity is reused; searching alone does not write anything.

No source Drona account is created, no session is issued for the added person,
and no application approval, platform role or application role is granted by
the import. Role assignment and application approval retain their current rules.
The user's later Drona launch resolves to the same internal identity.

## AWS/Drona deployment

Deploy the updated frontend **and** backend from the private repository using the
existing dependency install/build process.

This feature introduces **no migration, table, column or index**. Do not replay
the Drizzle baseline or copy DEV/QA users to AWS for this feature.

Retain the existing reviewed Drona backend settings:

```text
AUTH_STRATEGY=drona
DRONA_MAPPING_REVIEWED=true
DRONA_ENVIRONMENT=<existing target environment key>
DRONA_ORGANIZATION_ID=<existing target QMS organization UUID>
```

Existing authentication activation/session settings are unchanged.

### One additional backend runtime setting

```text
DRONA_QMS_MODULE_VALUE=<exact QMS360 module identifier in Drona user assignments>
```

The Drona operator must confirm the actual stored QMS360 identifier. This value
is not established by the checked-in source schema. Do not guess `QMS360`,
`QMS`, or `Quality`, and do not use a Drona role name as an administrator grant.
Set this in the **QMS360 API runtime environment**, not the frontend or database.
Restart/redeploy the API after changing it.

The feature matches this value, case-insensitively and with surrounding
whitespace removed, against:

- `public.user_role_mapping.module`, or
- an element of `public.user_role_mapping.modules` (array).

The assignment must be active and linked through `public.project_mapping` to an
active `public.project_master`. Merely being an active Drona user or sharing a
project with another QMS360 user is not sufficient.

These are checks for this new administrator discovery feature only. Existing
Drona login and project-membership rules have not been changed, and
`project_master.enable_quality` is not introduced as a gate.

If your actual QMS360 entitlement lives in a different source field/table,
**do not substitute an unrelated value or modify source data to make this pass**.
Provide that mapping so this read can be adapted. The feature fails closed until
the configured source mapping is valid.

### Database access

Reuse the backend's existing Drona/QMS360 connection and identity-linking
permissions. The new eligibility read uses the existing source user/project
assignment tables; it does not write to Drona-owned tables or request DDL.
The existing identity-linker and QMS360 audit log perform their usual writes
inside a transaction.

If the runtime account cannot read the module fields/assignment tables, an
operator must grant the missing access. Do not provide DBA credentials to the
application developers or put a database URL in Git.

## Protection and error handling

- Both endpoints require an authenticated **Super Admin**, not Org Admin.
- Organization and administrator identity come from the verified session.
- Exact normalized email lookup; no whole-directory export or broad name search.
- Missing, inactive, ambiguous and non-QMS-assigned source users are rejected.
- Add rechecks source eligibility; it never trusts the prior search response.
- Source-ID changes, conflicting identities and previously removed links require
  review rather than being silently relinked.
- Existing user IDs, roles, approval state and historical records are preserved.
- Import is recorded in the existing application audit logs; no new event email
  or background synchronization is introduced.

## Acceptance on AWS

1. Search a QMS360-assigned Drona user who has never opened QMS360.
2. Confirm search alone creates no internal record.
3. Add them and assign a role using the existing dialog.
4. Repeat the search/add; confirm the same QMS360 identity is reused.
5. Open QMS360 as that user through Drona; confirm preassigned roles are present,
   subject to existing application approvals and scope.
6. Confirm inactive, unassigned and non-QMS users cannot be imported.
7. Confirm an Org Admin/ordinary user cannot call the new endpoints.

Development has no live AWS Drona directory. Source behavior is covered with
isolated test responses; final real-directory acceptance requires the AWS
configuration and the operator-confirmed module identifier above.
