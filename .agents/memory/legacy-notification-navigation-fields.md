---
name: Legacy notification navigation fields
description: Compatibility constraint for application notification tables without navigation columns.
---

Application notification code must remain compatible with deployed or development tables that do not yet contain `record_type` and `record_id`. A notification storage failure must never reverse or falsely report failure for an already-completed workflow transition.

**Why:** Production-like schemas have omitted these navigation columns even when current Drizzle definitions include them. Inserts and default ORM selects can therefore fail after the underlying business record has already transitioned.

**How to apply:** Keep workflow state and audit writes authoritative. Use the shared compatibility helpers for notification inserts, lists, and read markers; preserve navigation metadata through their legacy fallback until every environment is confirmed migrated.