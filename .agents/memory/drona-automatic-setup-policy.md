---
name: Drona automatic internal setup
description: Owner-approved first-entry setup scope, preservation rules and link-removal semantics
---

On 2026-10-06 the user authorized automatic internal user/project setup so
routine Drona signups and new project assignments do not require a QMS signup
or per-person/per-project database imports.

**Why:** The user already has Drona public master data and expects Drona to own
registration. The earlier manual-link prerequisite did not satisfy that
expectation. This supersedes requiring a manually reviewed pair for every
ordinary new identity, not the need for reviewed target/environment setup.

**How to apply:** Reuse stable existing QMS identities and project records when
the match is unambiguous; create missing internal records without passwords,
roles or application approvals. Never write Drona masters, infer equivalence
from numeric IDs, revive inactive/deleted accounts, or overwrite existing
identity/history/permission data. Ambiguous and conflicting legacy matches
remain administrator-reviewed exceptions.

Link removal must remain revocation even though missing links can otherwise be
automatically established.

**Why:** Without retained provenance, the next login or project refresh would
silently recreate a deliberately removed link and reverse the administrator's
access decision.

**How to apply:** Retain mapping provenance independently of live links,
including links that predate automatic setup. Do not delete that history during
routine cleanup. An explicit reviewed restoration must preserve the retained
identity rather than remap it to another record.

Automatic linking is technical setup, not a human approval or verified SSO.

**Why:** The approved email-only exception remains unverified; legacy link
metadata records a technical actor even when no human reviewed the individual
link. Interpreting that as approval would expand authorization unexpectedly.

**How to apply:** Keep automatic setup separate from QMS application approvals,
workspace roles and administrator eligibility. Do not use Drona role labels or
link-review metadata to grant privileges.
