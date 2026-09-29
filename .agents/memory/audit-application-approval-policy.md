---
name: Audit application approval policy
description: User-confirmed distinction between Audit role assignment and permission to open QMS Audit.
---

Assigning a QMS Audit role must not automatically unlock the Audit application. An administrator must separately approve application access, including for people whose Audit role was assigned before an access request existed. Assigning a role again after an Audit access rejection constitutes a fresh request for approval; the old rejection must not hide the new request.

**Why:** The user explicitly chose separate approval when asked whether assigning an Audit role should automatically unlock the application, and later clarified that assigning any Audit workspace role to an unapproved user should place them in the access request queue.

**How to apply:** Keep role/project scope and application access as independent gates. Make missing or renewed access requests visible to administrators and let them approve or reject without silently granting access during role assignment.