---
name: One Plan per Audit Schedule
description: One-to-one lifecycle rule between active Audit Schedules and active Audit Plans.
---

An active Audit Schedule can have at most one active Audit Plan. Schedule responses expose whether an active Plan already occupies the schedule so all Plan entry points can filter or disable consistently.

**Why:** UI filtering alone is stale and can be bypassed or raced by concurrent requests. Separate paginated Plan lookups can also miss occupied schedules as data grows.

**How to apply:** Serialize Plan creation by organization and schedule, check for an active Plan inside the same transaction, and return conflict when occupied. Filter occupied schedules from Plan selectors and disable every schedule-level New Plan action. Invalidate both Plan and Schedule client caches after Plan creation or deletion. Soft-deleted Plans no longer occupy the schedule.