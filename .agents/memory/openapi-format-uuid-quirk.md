---
name: Orval codegen rejects format: uuid
description: Using `format: uuid` on string fields in lib/api-spec/openapi.yaml makes orval emit `zod.uuid()`, which the workspace zod version does not have — typecheck:libs fails and the whole codegen command exits non-zero.
---

In `lib/api-spec/openapi.yaml`, never write `format: uuid` on string fields. The orval zod generator emits `zod.uuid()` for it, but the pinned zod (3.25.76) has no such export, so `pnpm --filter @workspace/api-spec run codegen` fails at its `typecheck:libs` step with TS2339.

**Why:** Lost a codegen cycle to this; the failure surfaces only after orval regenerates `lib/api-zod/src/generated/api.ts`, and the rest of the spec deliberately avoids the format.

**How to apply:** Write UUID fields as plain `{type: string}` (the established convention across the spec). If codegen ever fails with `Property 'uuid' does not exist on type 'typeof zod'`, grep the spec for `format: uuid` and remove it.
