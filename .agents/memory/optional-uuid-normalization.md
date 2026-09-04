---
name: Optional UUID input normalization
description: Boundary rule for optional UUID values submitted by QMS360 forms.
---

Optional UUID fields submitted as empty strings must be normalized to `null` before database writes.

**Why:** Controlled form inputs commonly represent “not selected” as an empty string, while PostgreSQL UUID columns reject that value and turn an otherwise valid save into a server error.

**How to apply:** At API persistence boundaries, use an explicit blank-to-null conversion for optional UUIDs. Do not rely only on nullish coalescing because it preserves empty strings.