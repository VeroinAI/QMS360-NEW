---
name: Drona administrator user discovery scope
description: Customer scope for adding existing Drona QMS users before their first module launch.
---

Keep the requested Add User functionality limited to administrator email search,
retrieval of existing Drona users already assigned to QMS360, and use of existing
QMS360 role-assignment controls before the user's first module launch.

**Why:** The user explicitly corrected discussion of a broader "workflow":
"we only have to implement whatever has asked." Automatic synchronization,
additional approval processes and source-account creation were not requested.

**How to apply:** Reuse current identity links and role controls. Treat existing
application approvals as preserved constraints, not a new process. Assess existing
backend read permissions before requesting any DBA action; do not request DBA
credentials or promise schema changes are unnecessary without checking the target.

Discovery must distinguish an active Drona identity/project membership from the
customer's narrower requirement that a user is already assigned QMS360.

**Why:** Existing login/project-access policy deliberately ignores unconfirmed
module metadata; that does not prove a user is QMS-assigned for this new import.
The actual QMS module identifier is deployment-owned, not established by the
reviewed schema.

**How to apply:** Require an operator-confirmed entitlement mapping and fail
closed if unavailable. Keep discovery's entitlement check separate from the
settled login/project-membership rules; do not guess module names, broaden
discovery to all active users, or silently introduce module gates into login.
