---
name: Audit reporting terminology
description: Business meaning of Audit Schedule and Audit Title in the CAR Register.
---

In the CAR Register, “Audit Schedule” means the containing schedule/programme
name shown in the Audit Plan's Audit Schedule field. “Audit Title” means the
individual audit selected in that Plan's Audit Title field.

**Why:** The user explicitly supplied the Audit Plan as the reference for these
two separate report columns. Repeating the individual audit's title in both
columns is incorrect.

**How to apply:** Preserve this distinction in report values and their filters.
Do not substitute an execution's independently editable title for the selected
audit title when the selected audit is available. Correct read-only mapping
without changing record identities, stored data, or authorization.
