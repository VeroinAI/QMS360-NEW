---
name: Admin bulk workflow transfers
description: Authorization and atomicity rules for administrator-wide workflow queues and bulk reassignment.
---

Administrator-wide workflow queues, exports, and mutations must all use the effective scope granted by active administrator roles for that application. Never expand an admin operation with broader project access from a separate viewer or contributor role.

**Why:** A project-scoped administrator may also hold a wider non-admin viewing role. Using combined view scope for the admin queue exposes actions the administrator is not authorized to manage and makes list/export disagree with mutation authorization.

**How to apply:** Resolve the application-specific administrator scope once and apply it consistently to list, export, and mutation paths.

Bulk workflow reassignment must be all-or-nothing under concurrency. Conditional updates must confirm every selected record changed before writing transfer audit entries or sending notifications.

**Why:** A review or another reassignment can change a selected record after validation. Ignoring a zero-row conditional update creates partial transfers, false audit history, and incorrect notifications.

**How to apply:** Perform conditional updates in one transaction, verify each returned row, throw on any stale record so all prior changes roll back, and notify only after commit.