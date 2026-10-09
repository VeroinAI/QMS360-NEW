---
name: Checklist row deletion
description: User-authorized deletion boundary for Audit Checklist rows
---

Show a Delete action per Checklist row, but allow deletion only when both Audit
Findings and Evidence are empty. A populated finding or any evidence reference
disables deletion, even if its file cannot currently be loaded. Legacy `result`
values count as recorded findings.

**Why:** On 2026-10-09 the user requested row deletion explicitly conditional on
these fields being unpopulated. Deleting a row with findings or evidence would
discard audit work or break references.

**How to apply:** Use the same eligibility rule in the UI and API. Confirm
permanent removal with the user and recheck the current saved row under a lock
before deletion, so stale browser state cannot bypass the rule. Preserve other
rows, stored file bytes and audit history; finding-only records have a separate
workflow and are not Checklist delete targets.
