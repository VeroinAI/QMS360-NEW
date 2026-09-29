---
name: Audit Program Manager marker
description: Intent and security boundary for the Audit Program Manager authorization.
---

Treat Audit Program Manager as an Audit-only role authorization marker. It now grants one explicit action: managing Team Lead selection on an approved parent Audit Schedule. It does not grant any other Audit operation.

**Why:** The authorization initially had no functionality; the user later specified only this post-approval Team Lead management action. Inferring additional powers from its name would change access unexpectedly.

**How to apply:** Check an active assigned role with this marker explicitly for Team Lead changes, require Audit application access and whole-programme scope, and do not let the marker satisfy unrelated create/edit or approval checks. New leads must be eligible Audit Team Leads; preserve at least one and do not remove a lead already used by an active Audit Plan.