---
name: Product / Process Owner marker
description: Security boundary for the Audit-only Product / Process Owner authorization.
---

Treat Product / Process Owner as an Audit-only role authorization marker until the user specifies its functionality. It does not confer create, view, edit, submit, approval, or any other existing Audit capability on its own.

**Why:** The user explicitly requested the authorization object now and said its functionality will be added later. Giving it implied powers would change access before the intended workflow is defined.

**How to apply:** Future Audit flows may explicitly check this marker on an active assigned Audit role, alongside normal application access and scope. Do not infer it from a role's name or use it as a substitute for existing permissions.