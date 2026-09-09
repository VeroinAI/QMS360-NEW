---
name: Orval Zod format quirks
description: UUID formats and integer types in OpenAPI make Orval emit Zod APIs unavailable in this workspace.
---

In `lib/api-spec/openapi.yaml`, never write `format: uuid` on string fields. The orval zod generator emits `zod.uuid()` for it, but the pinned zod (3.25.76) has no such export, so `pnpm --filter @workspace/api-spec run codegen` fails at its `typecheck:libs` step with TS2339.

**Why:** Lost a codegen cycle to this; the failure surfaces only after orval regenerates `lib/api-zod/src/generated/api.ts`, and the rest of the spec deliberately avoids the format.

**How to apply:** Write UUID fields as plain `{type: string}` (the established convention across the spec). If codegen ever fails with `Property 'uuid' does not exist on type 'typeof zod'`, grep the spec for `format: uuid` and remove it.

Same trap with `type: integer`: orval emits `zod.int()` (zod v4 style), which zod 3.25.76 also lacks — identical TS2339 failure. Use `type: number` with `minimum`/`maximum` bounds instead and enforce integer-ness in the route handler (`Number.isInteger`).
