---
name: Audit CAR numbering policy
description: CAR source/year linkage, first response-save issuance and independent counters
---

Issue an Audit CAR Number on the first successful **Save response** or **Save & submit** in CAR Response. Opening Edit, starting a CAR shell, viewing, or downloading must not allocate a number. Later saves, retries, reviews and returned responses retain that number.

Previously saved CAR responses that predate numbering may have no reference even when submitted. An authorized scoped repair can issue a missing number atomically and idempotently without changing the response, approval status, owner or original creation date. Never number an unanswered shell just because it appears in the register.

**Why:** Historical production CARs predated numbering; merely configuring a number range does not backfill stored records.

**How to apply:** Scope repairs by Audit administrator or assigned Action Taker access; keep the organization counter transaction and audit history, and block issuance until the relevant Contract / project no. or Department Cost ID exists. Do not bulk-rewrite production or mutate old responses on read.

**Why:** The user explicitly specified the two response buttons as the issuance events, not creation of the underlying CAR shell.

**How to apply:** Allocate and persist the number with the successful response transaction. Keep strict current Action Taker authorization; administrator visibility does not grant response ownership. Preserve existing metadata and historical CAR/finding identities.

Use configurable prefix and middle text around the source value, followed by the linked child Schedule From Date's two-digit year and running number. The source is the linked Plan's Project Master Additional Data Contract / project no. or active Department Master Cost ID for process/department audits. Preserve text and leading zeroes; do not fall back to Cost Center or Department Value/label. Each project/department and full year has an independent sequence starting at 1, separate from Plan, Report and Finding ranges.

**Why:** The user's requested source/year rules match the other Audit ranges but CAR issuance is independent. They subsequently explicitly changed Audit source mappings to Contract / project no. and Department Cost ID.

**How to apply:** Resolve the source and date on the server, never from client-supplied number text or the current date. Retain numbers through format changes. Manual next-number maintenance stores next minus one, rejects backward moves and does not rewrite existing CARs.
