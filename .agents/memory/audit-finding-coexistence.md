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