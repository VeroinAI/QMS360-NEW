---
name: Focused Vitest invocation
description: Avoid accidentally running the entire API test suite when requesting one regression file.
---

Use `pnpm --filter @workspace/api-server exec vitest run <test-file>` for a focused API regression run. Do not use `pnpm --filter @workspace/api-server test -- <test-file>`.

**Why:** The latter passes a literal `--` after `vitest run`; in this workspace the intended file filter was ignored and the full suite ran, including unrelated tests.

**How to apply:** Invoke Vitest directly through the filtered package and confirm that its summary names only the requested test files.

For frontend-only helper tests, run the API package's Vitest executable with
the workspace root as the test root, passing the focused frontend test path.
Do not let Vitest load the frontend's development Vite config.

**Why:** QMS360's Vite config requires workflow-provided PORT and BASE_PATH,
which are absent in an ordinary shell. Vitest is installed in leaf packages,
not as a workspace-root executable.

**How to apply:** Use `pnpm --filter @workspace/api-server exec vitest run --root ../.. artifacts/qms360/<focused-test-path>`.