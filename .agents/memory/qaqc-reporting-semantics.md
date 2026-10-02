---
name: QA/QC reporting semantics
description: SOW interpretation for carry-forward baselines, document snapshots, survey dates, and QTBT manhours.
---

Monthly and daily carry-forward uses the immediately preceding submitted report, including one awaiting approval, or its approved equivalent. Approval is not a prerequisite for the next period. The first report starts from zero only when there is no usable history; later reports require an immediate submitted predecessor. CSAT is an independent dated survey, not a forced monthly submission.

**Why:** The SOW says previous submission, not previous approval, and specifies a monthly cadence only for the quality report. Waiting for approval or imposing that cadence on surveys adds restrictions not requested.

Daily document data represents absolute snapshots. Do not sum snapshots across days; filtered movement is the end snapshot minus the start snapshot, and the default view is the latest absolute snapshot.

**Why:** The SOW explicitly distinguishes the latest cumulative snapshot from selected-date/range movement.

QTBT manhours are attendees × duration in minutes ÷ 60. The SOW's apparent copied calculation was flagged to the user; preserve this dimensional interpretation unless they provide a different confirmed formula.

**Why:** Multiplying attendees by elapsed hours measures participant manhours; unrelated inspection-count formulas do not.

**How to apply:** Keep form previews, server calculations, historical baselines, Excel/PDF exports and scheduled distributions consistent with these rules. Distribution calendar days are days of month, not weekdays.

The six SOW sections supplied for QA/QC Metrics New Entry (Project Details through Quality Manpower) describe a monthly project report, not an individual NCR/RFI/RMI category transaction. Reuse monthly report storage rather than introducing a second project/month submission store. Keep legacy category metric records and their editing separate.

**Why:** These sections are monthly report metadata and must share the existing project-period uniqueness, historical baseline, and approval workflow without replacing unrelated metric development.

**How to apply:** Save these sections as a monthly draft; remaining monthly report sections and approval continue through the existing full-report workflow.

Manpower departments in this six-section entry are free text, as specified in the supplied field table. Keep the existing master-data department checks for legacy monthly entries and NCR ageing.

**Why:** A text input that accepts a department in its preview but rejects it on save unless it is registered in master data does not implement the supplied field definition.