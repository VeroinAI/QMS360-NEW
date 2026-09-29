---
name: Audit status remarks migration
description: Preserving older audit document notes after Design and Procurement remarks became section-wide.
---

Design Status and Procurement Status each have one overall Remarks field, independent from their numeric status rows. If older audits still contain row-level remarks, surface those notes together in the overall field with their row labels; never silently discard them.

**Why:** Existing users may have entered distinct notes on several rows before the UI changed to one Remarks field per tile.

**How to apply:** When changing status metadata or rendering older audits, retain the combined legacy text until the section-wide remarks are explicitly saved. Keep Design and Procurement remarks independent.