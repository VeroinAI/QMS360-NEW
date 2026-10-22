---
name: Drizzle raw timestamp decoding
description: Date serialization assumptions for raw SQL with the node-postgres adapter
---

Treat timestamps returned by raw Drizzle SQL execution as strings or Dates,
not guaranteed JavaScript Date objects. Normalize valid values at API response
boundaries; reject missing or invalid required timestamps rather than inventing
dates.

**Why:** The node-postgres adapter overrides the raw query parsers for PostgreSQL
TIMESTAMP, TIMESTAMPTZ and DATE to retain strings. A TypeScript cast to Date does
not decode these values. Calling toISOString directly caused the Drona Project
Master list to fail, even though the stored timestamp was valid.

**How to apply:** Distinguish schema-mapped selections from raw execution.
Cover string and Date representations, including timezone offsets, in response
serialization tests. Do not change global database parsers or stored data to
fix an API formatting assumption.

For optimistic locking, preserve the database's exact timestamp separately from
the API's JavaScript Date. Compare-and-save predicates must bind the original
database timestamp, not the Date converted back to ISO.

**Why:** PostgreSQL retains microseconds while JavaScript Dates retain only
milliseconds. An unchanged QA/QC draft was rejected as a concurrent edit because
the atomic update compared a microsecond timestamp against its truncated Date.
Rounding stored values or weakening the guard would lose real conflict protection.

**How to apply:** Keep the API timestamp contract unchanged, select a raw timestamp
for the internal atomic update, and test both unchanged microsecond values and
genuine changes within the same millisecond.
