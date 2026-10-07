---
name: Drizzle SQL array binding
description: Raw SQL interpolation of UUID lists is not a PostgreSQL array parameter
---

Do not assume an array interpolated into a Drizzle SQL template binds as one
PostgreSQL array value.

**Why:** Drizzle can expand the array as a SQL list/tuple. An `ANY` expression
with a UUID-array cast then fails at runtime even though TypeScript passes.

**How to apply:** For scoped UUID lists, use the ORM's `inArray`, or explicitly
join individually bound UUID parameters with `sql.join`. Handle the empty list
as false, never as unrestricted scope. Verify the generated query against
PostgreSQL rather than relying only on a type check.
