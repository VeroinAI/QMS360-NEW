---
name: Audit feasibility decisions
description: Business meaning and enforcement rules for a No decision in Audit Plan feasibility.
---

Selecting No for Audit Feasible records a schedule-level decision with mandatory remarks or feedback; it must not create an Audit Plan.

Cancel Audit permanently blocks future Audit Plan creation for that schedule. Reschedule Audit closes the current planning attempt and preserves the feedback, but the schedule remains eligible for a future plan. Feedback is visible from the schedule row only when it exists.

**Why:** The two actions have different business consequences, and UI-only disabling can be bypassed by direct or stale API clients.

**How to apply:** Persist the current decision on the schedule, serialize it with Plan creation, enforce cancellation in the API, keep rescheduled schedules selectable, and expose feedback through a conditional schedule info action.