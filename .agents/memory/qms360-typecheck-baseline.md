---
name: QMS360 typecheck baseline is red
description: pnpm --filter @workspace/qms360 run typecheck fails on pre-existing errors unrelated to new changes; don't treat it as a gate.
---

`pnpm --filter @workspace/qms360 run typecheck` fails with pre-existing errors: `@workspace/api-client-react` type resolution reports missing exported members (e.g. `useGetQaqcFieldControls`, `FieldControlSetting`) even though the generated client source (`lib/api-client-react/src/generated/api.ts`) does export them, plus implicit-any errors in `pages/settings/index.tsx` and `lib/use-field-access.ts`.

**Why:** The package's type resolution appears stale relative to its generated source; Vite bundles from source, so the app compiles and runs fine — only `tsc --noEmit` is red.

**How to apply:** When verifying QMS360 frontend changes, diff the typecheck output against the pre-existing baseline (stash your changes and rerun) instead of expecting a clean run, and rely on the running Vite app / browser console for real breakage.
