---
name: Audit Plan execution handoff
description: Durable behavior for sending Audit Plans into Audit Execution and reopening the linked workspace.
---

Sending an Audit Plan for execution must create or reuse one active Audit Execution linked to that plan. Opening Audit from a plan must resolve the same linked execution rather than creating another.

**Why:** Users need a reliable handoff from planning to execution, and retries or repeated clicks must not produce duplicate Audit Execution records.

**How to apply:** Keep the handoff transactionally idempotent, preserve the existing execution when the action is retried, and navigate by the returned execution identifier. Treat legacy `ready` plans as pre-send plans alongside current `draft` plans; on retry, transition them to Shared and refresh the linked execution so it appears in the current list.