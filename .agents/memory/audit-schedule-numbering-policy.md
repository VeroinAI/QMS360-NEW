---
name: Audit Schedule numbering policy
description: Why Audit Schedule field 8 and field 9 have distinct allocation timing and range rules.
---

QA/QC Reference (field 8) starts at 001 in each parent programme, assigned to children in From Date order when the parent is submitted for approval. Its configurable range therefore has a fixed first number and a configurable last number. Audit Number / Site Visit No. (field 9) has an independent configurable first and last number, allocated within each project or department for the calendar year; the year uses the organization's timezone. Both identifiers include their own prefix, a two-digit calendar year, and a three-digit sequence. Retire old identifiers when an audit changes its project or department rather than making an old number available for reuse.

**Why:** The user required separate settings for both fields, 001-based QA/QC Reference ordering on parent submission, and project/department-specific uniqueness for Audit Numbers. A fixed first number for field 8 resolves the potential conflict between "configurable range" and "always start at 001."

**How to apply:** Keep these fields separate from Audit Execution numbering; server allocation must remain transactional and clients/imports must not write final identifiers. If changing parent submission, project moves, or backfilling older audits, preserve ordering and never silently reuse an issued Audit Number.