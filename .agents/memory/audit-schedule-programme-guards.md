---
name: Audit schedule programme guards
description: Compatibility and authorization rules for parent programmes stored with child Audit schedules.
---

Parent Audit programmes share persistence with child Audit schedules for backward compatibility, but they are distinct record kinds. Every legacy child endpoint and every downstream schedule reference must reject programme records.

Programme and child-schedule approvals use the same sequential role convention: one active Audit role per stage, named with an `L<number>` marker, granted Approve / reject, and staffed through Audit role assignments. Snapshot the ordered chain on submission; only the current stage may act or see review controls.

**Why:** Without a kind guard, legacy submit, review, delete, evidence, plan, or audit routes can bypass the programme's sequential approval workflow. Broad admin-only child review and state-only UI controls previously exposed approval actions to every approver and allowed child schedules to skip directly to Approved. Project-scope checks over multiple children must also be awaited before deciding access; testing unresolved promises silently grants access.

**How to apply:** When adding a route that accepts an Audit schedule ID, assert that it is a child before reading or mutating it. On submission, require numbered approval roles and active assignees, notify only the first stage, and persist the chain/index. On review, require current-role membership even for administrators, advance one stage atomically, notify the next stage, and immediately replace cached client rows from the response. Send Back must clear approval progress and expose resubmission only to the creator; resubmission starts again at L1. Administrator bypass applies to scope checks, not approval-stage membership. Otherwise await scope checks for every active child and reject if any child is outside the actor's scope.