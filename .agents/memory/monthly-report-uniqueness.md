---
name: Monthly report uniqueness
description: Duplicate monthly reports must be blocked across workflow states, with early feedback and race-safe save checks.
---

One monthly QA/QC report per project and reporting month is allowed across all workflow statuses, not just Draft.

**Why:** The user explicitly requested duplicate feedback when choosing the project/month, including the existing report's status, and again at saving because two users can start the same month simultaneously.

**How to apply:** Treat the selection check as advisory and the save transaction/database constraint as authoritative. Never permit a second report merely because the first is Submitted, Approved or Sent back. Preserve normal deletion semantics and project permissions; duplicate feedback needs existence/status, not another user's report contents.
