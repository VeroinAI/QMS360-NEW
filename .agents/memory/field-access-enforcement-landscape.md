---
name: Field-access enforcement landscape
description: Two parallel field-control stores exist (only one is API-enforced), and field locks cannot target platform entities (projects/users) because module_field_settings.module is a pg enum.
---

# Field-access enforcement landscape

Two separate mechanisms control form fields, and they can disagree:

1. `module_field_settings` table — read by `assertFieldAccess` (API 422 enforcement) and by the frontend `use-field-access.ts` hook via GET /platform/field-settings. Nothing in the UI writes it except PUT /platform/field-settings.
2. `organization_settings.branding.fieldControls` JSON — read/written by the per-app `/…/admin/field-controls` endpoints and drives the admin "Form Fields" settings tab and the `useFieldControls` hook that disables form inputs.

**Why:** They were built in separate iterations; an admin lock made in one store is invisible to the other, so UI-disabling and API enforcement can drift apart.

**How to apply:** When touching field-locking behavior, check both stores. New enforcement work should use `assertFieldAccess` (module_field_settings).

Additionally: `module_field_settings.module` uses the `shared.executive_app_key` pg enum (`qaqc | lessons | audit`). Platform entities (projects, users — the only Integration Cockpit sync targets) cannot have field locks without an enum migration, and querying the table with a module value outside the enum raises a PG error.

**Why:** Enum columns reject unknown values at bind time; extending needs `ALTER TYPE … ADD VALUE` plus the schema-migration groundwork already tracked as separate tasks.

**How to apply:** Don't try to enforce field locks on cockpit sync targets (projects/users) until the enum is extended.
