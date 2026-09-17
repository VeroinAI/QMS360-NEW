---
name: Audit Plan execution handoff
description: Durable behavior for sending Audit Plans into Audit Execution and reopening the linked workspace.
---

Sending an Audit Plan for execution must create or reuse one active Audit Execution linked to that plan. Before the first handoff, users select one or more active Audit roles to inform. Opening Audit from a plan must resolve the same linked execution rather than creating another.

**Why:** Users need a reliable handoff from planning to execution, and retries or repeated clicks must not produce duplicate Audit Execution records.

**How to apply:** Use the same required multi-role confirmation dialog from every Send for Audit entry point. Resolve selected roles to active users on the server, notify those users, and store the canonical role IDs/names with the handoff. Keep the handoff transactionally idempotent, preserve the existing execution when the action is retried, and navigate by the returned execution identifier. Treat legacy `ready` plans as pre-send plans alongside current `draft` plans; on retry, transition them to Shared and refresh the linked execution so it appears in the current list.