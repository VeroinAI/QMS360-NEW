---
name: Audit Plan auditee roles
description: Keeps Auditee and Circulation role selections independent from user-based Audit Plan participants.
---

Audit Plan field 5, Auditee, is a required multi-select of active Audit workspace roles. Lead / Internal Auditor, Audit Team, and each Activity Auditee remain user-based fields.

**Why:** The plan identifies responsible auditee roles, while individual activities still need named users. Reusing one person for both concepts produced the wrong plan-level meaning and coupled unrelated fields.

**How to apply:** Persist canonical Auditee role IDs with the plan, resolve role users on the server where notifications or ownership need users, and keep activity auditee selections independent. Preserve legacy scalar auditee data only for compatibility with existing records and integrations.

## Circulation

Audit Plan Circulation is an independently selected set of Audit workspace roles during creation and editing. Changing auditors, team members or Auditees must not silently rewrite these selections.

**Why:** The user requested an editable, multi-role Circulation field rather than circulation generated from participants, while preserving other ongoing development and existing workflows.

**How to apply:** Preserve older circulation text until a user explicitly selects roles. Keep older API callers compatible and avoid discarding saved selections when they omit the newer field. Role selection alone must not send emails or change approval or notification audiences.