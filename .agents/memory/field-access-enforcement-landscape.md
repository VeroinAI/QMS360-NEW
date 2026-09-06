---
name: Field-access enforcement landscape
description: Two parallel field-control stores exist, BOTH now API-enforced by different helpers; field locks cannot target platform entities (projects/users) because module_field_settings.module is a pg enum.
---

# Field-access enforcement landscape

Two separate mechanisms control form fields, and they can disagree:

1. `module_field_settings` table — read by `assertFieldAccess` (API 422 read-only enforcement) and by the frontend `use-field-access.ts` hook via GET /platform/field-settings. Written only by PUT /platform/field-settings, which validates keys against `FIELD_CATALOG`.
2. `organization_settings.branding.fieldControls` JSON — read/written by the per-app `/…/admin/field-controls` endpoints, drives the admin "Form Fields" tab and the `useFieldControls` hook, and is API-enforced by `assertFieldControls` (read-only + mandatory, with admin bypass) on the registry forms' create/update endpoints. The PUTs reject unknown form/field keys with 422 via `assertKnownFieldControlKeys`, validated against the shared registry in `@workspace/field-controls` (lib/field-controls) — the single source of truth imported by both api-server and qms360. Note: the composite lib needs `tsc -b lib/field-controls` once before api-server typecheck passes.

**Why:** They were built in separate iterations; an admin lock made in one store is invisible to the other, so UI-disabling and API enforcement can drift apart.

**How to apply:** When touching field-locking behavior, check both stores. When adding a new controllable form field, register it in BOTH the server `FIELD_CATALOG` (with accurate UI create defaults — wrong defaults falsely reject legit creates) and the frontend `fieldControlRegistry` in artifacts/qms360, plus `EXTRA_FIELD_SPECS` in src/lib/field-controls.ts if the field maps to multiple body keys (GPS lat/lng), is server-managed (capturedAt), or has conditional/blank semantics (repeat fields). Registry form keys differ from catalog keys for qaqc "metric"→"metric-entry" and "document-log"→"document-governance-log" (alias map in field-controls.ts).

Additionally: `module_field_settings.module` uses the `shared.executive_app_key` pg enum (`qaqc | lessons | audit`). Platform entities (projects, users — the only Integration Cockpit sync targets) cannot have field locks without an enum migration, and querying the table with a module value outside the enum raises a PG error.

**Why:** Enum columns reject unknown values at bind time; extending needs `ALTER TYPE … ADD VALUE` plus the schema-migration groundwork already tracked as separate tasks.

**How to apply:** Don't try to enforce field locks on cockpit sync targets (projects/users) until the enum is extended.
