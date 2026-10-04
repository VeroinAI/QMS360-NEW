---
name: Drona environment boundaries
description: Source ownership, environment-specific linking and safe integration cutover constraints
---

Replit development and the published Replit app are DEV/QA. Real production is
Drona/AWS PostgreSQL, reached through GitHub. Preserve/migrate existing DEV/QA
users, projects and assignments; synthetic fixtures are additional tests only.
Do not transfer QA records or uploaded production personal/signature data to AWS
or public GitHub.

**Why:** The user explicitly clarified these environment and preservation
boundaries. Equal numeric IDs across environments do not establish equal
identities; current QMS history must retain its stable internal UUID references.

**How to apply:** Reconcile explicit reviewed identity/project pairs separately
in each environment. Drona owns its existing public masters; keep source reads
outside QMS-managed schema generation until ownership exclusions are validated.
Do not run live QA/production SQL or use startup DDL for this integration.

Existing Drona registration is not a verified session. Do not repeatedly ask the
user to choose an SSO protocol; obtain the secure current-user handoff from the
Drona technical owner. Missing session documentation blocks authentication
cutover, not independently validated source-reader/linking preparation.

**Why:** The user expects no separate production login and does not know the
handoff protocol. Inferring authentication or module privileges from database
rows would invent a security policy.

**How to apply:** Keep preparation disconnected from live login and permissions
until schema, module precedence, role mappings and tenant/department rules are
confirmed. Drona/HSE role names alone must not grant QMS administrator rights.

Treat DronaHQ profile.uid as public.user_master.user_id for implementation,
subject to a source/session parity check before production acceptance.

**Why:** On 2026-10-04 the user instructed us to consider those identifiers the
same. This resolves the intended ID mapping, not verification of a browser's
claimed identity or the validity of a nonce.

**How to apply:** Do not repeatedly request confirmation of this ID equivalence.
Preserve its exact decimal value and resolve the environment-specific UUID link
only after the backend has verified the Drona session.