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

The temporary QMS360 sign-in screen is for Replit DEV/QA only. AWS/Drona
production must use Drona login and must not expose the temporary sign-in path.

**Why:** The user clarified that code is handed off through GitHub to AWS/Drona;
they did not approve a separate temporary QMS360 login for real production.

**How to apply:** Keep authentication behavior environment-specific and enforce
the separation at backend routes, not just by hiding the screen. Drona hosting
does not replace backend session verification.

Existing Drona registration is not a verified session. Do not repeatedly ask the
user to choose an SSO protocol; obtain the secure current-user handoff from the
Drona technical owner. Missing session documentation blocks authentication
cutover, not independently validated source-reader/linking preparation.

**Why:** The user expects no separate production login and does not know the
handoff protocol. Inferring authentication or module privileges from database
rows would invent a security policy.

**How to apply:** Keep preparation disconnected from live login and permissions
until session verification, environment-specific links and preserved QMS access
are reconciled. Drona/HSE role names alone must not grant QMS administrator rights.

Use DronaHQ profile.email to match public.user_master.user_email, then retain
the matched source user ID and existing environment-specific internal UUID link.

**Why:** On 2026-10-06 the user relayed the Drona technical owner's clarification
that email is the common identifier. This supersedes the earlier assumption that
profile.uid and user_master.user_id necessarily identify the same user.

**How to apply:** The user confirmed on 2026-10-06 that emails should be treated
as unique for this mapping; do not ask for uniqueness confirmation again.
Reject missing or ambiguous matches if actual data violates that assumption.
Matching a database row is not authentication.
The owner confirmed that nonce validation is Drona's session-verification
mechanism, that no alternative signed-token or trusted server-to-server handoff
is available, and that a backend nonce-validation API is being explored.
Do not describe a browser-supplied email or client-side nonce check as a verified
server session.

**Why:** The Drona technical owner's follow-up rules out the previously suggested
alternatives; repeating those questions does not resolve backend authentication.

**How to apply:** Await the supported backend nonce-validation contract for
production login activation. Request its documentation, identity binding,
lifetime/replay behavior and non-production testing route when available.
Continue independently safe preparation without bypassing authentication.

Project membership is an active user's `user_role_mapping` link (through
`project_mapping`) to an active `project_master` record. Ignore `enable_quality`
for access; it has no purpose in QMS360 access according to the user.

**Why:** On 2026-10-04 the user explicitly answered the project-access question
and instructed us to ignore `enable_quality`. Asking Drona that question again
or deriving extra module gates would contradict the confirmed product rule.

**How to apply:** Use `project_master.is_active` for project activity and retain
the mapped membership boundary. Keep per-user QMS application access, approvals
and capability-specific role/project permissions as separate checks. Do not
turn a project mapping into an application approval or an administrator grant.
The outstanding Drona technical question is backend session verification.