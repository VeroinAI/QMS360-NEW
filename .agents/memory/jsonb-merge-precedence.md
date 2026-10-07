---
name: JSONB metadata merge precedence
description: Safe PostgreSQL JSONB merges when selecting an operand with -> or ->>.
---

Parenthesize extracted JSONB operands when combining `->` with `||`.
Use `destination || (source->'metadata')`, not `destination || source->'metadata'`.

**Why:** PostgreSQL can interpret the latter as extracting metadata from the
concatenated object. A merge then loses destination-only keys. Tests where both
sides already have identical metadata can pass while this data loss is hidden.

**How to apply:** For metadata writes or transfers, test with both source keys
and destination-only keys. Explicitly preserve destination-only references
unless the owner approved their removal.
