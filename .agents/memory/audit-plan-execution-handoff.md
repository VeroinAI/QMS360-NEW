---
name: Audit Plan execution handoff
description: Durable behavior for sending Audit Plans into Audit Execution and reopening the linked workspace.
---

Sending an Audit Plan for execution must create or reuse one active Audit Execution linked to that plan. The saved Audit Plan Circulation roles determine whom to inform; do not provide a separate role picker in the send confirmation. Opening Audit from a plan must resolve the same linked execution rather than creating another.

**Why:** Users need a reliable handoff from planning to execution, and retries or repeated clicks must not produce duplicate Audit Execution records.

**How to apply:** Use a simple confirmation from every Send for Audit entry point. Resolve saved Circulation roles to active users on the server, notify those users, and store the canonical role IDs/names with the handoff. Include circulation recipients alongside configured email-rule recipients, retaining CC and attachment settings. An explicit disabled send rule suppresses email. Keep the handoff transactionally idempotent, preserve the existing execution when the action is retried, and navigate by the returned execution identifier. Treat legacy `ready` plans as pre-send plans alongside current `draft` plans; on retry, transition them to Shared and refresh the linked execution so it appears in the current list.

**Why for circulation:** On 2026-10-28 the user replaced the extra send-dialog role selection with the plan's saved Audit Plan Circulation roles and required other email rules to remain applicable.

The Plan register's **Plan Status** and **Approval Status** are independent: Plan Status is the plan's own execution-handoff state, while Approval Status is the linked child Audit Schedule's workflow state. Plans do not acquire a separate approval workflow merely because the register adds an approval column or filter.

**Why:** The user requested both columns and filters as a landing-page change, not a new approval process.

**How to apply:** Identify Approval Status as the Audit Schedule approval state in the UI. Never infer approval from Shared, Active or Completed plan status, and never default unavailable linked approval data to Approved.