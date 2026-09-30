---
name: Audit Schedule data-entry scope
description: Security intent for Audit roles whose create/edit checkbox historically stores a data-entry grant.
---

Treat the Audit role's legacy “Create / edit” selection as permission to create and update Audit Schedules, including schedule evidence upload, but not as permission to create programmes, approve, delete schedules, or mutate other Audit modules. Describe it as schedule-specific in the role UI.

**Why:** Existing production users were given this checkbox, but the Schedule endpoint did not recognize its stored grant. Broadly accepting that grant for every Audit mutation would unexpectedly elevate those users. The user confirmed a schedule-only fix.

**How to apply:** When adding Audit actions or changing permission checks, keep the schedule data-entry grant restricted to explicit schedule editing routes; use separate permissions for other actions and retain full project-scope checks.

Programme creation has a separate capability for the top-level Programme creation request. It does not grant child Schedule edits or other Programme mutations, and a role carrying it must be assigned organization-wide because a new Programme has no project scope.

**Why:** The user needs to grant an Employee the ability to start Programmes without making all Schedule editors Programme creators or elevating them to Audit administrators. A project-limited creation grant would create a projectless parent outside that assignment's scope.

**How to apply:** Preserve separate Programme-create and Schedule-edit checks when extending Audit authorization. If Programme creation becomes project-scoped in the future, revisit the organization-wide condition alongside the new parent data model.