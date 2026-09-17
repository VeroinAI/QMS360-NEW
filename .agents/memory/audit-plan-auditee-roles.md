---
name: Audit Plan auditee roles
description: Distinguishes plan-level Auditee roles from the user-based Audit Plan participant fields.
---

Audit Plan field 5, Auditee, is a required multi-select of active Audit workspace roles. Lead / Internal Auditor, Audit Team, and each Activity Auditee remain user-based fields.

**Why:** The plan identifies responsible auditee roles, while individual activities still need named users. Reusing one person for both concepts produced the wrong plan-level meaning and coupled unrelated fields.

**How to apply:** Persist canonical Auditee role IDs with the plan, resolve role users on the server where notifications or ownership need users, and keep activity auditee selections independent. Preserve legacy scalar auditee data only for compatibility with existing records and integrations.