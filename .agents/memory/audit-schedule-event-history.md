---
name: Audit Schedule event history
description: History access, privacy, retention, and compatibility requirements for user-visible Schedule logs.
---

Audit Schedule history is read-only, newest first by server date/time, and follows Schedule viewing scope. A parent history includes only the child audits the viewer can access, including retained deleted children. Never fabricate older events that were not recorded, or expose raw snapshots containing private file paths or signatures.

**Why:** The user requested an industry-standard event log for Audit Schedules. Existing administrative events already contain useful history but can contain protected attachment/signatory details, and parent visibility does not imply visibility to all child projects.

**How to apply:** Reuse the event store and project a safe business-level history. Treat archived history as retained evidence with the same tenant and capability boundaries as active records. Avoid logging log-refresh reads as domain changes.

Audit events are operational inputs, not only display text. Preserve canonical workflow actions when changing human-readable labels, and check approval-cycle/PDF consumers whenever event semantics change.

**Why:** Renaming a resubmission event caused existing approval-cycle readers to select the wrong cycle and omit intermediate PDF signatories.

**How to apply:** Derive richer labels from recorded before/after transitions; verify final signatories and review-cycle boundaries alongside event-history tests.