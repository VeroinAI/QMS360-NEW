---
name: AWS client handoff
description: Safety boundaries when handing QMS360 frontend, backend source, and migrations to a client-hosted environment.
---

The user explicitly chose a temporarily **public** GitHub repository for the client's initial clone, with a plan to make it private afterward. Respect that choice; do not insist on private access as a prerequisite. Still explain that public exposure cannot be undone by later changing visibility, and review the entire tracked repository and history for demo accounts, secrets, and proprietary material before publication. The full monorepo can build both frontend and backend; a backend-only folder cannot build without shared workspace packages.

**Why:** The client requested a public clone, but the workspace contains demonstration credential material and application assets. Anyone can copy public history during the brief exposure window, even after visibility changes.

**How to apply:** Offer the static frontend ZIP or build it from the full clone, and do not make infrastructure changes before the client's capabilities are confirmed. If a DBA executes SQL files manually, reconcile exactly which migrations ran and their migration ledger before invoking the migration runner, rather than replaying the baseline.