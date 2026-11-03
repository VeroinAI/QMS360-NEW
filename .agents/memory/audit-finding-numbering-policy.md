---
name: Audit Finding numbering policy
description: User-confirmed finding codes, sequence boundaries and issuance timing
---

Audit Finding numbering uses an administrator-configured middle code for each finding type, not the finding's master-data Value automatically. Each finding type has its own continuous running sequence for each project or department, starting at 1 with no year in the number and no annual reset. “Not applicable” is excluded from numbering configuration and issuance.

**Why:** The user explicitly chose configurable codes per type and separate per-type sequences, rather than one sequence shared by all finding types.

**How to apply:** Keep type identity independent of editable codes. Changing a code or number format must not restart counters or rewrite numbers already issued.

The same middle code may be used for multiple finding types. Keep separate type/source counters even when codes match; identical displayed numbers across different types are allowed.

**Why:** The user explicitly corrected the initial distinct-code restriction and requested code reuse across Audit Finding types.

**How to apply:** Do not reject duplicate codes in settings or treat another finding type's issued number as a collision. Preserve collision protection within the same issued finding type.

Administrators maintain the **last-used number** for a selected finding type and project/department, without a year. Entering 125 means the next saved finding receives sequence 126. Unmaintained ranges start at 1; enter 0 for a fresh range.

**Why:** The user explicitly replaced yearly Plan, Report, Finding and CAR numbering with continuous sequences and requested last-used maintenance for all four.

**How to apply:** Continue above the highest saved former yearly counter for that type/source. Never rewind or sum yearly counters; do not rewrite existing findings or affect other type/source ranges.

For manual Add Finding, issue the number on successful Save Finding. Derive the source from the linked Plan: Department Master Cost ID for department/process audits, Project Master Additional Data Contract / project no. for project audits. Preserve text and leading zeroes; do not fall back to Department Value/label or Project Cost Center. No year is displayed or used to partition counters.

Checklist-origin findings receive any missing Finding IDs automatically when the
audit is submitted or resubmitted for report approval. Keep manual Add Finding
issuance on save. Number allocation, counters and approval submission must commit
together, preserving all existing IDs and skipping blank/Not applicable results.

**Why:** The user explicitly requested automatic numbering at submission for
checklist-transferred findings, instead of relying on individual repair clicks.

**How to apply:** Show pending-issuance text on unnumbered checklist findings
before submission. Use the continuous type/source
ranges, allocate sequentially against the latest counter state, and make retries
and resubmissions idempotent. Read and download operations still never issue IDs.

**Why:** The user specified the source/date linkage and Save Finding as the issuance action, then explicitly changed Audit source mappings to Contract / project no. and Department Cost ID. Finding, Plan and Report numbering are independent business ranges.

**How to apply:** Commit the counter and finding together, preserve numbers through retries and later updates, and retain historical findings and evidence identities. Missing source data should produce an actionable error, never an invented source.

Do not offer a manual “Generate Finding Number” action or individual-number
generation endpoint.

**Why:** After automatic submission numbering was implemented, the user explicitly
requested removal of the manual button and its functionality.

**How to apply:** Keep manual Add Finding numbering on save and checklist
numbering on approval submission. Preserve previously issued IDs, identities,
evidence and CAR links. Ordinary saves must still preserve server-owned numbering
metadata and reject client-supplied replacements. Reads/downloads never issue IDs.
