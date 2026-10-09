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

For system-default role transfers, the user explicitly means application roles
across Lessons Learned, QA/QC and Audit, not merely the global platform-role list.

**Why:** The user clarified the intended role scope after receiving the platform
catalogue. Confusing the two leaves each application's role list unpopulated.

**How to apply:** Export the system-marked application roles from the requested
source environment. Keep role definitions separate from optional current
permission grants and user assignments; do not regenerate untouched factory
defaults when the user requested persisted production data.

The user clarified on 2026-10-09 that their AWS/Drona team has no frontend or
backend development support. QMS360 application code changes are handled here;
the external team supplies infrastructure, configuration and deployment support.

**Why:** Asking that team to implement a storage adapter or application changes
misstates the agreed responsibility and prevents an actionable handoff.

**How to apply:** Request only missing service details and secure access needed
for the requested feature. Implement required QMS adaptations here, then
provide deployment instructions through the existing handoff.

The user confirmed that AWS Node.js hosting, HTTPS, GitHub delivery and the
running application are already working. For this infrastructure discussion,
they want only attachment-storage decisions and SMTP configuration instructions.

**Why:** The user corrected repeated requests for settled hosting details,
unnecessary existing-file transfers and database recovery planning.

**How to apply:** Do not reopen hosting/deployment questions or add file-migration
and database-recovery scope unless requested. Offer private S3 or explicit
database attachment storage as a choice requiring QMS code adaptation. Direct
SMTP setup to the existing Integration Cockpit; involve infrastructure support
only for an observed connectivity/configuration problem. Supply SQL separately
when the user requests a particular production data operation.