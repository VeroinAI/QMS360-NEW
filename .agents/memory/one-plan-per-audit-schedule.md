---
name: One Plan per Audit Schedule
description: One-to-one lifecycle rule between active Audit Schedules and active Audit Plans.
---

An active Audit Schedule can have at most one active Audit Plan. Schedule responses expose whether an active Plan already occupies the schedule so all Plan entry points can filter or disable consistently.

**Why:** UI filtering alone is stale and can be bypassed or raced by concurrent requests. Separate paginated Plan lookups can also miss occupied schedules as data grows.

**How to apply:** Serialize Plan creation by organization and schedule, check for an active Plan inside the same transaction, and return conflict when occupied. Filter occupied schedules from Plan selectors and disable every schedule-level New Plan action. Invalidate both Plan and Schedule client caches after Plan creation or deletion. Soft-deleted Plans no longer occupy the schedule. When online, an empty eligible-schedule response is authoritative and must not fall back to offline IndexedDB data; use cached schedules only when the browser is actually offline.

For new Plans, select the parent created through **New Schedule** first, then
choose an **Audit Title** belonging to that parent. Standalone legacy audits
without a parent are not valid sources for new Plans; preserve their existing
Plans and history.

**Why:** The user explicitly required the two-stage selection so audits from
different New Schedules cannot be mixed, alongside the one-Plan-per-audit rule.

**How to apply:** Filter child audits by the selected parent, exclude occupied
and cancelled sources, and clear the source-dependent fields when the parent
changes. Validate the active parent relationship on creation at the server.
Do not use this creation restriction to prevent editing historical Plans.

When **New Plan** is opened against an individual audit in **Audits in schedule**
(including its Programme view), prefill and lock both **Audit Schedule** and
**Audit Title** to that audit and its parent. Only **Plans → New Plan** offers
the editable two-stage source dropdowns.

**Why:** The user explicitly distinguished creating a Plan against a specific
audit from selecting a source in the general Plans page.

**How to apply:** Carry the clicked audit and parent into the form, display their
actual titles as read-only values, and prevent selection handlers from changing
the source. Preserve editable source selection when there is no preset audit.