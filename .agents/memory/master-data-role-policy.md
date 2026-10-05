---
name: Master Data role assignments
description: User-confirmed informational semantics of single or multiple roles assigned to Master Data values.
---

Master Data role assignments must not restrict dropdown visibility or selection or grant permissions.

**Why:** The user explicitly chose “Save role assignments only” rather than role-based visibility and selection restrictions.

**How to apply:** Preserve assigned roles when values are saved and edited, alongside other value configuration. Do not turn these references into access rules.

## Audit activity defaults

The user subsequently explicitly requested Audit activity roles to default from the Activities master, with auditees defaulting from schedule-local role-to-user assignments. Both selections remain editable.

**Why:** This is a deliberate extension of the earlier “save only” choice, limited to Audit Plan point 15; it is not authorization to change role grants or dropdown visibility.

**How to apply:** Use Audit role references as editable activity defaults. Schedule assignments do not assign organization roles to their users. Preserve saved Plan overrides on reload and background changes; allow explicit reapplication of current master or schedule defaults.