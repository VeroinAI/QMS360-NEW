---
name: Audit schedule programme guards
description: Compatibility and authorization rules for parent programmes stored with child Audit schedules.
---

Parent Audit programmes share persistence with child Audit schedules for backward compatibility, but they are distinct record kinds. Every legacy child endpoint and every downstream schedule reference must reject programme records.

Programme and child-schedule approvals use the same sequential role convention: one active Audit role per stage, named with an `L<number>` marker, granted Approve / reject, and staffed through Audit role assignments. Snapshot the ordered chain on submission; only the current stage may act or see review controls.

An approved parent programme owns the approval state of its children: final parent approval atomically promotes every active child to Approved, and any child created later under that approved parent must start Approved. Serialize child creation against final parent approval so concurrent requests cannot leave a Draft child behind.

Deletion follows the hierarchy: an annual programme can be deleted only while unapproved and empty; a child schedule can be deleted only while unapproved. Enforce these rules in the API as well as disabled UI controls.

**Why:** Without a kind guard, legacy submit, review, delete, evidence, plan, or audit routes can bypass the programme's sequential approval workflow. Broad admin-only child review and state-only UI controls previously exposed approval actions to every approver and allowed child schedules to skip directly to Approved. Project-scope checks over multiple children must also be awaited before deciding access; testing unresolved promises silently grants access. Updating existing children without coordinating later child inserts creates a race where a new Draft child can appear immediately after parent approval. UI-only delete restrictions can be bypassed by direct API calls.

**How to apply:** When adding a route that accepts an Audit schedule ID, assert that it is a child before reading or mutating it. On submission, require numbered approval roles and active assignees, notify only the first stage, and persist the chain/index. On review, require current-role membership even for administrators, advance one stage atomically, notify the next stage, and immediately replace cached client rows from the response. Final parent approval and child promotion belong in one transaction; child creation must lock and re-read its parent before choosing the initial status. Before deleting a programme, reject Approved state or any active child; before deleting a child, reject Approved state and verify scope. Send Back must clear approval progress and expose resubmission only to the creator; resubmission starts again at L1. Administrator bypass applies to scope checks, not approval-stage membership. Otherwise await scope checks for every active child and reject if any child is outside the actor's scope.