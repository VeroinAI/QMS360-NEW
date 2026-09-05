---
name: RBAC setup for testing non-admin writes
description: Seeded workspace roles start with zero permission grants, so non-admin writes 403 until permissions are granted
---

Seeded workspace roles (e.g. QAQC Representative, Form Creator) start with ZERO permission grants — non-admin writes fail RBAC with 403 even though the user visibly holds the role. Also, not every login listed in `scripts/src/seed.ts` necessarily exists in a given environment's database.

**Why:** verifying non-admin behavior (permissions, field access) needs a deliberately granted non-admin account; assuming seeded roles just work produces misleading 403s.

**How to apply:** grant the needed permission to a non-admin role before testing non-admin writes, and remove the grant afterward. Never record credentials in memory — take demo logins from the seed script or ask the user.
