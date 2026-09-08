---
name: Drizzle insert compatibility
description: Omitted values do not omit columns from Drizzle insert SQL when supporting lagging production schemas.
---

When maintaining compatibility with older database schemas, check generated INSERT columns as well as SELECT and RETURNING projections. Leaving a property out of Drizzle values does not remove its column; the ORM can emit DEFAULT for it.

**Why:** A user-import failure showed that fixing the lookup alone would still leave new-row creation dependent on an unrelated authentication column absent in production.

**How to apply:** For deliberately backward-compatible paths, use narrow read projections and a parameterized INSERT with an explicit supported column list. Assert the generated SQL excludes unsupported fields. Never add startup DDL or deployment migration hooks as a workaround.