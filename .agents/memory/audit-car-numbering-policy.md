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

Use configurable prefix and middle text around the source value, followed by the running number without a year. The source is the linked Plan's Project Master Additional Data Contract / project no. or active Department Master Cost ID for process/department audits. Preserve text and leading zeroes; do not fall back to Cost Center or Department Value/label. Each project/department has an independent continuous sequence starting at 1, separate from Plan, Report and Finding ranges, with no annual reset.

**Why:** The user replaced yearly Plan, Report, Finding and CAR numbering with continuous yearless source sequences and last-used go-live maintenance.

**How to apply:** Resolve the source on the server, never from client-supplied number text. Continue above the highest saved former yearly last-used counter. Retain issued numbers through format changes. Manual last-used maintenance advances the next issuance by one, rejects backward moves and does not rewrite existing CARs.
