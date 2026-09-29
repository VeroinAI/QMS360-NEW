---
name: Audit finding record coexistence
description: Historical standalone findings and checklist-backed Findings workspace rows
---

Keep historical standalone Audit finding records and their CAR links intact when evolving the checklist-backed Findings workspace. Do not treat hiding the old cards as permission to delete their data or silently reassign their CARs.

**Why:** Existing audits may already have CAR relationships and report history based on the older records. The revised workspace uses checklist results and finding-only entries; these identities are not interchangeable.

**How to apply:** When changing reports, exports, or CAR flows, account for both record families and avoid duplicate display or destructive migration.