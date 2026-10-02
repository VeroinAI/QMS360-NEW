---
name: Task rebase verification
description: Verify focused tests after automatic task rebases with overlapping edits.
---

After resolving overlapping changes during a task rebase, run the relevant tests and typecheck against the final rebased tree, even if they passed before the rebase.

**Why:** A rebase can combine independently valid edits into syntactically invalid or semantically mismatched test bodies and endpoint implementations without leaving conflict markers. An intermediate conflict resolution passing tests is not evidence the final tree still passes.

**How to apply:** Resolve each round, finish the rebase, then run the focused checks before task completion. Inspect and repair post-rebase changes rather than assuming a clean rebase preserved them. For duplicate older baseline commits, preserve the newer main implementation of files outside the task's actual changes.

After a merge, rebuild shared TypeScript libraries before treating frontend “missing export” errors as a source-contract defect.

**Why:** Generated source can be correct while the frontend still resolves stale emitted declarations; changing the source contract in response would introduce unnecessary changes.

**How to apply:** Compare source exports, refresh generated/shared-library outputs, then run the leaf application checks against the final tree.