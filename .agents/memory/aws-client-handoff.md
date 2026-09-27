---
name: AWS client handoff
description: Safety boundaries when handing QMS360 frontend, backend source, and migrations to a client-hosted environment.
---

Prefer client-owned **private** repository access for the backend until public release is explicitly approved and the entire tracked repository and history are reviewed for demo accounts, secrets, and proprietary material. Do not assume a backend-only clone of this monorepo can build without shared workspace packages.

**Why:** The client asked for a public backend repository, but the workspace contains demonstration credential material and application assets. Publicizing the repository is a broader disclosure than granting the client's deployment team clone access.

**How to apply:** Share a built frontend ZIP for static hosting without UAT sign-in hints; require security and ownership review before making source public. If a DBA executes SQL files manually, reconcile exactly which migrations ran and their migration ledger before invoking the migration runner, rather than replaying the baseline.