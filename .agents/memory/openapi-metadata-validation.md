---
name: OpenAPI metadata validation
description: Prevent generated Zod validators from discarding unrelated extensible metadata.
---

When adding typed fields to extensible metadata, verify that generated validators preserve all existing unknown keys on both request and response paths.

**Why:** Orval generated a stripping object for a schema combining known properties with `additionalProperties: true`, dropping unrelated remarks and category links despite the OpenAPI declaration allowing them.

**How to apply:** Use an explicit intersection of the typed object and an open record when the generator ignores additional properties on a known-property object. Test round trips of unrelated metadata, including partial updates, rather than relying on the schema declaration alone.