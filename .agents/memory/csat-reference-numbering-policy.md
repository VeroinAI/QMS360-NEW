---
name: CSAT reference numbering scope
description: Requested CSAT format, date source, go-live counters and staged integration boundary.
---

CSAT Reference numbering is Prefix + Project + four-digit Year + Running number. The year must come from the CSAT form's Date, not the creation timestamp. Go-live maintenance accepts the last-used number, so the next running number is last-used plus one, using independent project/year ranges and no backwards movement.

**Why:** The user requested parity with Audit go-live counter maintenance, then explicitly authorized linking the configured range to CSAT Create Draft.

**How to apply:** Allocate only on successful Create Draft, atomically with creation. Reference is read-only in the form and visible in the CSAT landing list. Preserve issued references on later saves and do not renumber legacy records. Never consume counters when saving or previewing settings. The user explicitly changed the Project segment to Project Master → Additional Data → Contract / project no., not Project Code. A missing contract/project number must block allocation with a clear maintenance message, not fall back to Project Code. Counters remain keyed by project identity and year, so changing this source text does not reset them.
