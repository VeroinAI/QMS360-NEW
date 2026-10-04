---
name: Audit Plan date boundaries
description: All Plan date/time fields must use the selected child audit's actual From/To dates.
---

Every Audit Plan date/time must fall within the selected child audit's From Date and To Date, inclusive of both complete calendar days. This includes Start, End, Opening Meeting, Closing Meeting and Activity dates. Do not substitute the parent annual programme's range or year-based DTO fallbacks.

**Why:** The user explicitly requires the dates entered on Create Audit to constrain all dates on Create Audit Plan, with an error that states the allowed range so the input can be corrected.

**How to apply:** Enforce the rule both in the form and on create/update APIs using the authoritative source audit dates. Preserve existing time-order checks and date/time storage conventions. Missing or invalid source dates need a clear corrective error, not an invented range. Apply the same boundary policy to any additional activity-row dates introduced later.