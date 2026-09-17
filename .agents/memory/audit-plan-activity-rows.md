---
name: Audit Plan activity rows
description: Compatibility rule for repeatable activity details in Audit Plans.
---

Audit Plan activity details are an ordered, repeatable row collection. Each row contains an Activities master-data value, multiline remarks, and the plan Auditee. Legacy single-value activity fields represent the first row only and must not become the primary model again.

**Why:** Older plans and offline records stored one activity across separate fields. Replacing those fields outright would make historical plans unreadable, while keeping them as the active model would prevent multiple activity rows and tie the product to a hard-coded option list.

**How to apply:** Read the row collection when present and synthesize one row from legacy fields otherwise. On write, validate every activity against active Activities master data, persist the full collection, and mirror its first row into legacy fields for compatibility. Keep add/delete behavior and per-row validation in the form.