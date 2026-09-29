---
name: Orval UUID format compatibility
description: Generated Zod validators and UUID-formatted OpenAPI fields in this workspace
---

Avoid `format: uuid` in new OpenAPI fields until the generator and Zod version are compatible. Validate identity through membership checks or an explicit compatible validator at the API boundary instead.

**Why:** The current Orval/Zod combination generates `z.uuid()` for that format, but the installed Zod version does not expose it; codegen succeeds and the subsequent library typecheck fails.

**How to apply:** When adding UUID-looking API input fields, use `type: string` in the contract and ensure the server verifies that the referenced record belongs to the correct organization and context.