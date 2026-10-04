---
name: QA/QC role authorization policy
description: Default-role editing, legacy compatibility and QA/QC-only scope boundaries
---
Keep QA/QC default role identities and protected metadata stable while allowing administrators to change their activity permissions in place.

**Why:** The user needs to configure the existing QAQC Representative role, not clone it or replace existing user assignments when saving permissions.

**How to apply:** Keep default names, descriptions and enabled state protected; permission editing must remain available. Preserve compatible legacy grants rather than silently dropping them. New activity-specific grants should not accidentally authorize unrelated activities.

Apply checkbox-based authorization changes to QA/QC only. Do not change Lessons or Audit role-name authorization as a side effect.

**Why:** The user explicitly required that unrelated development not be affected.

**How to apply:** Keep application-specific authorization branches separate; platform administrators retain their existing bypass.

For legacy QA/QC own-record access, original creation/import audit provenance is ownership evidence; later edits must not transfer ownership.

**Why:** Enforcing own access should not require a production schema migration solely for the role-editing fix, or incorrectly attribute a record to its most recent editor.

**How to apply:** Use original creation provenance alongside established submission/reviewer participation; fail closed when ownership cannot be established.