---
name: Consolidated QA/QC dashboard policy
description: Business rules from the supplied Monthly/Daily dashboard mapping workbook, distinct from form carry-forward and PDF exports.
---

The consolidated web dashboard has separate Monthly and Daily views. Its Monthly QA/QC figures and Daily snapshots use approved reports only; do not change form carry-forward rules, which can use submitted reports.

**Why:** The user supplied a PowerPoint design and a two-sheet field-mapping workbook explicitly requiring approved-only dashboard totals. Existing form and PDF portfolio rules serve different purposes.

**How to apply:** Preserve separate data policies rather than changing older reporting calculations to match the web dashboard. Pending-submission/approval coverage still uses workflow states, not approved-only records.

Daily Movement is the end snapshot minus the start snapshot, including negative changes; it is not a sum of daily snapshots. Pending-ageing and bottleneck panels remain end-date snapshots in both modes. A missing start anchor is unavailable movement, not an assumed zero opening balance. Missing trend dates are gaps.

**Why:** The supplied Daily Governance mapping expressly distinguishes movement calculations from end-date risk panels.

**How to apply:** Keep historical document-type labels distinct and retain signed values. Label projects using an older approved snapshot rather than pretending every project reported on the selected date.

Final submitted CSAT surveys count by survey date, alongside approved legacy surveys. The workbook's generic “approved survey” wording must not reintroduce a CSAT approval process. Pending Lessons and Audit/CAR statuses are live data, not reconstructed historical snapshots.

**Why:** The confirmed CSAT workflow is final submission with no review/send-back. There is no complete historical status snapshot suitable for pretending to reconstruct earlier open/overdue figures.

**How to apply:** Explain these exceptions in the dashboard. Respect each source application's capabilities and ownership; QA/QC administration does not authorize Lessons/Audit data. Do not infer “no report exists” when an own-record viewer cannot see a report.

SBG, BU and Project Group are maintained in Project Master Additional Data and
drive the corresponding Monthly and Daily dashboard filters. Treat QMS-managed
values as the exclusive source without changing Drona's source master. Never fall
back to source BU links or old top-level classification metadata. Missing or cleared
Additional Data values mean Unassigned.

**Why:** The user requested editable Project Master classifications and repeated
that the dashboard must get SBG, BU and Project Group from Additional Data specifically,
not other project sources. Filter choices and dashboard results must follow those saves.

**How to apply:** Resolve classifications before filtering the authorized project
set; use that same selected set across dashboard panels and drilldowns. Never
expose projects outside the viewer's existing scope to populate filter options.
