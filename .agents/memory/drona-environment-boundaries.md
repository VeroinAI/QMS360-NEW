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

**How to apply:** Reconcile identities/projects separately in each environment,
using the owner-approved automatic-setup policy for unambiguous matches and
explicit reviewed pairs for conflicts. Drona owns its public masters; keep source reads
outside QMS-managed schema generation until ownership exclusions are validated.
Do not run live QA/production SQL or use startup DDL for this integration.

The user stated on 2026-10-06 that Drona/AWS already contains shared data used by
their other applications. This does not establish that QMS360-specific internal
user/project records exist on that target.

**Why:** Existing common Drona data and existing QMS application records were
being conflated during deployment discussion.

**How to apply:** Reuse Drona's existing masters; do not suggest recreating them.
Distinguish those masters from QMS internal records and reviewed links, and
confirm the target inventory before claiming that SQL creation plus cloning is
sufficient for access.

The temporary QMS360 sign-in screen is for Replit DEV/QA only. AWS/Drona
production must use Drona login and must not expose the temporary sign-in path.

**Why:** The user clarified that code is handed off through GitHub to AWS/Drona;
they did not approve a separate temporary QMS360 login for real production.

**How to apply:** Keep authentication behavior environment-specific and enforce
the separation at backend routes, not just by hiding the screen. Drona hosting
does not replace backend session verification.

The user's clarification concerns login/signup only: "login / signup should be
done from drona" using its public-schema tables, with no separate QMS sign-in
or registration. Do not interpret that as authorization to replace QMS
application approvals or role permissions with Drona application assignments.

**Why:** On 2026-10-06 the user explicitly corrected a discussion that conflated
their authentication expectation with application-access policy.

**How to apply:** Keep Drona-owned registration and the QMS identity handoff
separate from authorization. Explain any internal identity/link prerequisites
without describing them as another user-facing signup, and do not ask again
about changing application approvals merely to clarify login.

Existing Drona registration is not a verified session. Do not repeatedly ask the
user to choose an SSO protocol. The secure current-user handoff remains a future
requirement, but the owner explicitly approved an email-only exception.

**Why:** The user expects no separate production login and does not know the
handoff protocol. Inferring authentication or module privileges from database
rows would invent a security policy.

**How to apply:** Require explicit exception activation and reviewed
environment-specific links. Preserve QMS access; Drona/HSE role names alone must
not grant QMS administrator rights.

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

**How to apply:** Keep the verified-session route fail-closed until a supported
backend contract exists. The approved email-only route is a separate exception,
not a replacement security guarantee.

On 2026-10-06 the user stated that Drona PRD and UAT are the same environment
and explicitly authorized proceeding without Drona session/nonce validation,
using Drona profile.email. This supersedes the previous no-cutover rule for
that exception, not the requirement to preserve QMS permissions and mappings.

**Why:** The user accepted the exception after the impersonation risk and
production limitation were explained, then clarified the shared environment.

**How to apply:** Document the bypass honestly, require explicit server-side
activation, and use one reviewed environment key for that shared AWS target.
Never label it verified SSO or assume a separate isolated UAT. Keep Replit
DEV/QA data and configuration separate. Removing the bypass remains future
security work when a supported verifier is supplied.

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
For Drona sessions, membership also caps otherwise-global QMS project grants;
keep own/full visibility distinctions within that intersection.
Backend session verification remains unresolved, but no longer blocks the
explicitly approved email-only implementation/handoff.