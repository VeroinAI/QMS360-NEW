---
name: Audit Report approval
description: Module-specific approval after Audit completion, scope rules and schedule compatibility.
---

Mark Complete submits the Audit Report through explicit Audit Report approval
roles. Approval roles require a module selection and a positive saved level.
Scheduling and report approvals are independent; the old generic approval
grant remains schedule-only unless an explicit report approval grant is added.
An explicit report-only selection must not insert that role into new schedule
approval chains. Existing submitted schedule chains retain their snapshots.

Reviewers must be active, in the same organization, and authorized by the
assignment carrying the report approval permission for the actual record scope.
Do not combine approval from one assignment with project access from another.
Organization-wide assignments can cover projectless audits. Same-level reviewers
are alternatives; approval proceeds through ascending saved levels, with a route
snapshot retained during review.

Pending and approved report content is read-only. Send-back requires correction
remarks, unlocks editing, and resubmission restarts the approval route. Completion
and report approval are separate statuses. CAR response workflows stay separate,
and report downloads retain the existing completion-based eligibility rule.

**Why:** The user requested approval upon completion with mandatory module
selection, while explicitly requiring existing schedule approval to keep working.

**How to apply:** Show report approval beside Mark Complete, provide reviewer
actions and a scoped action queue, and enforce permissions and read-only rules
on the server as well as in the UI.

Audit permission additions must update both the module catalog and the OpenAPI
permission-key enum before regenerating validators. Verify role creation through
the actual Settings API, not only by inserting fixture permissions directly.

**Why:** Directly seeded workflow fixtures can pass while the role editor fails:
the catalog can render a new grant that the request enum still rejects.

In the Audit Execution register, **Audit Status** is the execution lifecycle and
**Report Status** is the report approval state. Completion must never be displayed
as report approval, and adding these filters must not change download eligibility.

**Why:** The requested landing-page layout separates these two status columns;
existing completion and approval are independent business processes.

**How to apply:** Preserve the distinct statuses even for completed audits with
pending or sent-back reports. Do not infer Approved from completion.
