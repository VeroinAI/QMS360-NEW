---
name: Audit feasibility decisions
description: Business meaning and enforcement rules for a No decision in Audit Plan feasibility.
---

Selecting No for Audit Feasible records a schedule-level decision with mandatory remarks or feedback; it must not create an Audit Plan.

Cancel Audit permanently blocks future Audit Plan creation for that schedule and does not require new dates. Reschedule Audit requires a From/To date range, updates the underlying child Audit schedule's planned dates, closes the current planning attempt and preserves the feedback, but the schedule remains eligible for a future plan. Keep dates within the parent programme's range. Feedback is visible from the schedule row only when it exists.

**Why:** The two actions have different business consequences; a reschedule must change the same dates shown in Create Audit, not just record feedback. UI-only disabling or validation can be bypassed by direct or stale API clients.

**How to apply:** Persist the decision and dates on the schedule atomically, serialize it with Plan creation, enforce cancellation and date requirements in the API, keep rescheduled schedules selectable, and expose feedback through a conditional schedule info action.