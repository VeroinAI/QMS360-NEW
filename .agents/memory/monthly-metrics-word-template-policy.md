---
name: Monthly metrics Word template policy
description: Customer-supplied monthly download layout, missing-field handling and scope.
---

The QA/QC Metrics landing-page Download and the individual monthly report's PDF button must use the same customer's Word report layout, populated with actual saved monthly report values. Unmatched fields must read exactly “To be mapped”. Never copy illustrative project names, sample numbers, signatures or reviewer-only instructions into an issued report.

**Why:** The user supplied a revised monthly Word layout and explicitly required its layout, colours and font combination while allowing unmatched fields to remain visible. They subsequently required the individual monthly report's PDF button to match that download, rather than use a different selectable template. Keep Excel, other reports and scheduled email attachments independent.

**How to apply:** Keep other managed PDF template flows independent. Saved system calculations remain authoritative; do not change business calculations to reproduce sample figures. Do not split incompatible ageing bands or expose cross-project data just to fill a template. The supplied Calibri font is not embedded in the Word file; use embedded, metrically compatible Carlito for portable output without a production office/browser dependency, and disclose that substitution.

Reserve “To be mapped” strictly for fields with no QMS mapping. Mapped fields with absent saved data must display “—”, while actual zeros remain zero and conditional “Not applicable” rules remain independent.

**Why:** The user clarified that using “To be mapped” for missing data misleads report readers into thinking the application integration is incomplete.

**How to apply:** Distinguish missing data from missing mappings at each report binding, not through a blanket replacement of PDF text. Preserve literal user content, saved calculations and other report types' existing fallback policies.

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

Monthly Report PDF sign-off tiles retain Submitted by/on, list completed
intermediate approvals as Reviewed by/on in ascending action-date order, and
place the actual final approval as Approved by/on last. Omit the Report ID.
Use only the current submission cycle for sign-off; prior sent-back cycles are
history, not confirmation of the current document. Never treat an assigned
approver as evidence of an approval.

**Why:** The business requested sequential reviewer/final-approver sign-off on
the monthly report. Reusing earlier cycles or assigned names would incorrectly
certify a changed or still-pending report.

**How to apply:** Use recorded approval actions and dates. A single-stage
approval has only the final sign-off, and missing legacy evidence must not be
fabricated. Keep other report types independent.

Monthly Report PDF sign-off includes available user-profile signatures below
Submitted by, Reviewed by and Approved by, matched by actual signer ID in the
report organization. Monthly Dashboard PDF adds the same sign-off evidence,
dates and signatures on a separate landscape page after its five chart pages.
Downloads and newly generated email attachments must share this mapping.

**Why:** The business explicitly requested the Monthly equivalents of the Daily
PDF signature and dashboard sign-off behavior, without changing approval logic.

**How to apply:** Keep the report's confirmation and submitter designation.
Include only actual current-cycle completed approvals; keep reviewers in action
date order and final approval last. Missing signatures are not invented. These
are profile images read at generation time, not immutable historical evidence;
replacing a profile signature changes future exports, not already frozen files.
