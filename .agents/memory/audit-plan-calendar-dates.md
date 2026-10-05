---
name: Audit Plan calendar dates
description: Calendar-day boundaries and explicitly derived legacy activity dates.
---

Validate planned wall-clock dates against the individual linked Audit's inclusive calendar days, not its parent Programme or execution timestamps. Preserve the saved calendar day rather than coercing planned timestamps to UTC. The last Audit day includes its full evening.

**Why:** Planned activity times are calendar-based business inputs; UTC conversion and midnight end-date comparisons can reject otherwise valid final-day activities.

**How to apply:** Use the authoritative Audit bounds at every write and first transition, and serialize conflicting range edits with plan writes. Date/time contracts should retain strings rather than use generated Date coercion. In reports, planned timestamps retain their saved wall-clock date/time even with Z or offset suffixes; only actual instants such as preparation time use timezone conversion.

Legacy undated activity rows may derive both endpoints only from an actually saved shared activity timestamp, with an explicit legacy indication. Apply that compatibility derivation when reading historical data, not repeatedly to live form rows or new requests.

**Why:** Reapplying the fallback during editing silently assigns the historical shared timestamp to newly added blank rows. Missing dates must not be invented, and invalid legacy plans must be corrected before saving or transitioning.

**How to apply:** Normalize legacy form data once on initialization; keep new activity endpoints blank until entered. Prefer explicit row endpoints and preserve missing or malformed values for validation.

Never clear an offline correction merely because idempotent creation returned the same record ID. Verify the acknowledged planned dates and dated rows. A differing saved version requires explicit user review and an authorized draft update, or the queued correction must remain recoverable.

**Why:** A correction can be queued while an older create succeeds. The next create retry may return that older saved record without applying the correction.

**How to apply:** Preserve revision identity during replay, check existing-record acknowledgements, and retain corrections with a compare/apply action instead of treating them as a successful new create.