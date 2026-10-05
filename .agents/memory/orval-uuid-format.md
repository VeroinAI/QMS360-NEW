---
name: Orval UUID format compatibility
description: Generated Zod validators and UUID-formatted OpenAPI fields in this workspace
---

Avoid `format: uuid` in new OpenAPI fields until the generator and Zod version are compatible. Validate identity through membership checks or an explicit compatible validator at the API boundary instead.

**Why:** The current Orval/Zod combination generates `z.uuid()` for that format, but the installed Zod version does not expose it; codegen succeeds and the subsequent library typecheck fails.

**How to apply:** When adding UUID-looking API input fields, use `type: string` in the contract and ensure the server verifies that the referenced record belongs to the correct organization and context.

Bare OpenAPI integer output properties can also generate unavailable `z.int()` validators with this toolchain. For generated pagination/count responses, `type: number` is compatible; the implementation still returns integer counts.

**Why:** Adding count/page/limit integer properties failed the generated library typecheck even though generation itself succeeded.

**How to apply:** Check generated-library compilation whenever adding scalar schema formats or types; do not assume successful generation proves Zod compatibility.