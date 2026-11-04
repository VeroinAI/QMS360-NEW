---
name: CSAT reference numbering scope
description: Yearless CSAT format, continuous project sequences, last-used maintenance and allocation timing.
---

CSAT Reference numbering is Prefix + Project Master Contract / project no. + Middle text + Running number. Do not include a year or reset annually. Go-live maintenance accepts the last-used number for each project without a year, so the next running number is last-used plus one, using independent continuous project ranges and no backwards movement. An empty middle text is allowed.

**Why:** The user replaced yearly CSAT ranges with yearless continuous numbering and explicitly requested configurable middle text after the contract/project segment.

**How to apply:** Allocate only on successful Create Draft, atomically with creation. Reference is read-only in the form and visible in the CSAT landing list. Preserve issued references on later saves and do not renumber legacy records. Never consume counters when saving or previewing settings. A missing contract/project number must block allocation with a clear maintenance message, not fall back to Project Code. Continue above the highest saved last-used value across former yearly ranges; do not sum them or select only the latest year. Counters remain keyed by project identity, so changing source text or middle text does not reset them. Keep CSAT date validation, but do not use its year to format or partition the reference.
