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

The user requested Project Master in Integration Cockpit as a display of
projects already transferred to QMS360, reusing existing records rather than a
parallel master table.

**Why:** Drona remains the project-master owner, and the user explicitly asked
not to create tables or disturb other development for this view.

**How to apply:** Keep Drona master fields read-only and within existing Cockpit
administrator/project scope. Display saved QMS data and known links honestly;
do not describe record-update timestamps as source-sync timestamps or turn
opening the view into a new import, migration or master-maintenance process.

The user subsequently authorized Super Admin / administrator users to select a
project in this register and maintain its QMS cost center for Lessons Learned
numbering. This is a narrow exception to the read-only register, not permission
to edit Drona-owned master fields.

**Why:** Cost centers are QMS-managed numbering inputs; the user explicitly
requested this correction without affecting other development.

**How to apply:** Reuse existing project extra fields and preserve unrelated
metadata, project identity, links and scope. Do not renumber historical Lessons
references or invent a new numbering format without confirming the business
format.

Cost center maintenance and Lessons Learned numbering changes are separate
authorizations.

**Why:** The user explicitly chose to save cost centers while keeping existing
numbering, rather than include cost centers in new references.

**How to apply:** Saving, editing or clearing a project cost center must not
change Lessons reference formats, counters or issued numbers. Integrate cost
centers into numbering only when the user separately requests that change.
