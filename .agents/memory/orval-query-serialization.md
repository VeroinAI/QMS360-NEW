---
name: Orval operation-level query parameters
description: Path-level OpenAPI query parameters can appear in generated types while disappearing from generated request URLs.
---

Declare query parameters on each operation rather than only on the parent OpenAPI path when generating this workspace's client.

**Why:** With Orval 8.23, an inherited path-level query parameter produced correct TypeScript parameter types but an empty URL serialization loop. Department numbering looked correct in the UI while saves silently omitted its source selection and reached the Project default on the server.

**How to apply:** Inspect the generated URL builder after changing parameter inheritance. Add a focused regression assertion on the actual generated URL, including optional enum/string queries; successful type checks alone do not prove the query is sent. Fix the spec and regenerate, never patch generated files.
