---
name: Drizzle correlated selection scoping
description: Why correlated SQL inside a single-table selected expression needs explicitly qualified outer references.
---

Drizzle may remove table qualifiers from column objects interpolated into a single-table selected SQL expression. In a correlated subquery, an intended outer `id` can then resolve to the inner table's `id`, returning no evidence without an error. Explicit SQL identifiers for the outer table and column preserve correlation.

**Why:** Legacy access-decision lookups initially appeared to work for modern reviews but silently lost historical rejections because both tables had an `id` column.

**How to apply:** When selecting a correlated scalar subquery, inspect its generated SQL and test a legacy row that requires the correlation. Do not assume interpolating a Drizzle column preserves its table qualifier in the selection builder.