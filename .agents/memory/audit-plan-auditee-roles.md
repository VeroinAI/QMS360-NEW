---
name: Audit Plan auditee roles
description: Keeps Auditee and Circulation role selections independent from user-based Audit Plan participants.
---

Audit Plan field 5, Auditee, is a required multi-select of active Audit workspace roles. Lead / Internal Auditor, Audit Team, and each Activity Auditee remain user-based fields.

**Why:** The plan identifies responsible auditee roles, while individual activities still need named users. Reusing one person for both concepts produced the wrong plan-level meaning and coupled unrelated fields.

**How to apply:** Persist canonical Auditee role IDs with the plan, resolve role users on the server where notifications or ownership need users, and keep activity auditee selections independent. Preserve legacy scalar auditee data only for compatibility with existing records and integrations.

## Lead and Audit Team separation

The selected Lead / Internal Auditor must not appear in the Audit Team dropdown.
Selecting an existing team member as lead removes that person from the team.
Changing lead does not automatically restore a previously removed team member.

**Why:** The user explicitly requires these participant selections to be mutually
exclusive, regardless of which field is selected first.

**How to apply:** Compare user IDs, not display names. Keep removal and lead selection
atomic, preserve other team members, and retain the required-team validation if the
removal leaves no team members. Do not modify historical read-only records.

## Activity-level role-only selections

Create Audit Plan no longer displays the individual “Auditees for the Activity”
column. A selected active Audit role satisfies activity auditee validation even
when that schedule has no users mapped to the role.

**Why:** Retaining the old required-user validation blocked creation despite
visible role selections and offered no way to fill the hidden required field.

**How to apply:** Keep form and API validation consistent. Retain schedule-derived
users when available and legacy/manual auditee selections on existing plans.
Do not insert an empty user ID into participant eligibility checks, assign users
to roles, or alter schedule mappings merely to make a plan save.

## Circulation selection policy

Audit Plan Circulation is an independently selected set of Audit workspace roles during creation and editing. Changing auditors, team members or Auditees must not silently rewrite these selections.

**Why:** The user requested an editable, multi-role Circulation field rather than circulation generated from participants, while preserving other ongoing development and existing workflows.

**How to apply:** Preserve older circulation text until a user explicitly selects roles. Keep older API callers compatible and avoid discarding saved selections when they omit the newer field. Role selection alone must not send emails or change approval or notification audiences.