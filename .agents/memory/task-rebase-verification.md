---
name: Task rebase verification
description: Verify focused tests after automatic task rebases with overlapping edits.
---

After resolving overlapping changes during a task rebase, run the relevant tests and typecheck against the final rebased tree, even if they passed before the rebase.

**Why:** A rebase can combine independently valid test edits into syntactically invalid or semantically mismatched test bodies without leaving conflict markers. An intermediate conflict resolution passing tests is not evidence the final tree still passes.

**How to apply:** Resolve each round, finish the rebase, then run the focused checks before task completion. Inspect and repair any post-rebase test changes rather than assuming a clean rebase preserved them.