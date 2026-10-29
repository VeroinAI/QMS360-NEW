---
name: Daily discipline input policy
description: Daily additions versus cumulative Yesterday semantics, including the later extension to tiles 3–6.
---

For Daily Submission Drawings/Submittals by Discipline, Current Date should represent that day's addition. Yesterday should represent the cumulative balance through the prior reporting date, including the one-time historical opening.

**Why:** The user explicitly clarified that a report with Yesterday Civil Total 100 and Current Date Total 12 must yield Yesterday Total 112 on the next date. This supersedes the earlier answer that Current Date contains cumulative figures including history.

**How to apply:** Accumulate the affected count fields once, derive totals from the status fields, and distinguish raw daily additions from cumulative snapshots in carry-forward, dashboards and exports. Do not blindly apply addition to pending/ageing snapshots, percentages or unrelated sections. Do not silently reinterpret all historical records as daily additions; preserve approved history and assess legacy semantics before an authorized correction.

Use an explicit input-contract version for new daily-addition reports; unclassified historical reports retain their legacy cumulative-entry interpretation until a reviewed correction is approved.

**Why:** The user required both the new arithmetic and protection against silently reinterpreting earlier cumulative-entry data. Lower Current Date values alone cannot safely identify historical intent.

**How to apply:** Saving or importing an existing legacy report must not automatically convert its input meaning. Keep daily raw counts separate from end-of-day snapshots so rendering, exports, repeated saves and carry-forward do not add Yesterday twice. Refresh editable draft baselines without changing their entered counts; preserve frozen submitted history.

The user subsequently extended the same daily-addition rule to Document Types, Approved status by Revision, Correspondence and Rejected Submissions. Match revision history by category and normalized revision name; percentages use cumulative approvals divided by the category's cumulative discipline total. Pending-document ageing remains a snapshot.

**Why:** The user explicitly requested carry-forward for the four remaining tiles after the discipline fix. Earlier instructions to keep these four sections as snapshots are superseded for new reports, but the user's decision to keep existing QA history unchanged still applies.

**How to apply:** Version this additional change independently of the discipline-only contract. Existing discipline-addition reports may still contain cumulative supplementary inputs and must not be silently reinterpreted. New reports carry historical opening balances plus daily additions once across all five count sections.
