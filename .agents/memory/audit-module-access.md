---
name: Audit module access
description: Compatibility and scope policy when administering module-specific Audit role grants.
---

Audit module grants are additive to existing global permissions. Do not automatically remove global grants, replace roles, or migrate user assignments when introducing or editing module controls.

**Why:** The user needs module-level Audit access analogous to QA/QC role controls. Automatically narrowing established roles would change existing users' access and unrelated workflows.

**How to apply:** Clearly tell administrators to remove broad global grants when they intend a module-limited role. A module view grant covers only its authorizing assignments' projects. Action grants and Audit workflow markers do not imply view access. Preserve existing application-administrator behavior within assignment scope, not organization-wide by role name.

Keep Schedule editing separate from organization-wide Programme creation, and require the existing positive Approval Level for module-specific Schedule approval.

**Why:** Module controls must not undo the previously agreed Programme-creation and sequential-approval boundaries.

**How to apply:** Treat module-specific Schedule approval as an approval grant for level validation and approval-stage role selection, but never interpret Schedule create/edit as the dedicated Programme-create capability.