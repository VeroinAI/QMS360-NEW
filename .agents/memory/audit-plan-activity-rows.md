---
name: Audit Plan activity rows
description: Compatibility rule for repeatable activity details in Audit Plans.
---

Audit Plan activity details are an ordered, repeatable row collection. Each row contains a unique Activities master-data value, multiline remarks, and the plan Auditee. The same Activities / Section value cannot appear in more than one row. Activities master data may define multiline default remarks; selecting an activity copies that text into the plan row, after which the plan copy remains independently editable. Legacy single-value activity fields represent the first row only and must not become the primary model again.

**Why:** Older plans and offline records stored one activity across separate fields. Replacing those fields outright would make historical plans unreadable, while keeping them as the active model would prevent multiple activity rows and tie the product to a hard-coded option list. Default remarks are reusable guidance, not a live link: applying them reactively would overwrite plan-specific edits.

**How to apply:** Read the row collection when present and synthesize one row from legacy fields otherwise. On write, validate every activity against active Activities master data, reject duplicate sections case-insensitively, persist the full collection, and mirror its first row into legacy fields for compatibility. In the form, disable sections already selected by another row and retain server-side rejection for bypassed UI checks. Copy default remarks only during an explicit section selection; do not use a reactive effect that can overwrite later textarea edits.