---
name: Audit Finding numbering policy
description: User-confirmed finding codes, sequence boundaries and issuance timing
---

Audit Finding numbering uses an administrator-configured middle code for each finding type, not the finding's master-data Value automatically. Each finding type has its own running sequence for each project or department and full Schedule From Date year, starting at 1 annually. “Not applicable” is excluded from numbering configuration and issuance.

**Why:** The user explicitly chose configurable codes per type and separate per-type sequences, rather than one sequence shared by all finding types.

**How to apply:** Keep type identity independent of editable codes. Changing a code or number format must not restart counters or rewrite numbers already issued.

The same middle code may be used for multiple finding types. Keep separate type/source/year counters even when codes match; identical displayed numbers across different types are allowed.

**Why:** The user explicitly corrected the initial distinct-code restriction and requested code reuse across Audit Finding types.

**How to apply:** Do not reject duplicate codes in settings or treat another finding type's issued number as a collision. Preserve collision protection within the same issued finding type.

Issue the number on successful Save Finding. Derive the source from the linked Plan: Department master Value for department/process audits, Project Cost Center for project audits. Derive the two-digit displayed year from the linked child Audit Schedule From Date, not the current date.

**Why:** The user specified the source/date linkage and Save Finding as the issuance action. Finding, Plan and Report numbering are independent business ranges.

**How to apply:** Commit the counter and finding together, preserve numbers through retries and later updates, and retain historical findings and evidence identities. Missing source data should produce an actionable error, never an invented source.
