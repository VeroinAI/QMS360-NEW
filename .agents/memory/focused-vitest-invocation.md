---
name: Focused Vitest invocation
description: Avoid accidentally running the entire API test suite when requesting one regression file.
---

Use `pnpm --filter @workspace/api-server exec vitest run <test-file>` for a focused API regression run. Do not use `pnpm --filter @workspace/api-server test -- <test-file>`.

**Why:** The latter passes a literal `--` after `vitest run`; in this workspace the intended file filter was ignored and the full suite ran, including unrelated tests.

**How to apply:** Invoke Vitest directly through the filtered package and confirm that its summary names only the requested test files.