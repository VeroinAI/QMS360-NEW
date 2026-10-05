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