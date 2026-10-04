---
name: AWS client handoff
description: Safety boundaries when handing QMS360 frontend, backend source, and migrations to a client-hosted environment.
---

The user stated on 2026-10-04 that the GitHub handoff repository is now **private**. This supersedes the earlier temporary-public-clone approach. Use authorized private repository access for the client's clone; do not suggest reopening it publicly. Private visibility does not authorize moving production personal/signature datasets or DEV/QA business data between environments.

**Why:** The user changed the repository visibility after a data-privacy warning. Any earlier public exposure cannot be undone by changing visibility, and credentials or real datasets still need an explicit secure-handling review.

**How to apply:** Review the handoff for secrets and unnecessary real datasets without changing Git history or deleting uploads without approval. Keep environment configuration and data reconciliation separate from cloning code. Do not make infrastructure changes before the client's capabilities are confirmed. If a DBA executes SQL files manually, reconcile exactly which migrations ran and their migration ledger before invoking the migration runner, rather than replaying the baseline.