---
name: AWS client handoff
description: Safety boundaries when handing QMS360 frontend, backend source, and migrations to a client-hosted environment.
---

The user clarified that the QMS360 frontend is hosted in Drona; AWS handoff must
distinguish Drona frontend delivery from AWS backend/database preparation.

**Why:** Generic instructions to serve the frontend on AWS incorrectly imply a
second frontend deployment rather than updating the existing Drona frontend.

**How to apply:** Ask the Drona team to update the frontend and retain SDK/profile
integration. Ask the AWS team to deploy the API, configure database/session
settings and reconcile migrations. Confirm frontend-to-API routing and access
policies without assuming both services share a host.

The user stated on 2026-10-04 that the GitHub handoff repository is now **private**. This supersedes the earlier temporary-public-clone approach. Use authorized private repository access for the client's clone; do not suggest reopening it publicly. Private visibility does not authorize moving production personal/signature datasets or DEV/QA business data between environments.

**Why:** The user changed the repository visibility after a data-privacy warning. Any earlier public exposure cannot be undone by changing visibility, and credentials or real datasets still need an explicit secure-handling review.

**How to apply:** Review the handoff for secrets and unnecessary real datasets without changing Git history or deleting uploads without approval. Keep environment configuration and data reconciliation separate from cloning code. Do not make infrastructure changes before the client's capabilities are confirmed. If a DBA executes SQL files manually, reconcile exactly which migrations ran and their migration ledger before invoking the migration runner, rather than replaying the baseline.

The user stated on 2026-10-08 that they have migrated the database to the Drona
server. Their subsequent platform-role request is a selective data extraction,
not a request to repeat the full database migration.

**Why:** The user explicitly distinguished missing platform-role data from the
earlier master-data export.

**How to apply:** Treat catalogue transfers separately from schema deployment.
Confirm whether the destination is the migrated QMS role catalogue or a
Drona-owned role table before mapping identities; neither approval authorizes
changing users' role assignments or importing unrelated permission grants.