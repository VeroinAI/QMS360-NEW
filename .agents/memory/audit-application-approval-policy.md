---
name: Audit application approval policy
description: User-confirmed distinction between Audit role assignment and permission to open QMS Audit.
---

Assigning a QMS Audit role must not automatically unlock the Audit application. An administrator must separately approve application access, including for people whose Audit role was assigned before an access request existed.

**Why:** The user explicitly chose separate approval when asked whether assigning an Audit role should automatically unlock the application.

**How to apply:** Keep role/project scope and application access as independent gates. Make missing access requests visible to administrators and let them approve or reject without silently granting access during role assignment.