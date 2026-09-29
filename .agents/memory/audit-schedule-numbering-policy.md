---
name: Audit Schedule numbering policy
description: Why Audit Schedule field 8 and field 9 have distinct allocation timing and range rules.
---

QA/QC Reference (field 8) starts at 001 in each parent programme, assigned to children in From Date order when the parent is submitted for approval. Its configurable range therefore has a fixed first number and a configurable last number. Its two-digit year comes from **each child audit's From Date**, not the current date or the parent programme year. Audit Number / Site Visit No. (field 9) has an independent configurable first and last number, allocated within each project or department **without any year in the displayed number**. Its sequence must continue across calendar years so a department/project cannot issue the same number twice. Retire old identifiers when an audit changes its project or department rather than making an old number available for reuse.

**Why:** The user corrected the original calendar-year numbering: field 9 does not show a year at all, and field 8's year is taken from the entered From Date (e.g., 10-12-2026 → 26, 15-01-2027 → 27). Keeping the field 9 sequence continuous across years avoids duplicate displayed identifiers. A fixed first number for field 8 resolves the conflict between "configurable range" and "always start at 001."

**How to apply:** Keep these fields separate from Audit Execution numbering; server allocation must remain transactional and clients/imports must not write final identifiers. If changing parent submission, project moves, or backfilling older audits, preserve ordering and never silently reuse an issued Audit Number.