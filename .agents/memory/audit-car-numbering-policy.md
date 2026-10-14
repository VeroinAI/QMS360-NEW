---
name: Audit CAR numbering policy
description: CAR source/year linkage, first response-save issuance and independent counters
---

Issue an Audit CAR Number on the first successful **Save response** or **Save & submit** in CAR Response. Opening Edit, starting a CAR shell, viewing, or downloading must not allocate a number. Later saves, retries, reviews and returned responses retain that number.

**Why:** The user explicitly specified the two response buttons as the issuance events, not creation of the underlying CAR shell.

**How to apply:** Allocate and persist the number with the successful response transaction. Keep strict current Action Taker authorization; administrator visibility does not grant response ownership. Preserve existing metadata and historical CAR/finding identities.

Use configurable prefix and middle text around the source value, followed by the linked child Schedule From Date's two-digit year and running number. The source is the linked Plan's Project Cost Center or the active Department master Value for process/department audits. Each project/department and full year has an independent sequence starting at 1, separate from Plan, Report and Finding ranges.

**Why:** The user's requested source/year rules match the other Audit ranges but CAR issuance is independent.

**How to apply:** Resolve the source and date on the server, never from client-supplied number text or the current date. Retain numbers through format changes. Manual next-number maintenance stores next minus one, rejects backward moves and does not rewrite existing CARs.
