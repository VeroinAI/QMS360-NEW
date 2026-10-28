---
name: Audit finding record coexistence
description: Historical standalone findings and checklist-backed Findings workspace rows
---

Keep historical standalone Audit finding records and their CAR links intact when evolving the checklist-backed Findings workspace. Do not treat hiding the old cards as permission to delete their data or silently reassign their CARs.

**Why:** Existing audits may already have CAR relationships and report history based on the older records. The revised workspace uses checklist results and finding-only entries; these identities are not interchangeable.

**How to apply:** When changing reports, exports, or CAR flows, account for both record families and avoid duplicate display or destructive migration.

The CAR Register workbook's green tick means corrective action was recorded, not that the CAR was accepted, closed, or its effectiveness verified. Display and Log are read-only; Edit retains the assigned-action-taker rules, and Close/Return retains assigned Team Lead review.

**Why:** The user requested a spreadsheet-style projection with action indicators and history, not a new approval workflow or a data migration.

**How to apply:** Keep the indicator separate from lifecycle status and preserve existing identities and permissions when revising the register.

CAR response ownership is strict: only the current assigned Action Taker may edit or submit, including when the viewer is an administrator. Viewing another user's response is allowed within existing Audit visibility scope. The Display action always opens a read-only CAR Response, even for the assignee.

**Why:** The user explicitly required assignment-by-user-ID validation; administrative visibility must not permit editing another Action Taker's response.

**How to apply:** Keep response ownership checks independent from viewing and Team Lead review rights. Do not reinstate an administrator edit bypass.

Entering, saving and submitting an assigned CAR response must not depend on the linked reviewer's current Team Lead authorization. Preserve required response fields, lifecycle and review-routing checks, but enforce reviewer authorization when reviewing rather than blocking the Action Taker's submission.

**Why:** The user clarified that the logged-in user's ID must match the finding's Action Taker, rather than changing reviewer permissions to resolve a submission error.

**How to apply:** Validate the current finding assignment, not just a stale saved CAR owner, and keep submission and review authorization separate.

The CAR Register's user-visible Log contains only successful Save Response and Save & Submit Response actions. A combined Save & Submit is one event; opening Edit, Display or Log is not an event. Retain internal canonical workflow history rather than deleting it to simplify this projection.

**Why:** The user explicitly narrowed the register log to these two button actions; internal review and creation history still serves other Audit workflows.

**How to apply:** Filter before history counts and pagination, save-and-submit in one operation, and do not fabricate or rewrite historical button intent.

Audit Execution register counts combine current applicable checklist findings
with historical standalone findings, counting a checklist finding and its backing
standalone mirror only once. Removed checklist mirrors remain history, not extra
current findings. Blank and Not applicable rows do not contribute.

**Why:** The user requested total and open finding counts on the execution register;
the two storage families must not inflate those figures or lose standalone history.

**How to apply:** A saved or submitted CAR response is still open. Closed/Verified
findings or terminal CAR responses stop contributing to the open count; any
unfinished associated response keeps the finding open. Keep this display-only:
do not rewrite historical rows or close workflows while calculating counts.

The user-facing Findings workspace belongs inside an individual Audit Execution,
not as a separate top-level Audit workspace tab. Requests for Findings filters and
column layouts apply to that selected audit's existing editable Findings section.

**Why:** The user explicitly corrected the earlier interpretation that introduced
a cross-audit Findings landing page.

**How to apply:** Keep filters and display context local to the selected audit,
retain its existing entry/assignment/evidence controls, and do not restore a global
Findings navigation tab. Read-only metadata must not require unrelated module
permissions or grant access to another audit.

In the Audit Finding register, Risk Level is an independently saved value, not a
conversion from Major/Minor NC or OFI. Unrecorded risk stays blank/dash; do not
apply the older standalone DTO's default Low as if it were entered transaction data.
Likewise, Responsible Department is not an Audit Area and cannot fill that column.

Checklist item entry/editing and Add Finding require an explicit Low, Medium or
High selection. Mandatory entry does not authorize backfilling historical blanks
or silently selecting a default.

**Why:** The requested register separates Finding Type, Risk Level and Audit Area.
Filling one from a different business field would hide missing transaction data.
The user explicitly made the new Risk Level input mandatory in both entry forms.

**How to apply:** Resolve the existing Audit Area master label, retain actual
standalone risk values and current checklist/mirror risk if saved, and leave genuine
gaps visible. Changing the landing layout does not authorize adding defaults or
rewriting historical findings.