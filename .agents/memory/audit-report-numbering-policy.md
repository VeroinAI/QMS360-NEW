---
name: Audit Report numbering policy
description: Report number issuance, source/year selection, go-live last-used counters and completion gate.
---
Audit Reports have independent per-project/department, per-year sequences, separate from Plan and Schedule numbering. Use the linked Plan's project Cost Center, or the Department master Value for process audits, and the linked child Schedule From Date's two-digit year. New ranges start at 1. Go-live input means **last used**, so the next number is last used + 1; never rewind issued numbers.

Issue a Report Number only on the **first successful Save Report Details**, never on execution creation, preview, completion or download. Subsequent saves retain it. Reject Mark Complete if no number exists. Do not renumber previously issued reports when configuration changes or move a numbered execution to a different Plan.

**Why:** The user explicitly chose Save Report Details as the issuance event and made the Report Number mandatory for completion. Issuing earlier, on failed saves or on retries wastes numbers and breaks go-live continuity.

**How to apply:** Resolve sources and dates on the server. Lock organization numbering settings before the audit row, and commit counter allocation and report details together. Preserve server-owned number metadata across other audit edits and retain the separate Audit reference in exports. Historical already-completed records are not automatically renumbered by viewing or downloading.
