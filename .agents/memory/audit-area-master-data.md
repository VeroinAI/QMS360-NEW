---
name: Audit Area master data reuse
description: Which master-data group the Audit Checklist uses for its Audit Area choices.
---

The existing “Audit Area” master-data group is shared with QA/QC and is the source for Audit Checklist area choices. Its code is literally “Audit Area”, not “audit_areas”. Keep the existing values and identity; do not create a second list with a similar name.

**Why:** The workspace's development database already contained populated Audit Area values in a QA/QC-scoped group when the Audit Checklist was updated. A new audit-specific group would hide those configured values and cause divergent administration.

**How to apply:** Resolve choices through the shared master-data lookup and validate new choices server-side against active values. Do not infer audit scope from the group's original QA/QC classification.