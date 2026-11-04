---
name: Master Data role assignments
description: User-confirmed informational semantics of single or multiple roles assigned to Master Data values.
---

Master Data role assignments must not restrict dropdown visibility or selection or grant permissions.

**Why:** The user explicitly chose “Save role assignments only” rather than role-based visibility and selection restrictions.

**How to apply:** Preserve assigned roles when values are saved and edited, alongside other value configuration. Do not turn these references into access rules.

## Project Additional Data role labels

Project Manager, Document Controller and Project Engineer are single-role
selections using unique active role names across all three applications.
Retain existing free-text values for display and unchanged saves.

**Why:** The user requested role dropdowns rather than user selectors. Additional
Data historically stores display text consumed by reports; changing those values
to role UUIDs would break that contract.

**How to apply:** Treat these selections as descriptive project information,
not permission grants, role assignments to users, or automatic email routing.
Do not silently replace saved legacy text when application roles change.

## Audit activity defaults

The user subsequently explicitly requested Audit activity roles to default from the Activities master, with auditees defaulting from schedule-local role-to-user assignments. Both selections remain editable.

**Why:** This is a deliberate extension of the earlier “save only” choice, limited to Audit Plan point 15; it is not authorization to change role grants or dropdown visibility.

**How to apply:** Use Audit role references as editable activity defaults. Schedule assignments do not assign organization roles to their users. Preserve saved Plan overrides on reload and background changes; allow explicit reapplication of current master or schedule defaults.

Individual Audit creation, edit and read-only forms must not expose schedule
activity role/auditee assignments. Existing assignments remain historical Plan
defaults; this is a form simplification, not a data or API removal.

**Why:** The user explicitly removed section 13 while requiring Audit Plan
activities and historical assignment data to remain unchanged.

**How to apply:** Omit the hidden field on unrelated saves, preserve stored
defaults without eligibility lookups, and retain validation and authorization
for explicitly supplied assignment changes. Do not let old mandatory-field
settings require an omitted field the form can no longer edit.

## Activities application ownership

The Activities master previously mapped to QA/QC belongs to QMS Audit. Move
the existing group, rather than duplicating or renaming its values. Leave
unrelated masters and intentionally global groups unchanged.

**Why:** On 2026-10-12 the user reported that the QA/QC mapping made the
Activities editor offer QA/QC roles instead of QMS Audit roles.

**How to apply:** Keep group IDs, keys, labels, remarks and existing plan
references. Preserve old QA/QC assignments for explicit administrator
replacement; do not guess equivalent Audit roles or alter permission grants.