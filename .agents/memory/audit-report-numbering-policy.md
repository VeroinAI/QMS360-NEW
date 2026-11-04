---
name: Audit Report numbering policy
description: Report number issuance, continuous source counters, go-live last-used values and completion gate.
---
Audit Reports have independent continuous per-project/department sequences, separate from Plan and Schedule numbering. Format: prefix + Project Master Additional Data Contract / project no. or Department Master Cost ID + middle text + running number, with no year or annual reset. Preserve text/leading zeroes and never fall back to Cost Center or Department Value/label. New ranges start at 1. Go-live input means **last used**, so the next number is last used + 1; never rewind issued numbers. Continue above the highest saved former yearly counter without renumbering historical reports.

**Why:** The user explicitly replaced yearly Plan, Report, Finding and CAR ranges with yearless continuous sequences and source-only go-live maintenance.

Issue a Report Number only on the **first successful Save Report Details**, never on execution creation, preview, completion or download. Subsequent saves retain it. Reject Mark Complete if no number exists. Do not renumber previously issued reports when configuration changes or move a numbered execution to a different Plan.

**Why:** The user explicitly chose Save Report Details as the issuance event and made the Report Number mandatory for completion. Issuing earlier, on failed saves or on retries wastes numbers and breaks go-live continuity.

**How to apply:** Resolve sources and dates on the server. Lock organization numbering settings before the audit row, and commit counter allocation and report details together. Preserve server-owned number metadata across other audit edits and retain the separate Audit reference in exports. Historical already-completed records are not automatically renumbered by viewing or downloading.
