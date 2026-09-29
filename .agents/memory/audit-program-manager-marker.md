---
name: Audit Program Manager marker
description: Intent and security boundary for the Audit Program Manager authorization.
---

Treat Audit Program Manager as an Audit-only role authorization marker, not a grant of any current Audit operation.

**Why:** The user requested the authorization object in Role and Permission now, with its functionality to be specified later. Inferring powers from its name would change access before that behavior is defined.

**How to apply:** Future Audit workflows can explicitly check the marker on assigned roles alongside their other access requirements. Do not infer it from a role's display name or let it satisfy existing permission checks.