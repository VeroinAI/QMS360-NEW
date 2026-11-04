---
name: CAR register display semantics
description: Meaning of assignment dates and pending people on the CAR landing page.
---

Assigned Date means the recorded initial CAR creation/assignment date, not the
Finding Date or the most recent edit. A finding with no CAR yet has no recorded
CAR assignment timestamp and displays a dash.

**Why:** The landing-page redesign needed an assignment-date column, but existing
records do not reliably capture when each finding's action taker was first assigned
or subsequently changed. The initial CAR timestamp is known; earlier dates must
not be invented. This interpretation was explicitly explained during implementation.

**How to apply:** Preserve this initial-assignment meaning unless a later requirement
introduces actual assignment-event tracking. Do not silently reinterpret it as the
current owner's latest assignment date or backfill it from the due date.

Pending with identifies the current outstanding actor, not every configured
approver. Current routed approvals show the eligible alternatives at the pending
level; corrections remain with the action taker and closed CARs have no pending actor.

**Why:** Showing future levels or stale role assignments would misidentify who can
currently advance the CAR.

**How to apply:** Keep the existing separate legacy Lead-review and extension
processes intact; this is a read-only display and does not reroute approvals.
