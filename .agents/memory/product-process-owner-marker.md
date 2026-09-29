---
name: Product / Process Owner marker
description: Security boundary for the Audit-only Product / Process Owner authorization.
---

Product / Process Owner is an Audit-only role authorization that makes active users with Audit application access eligible to be selected as a Schedule's Process / Product Owner. The selected user's name is saved on the schedule and appears in Schedule spreadsheet downloads. The marker does not confer create, view, edit, submit, approval, or any other Audit capability on its own.

**Why:** The user initially requested the authorization object without functionality, then specified its use for the owner field in Create Audit and Schedule spreadsheet downloads. Giving it broader implied powers would change access beyond that request.

**How to apply:** Build owner options from active Audit role assignments with this marker and active Audit application access. Do not infer ownership eligibility from master-data LOVs or role names. Keep the marker distinct from create, select, and other existing permissions. Preserve historical owner names when a user's eligibility later changes, but require new selections to be currently eligible.