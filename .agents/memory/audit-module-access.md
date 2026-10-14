---
name: Audit module access
description: Compatibility and scope policy when administering module-specific Audit role grants.
---

Audit module grants are additive to existing global permissions. Do not automatically remove global grants, replace roles, or migrate user assignments when introducing or editing module controls.

**Why:** The user needs module-level Audit access analogous to QA/QC role controls. Automatically narrowing established roles would change existing users' access and unrelated workflows.

**How to apply:** Clearly tell administrators to remove broad global grants when they intend a module-limited role. A module view grant covers only its authorizing assignments' projects. Action grants and Audit workflow markers do not imply view access. Preserve existing application-administrator behavior within assignment scope, not organization-wide by role name.

The explicit “Schedules / Programme → Create / edit” module grant now authorizes top-level Programme creation only when its role assignment is organization-wide. The older generic `data_entry` grant remains child-Schedule-only. Keep the dedicated Programme-create capability supported, and require the existing positive Approval Level for module-specific Schedule approval.

**Why:** The user subsequently requested that each module's Create grant permit creation in that module; the current Schedule list's New Schedule action creates a Programme. A project-restricted assignment still cannot create an organization-level parent outside its scope.

**How to apply:** Preserve the distinction between explicit module grants and legacy generic data entry. Plan editors may fetch scoped source Schedules and Programmes for selection without gaining general Schedule actions. Record-level ownership, assigned approval stages, CAR Action Taker/Lead boundaries and field access remain additional checks.