---
name: Opening meeting calendar bounds
description: Individual-audit date limits, preserved meeting instants and readable legacy meeting dates.
---

Opening and Closing meeting dates follow the linked individual audit's actual inclusive
From/To calendar days, not its parent programme year or year-based display defaults.
Every time on either boundary day is valid. Missing or invalid source dates block
meeting saves with a corrective message; they must not produce an invented range.

**Why:** A programme's annual range is not evidence of the individual audit period.
Converting offset-bearing input to UTC before checking can reject a valid boundary
day or accept an invalid one.

**How to apply:** Check the original calendar-day input on both the client and
every meeting-writing API path. Preserve established stored instants and retain
the original wall-clock entry for reopening new saves. Read historical values
without rewriting them; require correction when saving an invalid old meeting.
Do not add a requirement that Closing Meeting follows Opening Meeting; both use
the same window independently.
