---
name: PostgreSQL catalog comparison pitfalls
description: Non-obvious PostgreSQL/Drizzle metadata behavior when comparing semantic schema definitions.
---

Do not assume catalog identifier arrays and Drizzle column objects have the same representation as application values.

**Why:** PostgreSQL catalog attributes use `name`, and Node pg does not decode `name[]` as a JavaScript array the way it decodes `text[]`. This can make identical foreign keys appear different. Drizzle extra-config column objects can also differ by identity from the main table columns, including those used in composite primary keys.

**How to apply:** Cast catalog identifier-array elements to text before reading them into Node. Match a constraint's columns by name within its table, not JavaScript object identity. Include PostgreSQL's implicit NOT NULL behavior for primary keys when interpreting source metadata.

Do not infer btree ordering solely from a per-column index deparser.

**Why:** Per-column deparsing can omit ordering decorators. Index keys may be identical while their actual sort direction or null ordering differs.

**How to apply:** Read the catalog's per-key option flags when comparing btree definitions, alongside key expressions, uniqueness and partial predicates.

Semantic normalization must keep SQL literals opaque and compare JSONB numbers losslessly.

**Why:** Parentheses and SQL-looking text inside a quoted predicate are data, not syntax; changing that data changes which rows a partial index constrains. PostgreSQL JSONB also preserves numeric precision beyond JavaScript's safe integer and decimal range, so ordinary JSON.parse can incorrectly classify distinct database defaults as equivalent.

**How to apply:** Rewrite SQL token groups rather than rejoined expression text. For JSONB defaults, preserve numeric lexemes and use exact decimal normalization, or conservatively report differences instead of parsing numbers through JavaScript Number.