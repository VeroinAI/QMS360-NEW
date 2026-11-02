---
name: Daily discipline input policy
description: Current cumulative-entry requirement and compatibility with earlier daily-addition reports.
---

New Daily Submissions use cumulative Current Date inputs across Drawings/Submittals, Document Types, Approved status by Revision, Correspondence and Rejected Submissions. “Till yesterday” is the immediately previous submitted calendar day's cumulative snapshot, not Yesterday plus today's cumulative input.

**Why:** On 2026-11-02 the user explicitly changed the input rule back to cumulative values and requested removal of addition-based carry-forward across all Daily tiles. This supersedes the earlier 100 + 12 = 112 daily-addition requirement for new reports.

**How to apply:** New reports retain entered cumulative values unchanged. Derive totals from statuses and movement as current cumulative minus baseline. Align downloads, email attachments and dashboards through the same snapshot interpretation. Pending/ageing remains a snapshot. Preserve existing records' original input meaning; normalize prior daily-addition records once when obtaining their cumulative end-of-day snapshot.

Keep explicit input contracts for cumulative and earlier daily-addition records. Never reclassify existing submitted history or draft values merely because they are saved again.

**Why:** Input semantics have changed more than once; values alone cannot establish historical intent, and the user previously instructed that QA history remain unchanged.

**How to apply:** Preserve stored input-mode metadata on edits and imports. Historical addition-mode inputs still need their saved baseline to produce a snapshot; cumulative inputs do not. Never sum cumulative snapshots twice.

New Report UX must hide the blocked-entry banner for a blank project, show the project's last submitted report date after project selection, and provide informational missing-date guidance after date selection. Copy previous day data is available only for the exact preceding submitted date.

**Why:** The user requested these behaviors alongside the cumulative-entry change to avoid confusing initial errors and copying an older report as though it were yesterday.

**How to apply:** Keep server-side sequence and duplicate protections. Copy business inputs only, never workflow or identity metadata. Display the organization-formatted selected date in Current Date headers. First reports can use the one-time go-live opening snapshot, but it is not a prior submitted report for enabling the copy button.
