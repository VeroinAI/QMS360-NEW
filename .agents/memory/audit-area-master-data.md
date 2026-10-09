---
name: Audit Area master data reuse
description: Which master-data group the Audit Checklist uses for its Audit Area choices.
---

The existing “Audit Area” master-data group is shared with QA/QC and is the source for Audit Checklist area choices. Its code is literally “Audit Area”, not “audit_areas”. Keep the existing values and identity; do not create a second list with a similar name.

**Why:** The workspace's development database already contained populated Audit Area values in a QA/QC-scoped group when the Audit Checklist was updated. A new audit-specific group would hide those configured values and cause divergent administration.

**How to apply:** Resolve choices through the shared master-data lookup and validate new choices server-side against active values. Do not infer audit scope from the group's original QA/QC classification.

The CAR Register's Audit Area column must display the corresponding configured
master-data label rather than its stored key.

**Why:** On 2026-10-09 the user explicitly requested label display without
impacting other development. Labels can differ from any guessed expansion of
the key.

**How to apply:** Resolve the label for presentation only; retain original keys
and record identities in storage and action callbacks. Keep unmapped historical
values readable rather than fabricating a label or rewriting their data.