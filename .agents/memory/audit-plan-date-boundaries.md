---
name: Audit Plan date boundaries
description: All Plan date/time fields must use the selected child audit's actual From/To dates.
---

Every entered Audit Plan date/time must fall within the selected child audit's From Date and To Date, inclusive of both complete calendar days. This includes Start, End, any saved Opening/Closing Meeting timestamps and Activity dates. Do not substitute the parent annual programme's range or year-based DTO fallbacks.

**Why:** The user explicitly requires the dates entered on Create Audit to constrain all dates on Create Audit Plan, with an error that states the allowed range so the input can be corrected.

**How to apply:** Enforce the rule both in the form and on create/update APIs using the authoritative source audit dates. Preserve existing time-order checks and date/time storage conventions. Missing or invalid source dates need a clear corrective error, not an invented range. Apply the same boundary policy to any additional activity-row dates introduced later.

New Plan creation does not collect Opening Meeting or Closing Meeting timestamps.
Missing meeting timestamps must not block creating, sending or executing these
plans. Existing saved meeting details remain available on existing plans.

**Why:** On 2026-10-12 the user explicitly removed both meeting fields from
Create Audit Plan, without asking to delete saved meeting data.

**How to apply:** Keep Start/End and activity dates mandatory; validate meeting
timestamps only when provided. Never invent meeting dates from Plan dates to
satisfy validation. Keep existing-plan editing and execution meeting forms intact.