---
name: Monthly metrics Word template policy
description: Customer-supplied monthly download layout, missing-field handling and scope.
---

The QA/QC Metrics landing-page Download and the individual monthly report's PDF button must use the same customer's Word report layout, populated with actual saved monthly report values. Unmatched fields must read exactly “To be mapped”. Never copy illustrative project names, sample numbers, signatures or reviewer-only instructions into an issued report.

**Why:** The user supplied a revised monthly Word layout and explicitly required its layout, colours and font combination while allowing unmatched fields to remain visible. They subsequently required the individual monthly report's PDF button to match that download, rather than use a different selectable template. Keep Excel, other reports and scheduled email attachments independent.

**How to apply:** Keep other managed PDF template flows independent. Saved system calculations remain authoritative; do not change business calculations to reproduce sample figures. Do not split incompatible ageing bands or expose cross-project data just to fill a template. The supplied Calibri font is not embedded in the Word file; use embedded, metrically compatible Carlito for portable output without a production office/browser dependency, and disclose that substitution.

The user explicitly approved replacing the original Word ageing bands with the
input screen's buckets in the monthly PDF only.

**Why:** The original template requested bands the form does not collect, leaving
unnecessary mapping gaps. Match the actual entry definitions, rather than changing
the form or attempting to divide saved bucket counts into different ranges.

The monthly PDF's portfolio PQI uses submitted/approved reports already available
for that month at download time, not the form's completeness-gated portfolio
calculation. Show the average of their saved accumulated PQI scores and the
included project count. Preserve organization, project and own/full visibility.

**Why:** The user explicitly requested the available-report average even when
other projects have not yet submitted. This is a PDF-only exception; do not change
the existing form/dashboard completeness policy.

Draft reports must not contribute to the PDF's portfolio PQI. When there are no
eligible submitted/approved reports, display “No submitted reports”, not a missing
mapping marker or an invented zero average.

**Why:** The user explicitly confirmed submitted/approved-only eligibility after
an October report returned zero contributors because the saved reports were drafts.
The count caption must include the actual reporting month and year.
