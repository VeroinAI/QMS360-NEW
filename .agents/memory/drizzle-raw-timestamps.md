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
