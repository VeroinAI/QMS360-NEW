---
name: RBAC setup for testing non-admin writes
description: Seeded workspace roles start with zero permission grants, so non-admin writes 403 until permissions are granted
---

Seeded workspace roles (e.g. QAQC Representative, Form Creator) start with ZERO permission grants — non-admin writes fail RBAC with 403 even though the user visibly holds the role. Also, not every login listed in `scripts/src/seed.ts` necessarily exists in a given environment's database, and existing accounts may no longer use the seed password.

**Why:** verifying non-admin behavior (permissions, field access) needs a deliberately granted non-admin account; assuming seeded roles just work produces misleading 403s.

**How to apply:** grant the needed permission to a non-admin role before testing non-admin writes, and remove the grant afterward. Never record credentials in memory — take demo logins from the seed script or ask the user.

Approval-flow verification must include a non-admin reviewer with explicitly configured viewing and approval permissions, not only platform admins.

**Why:** Admin-only lesson tests passed while production reviewers were blocked by permission-key mismatches and empty role grants. A designated approver and a permissioned reviewer are not necessarily the same thing.

**How to apply:** Test both a correctly permissioned assignee and an assignee missing the approval capability; assignment must not silently grant new privileges.

Do not rerun seeds, reset passwords or alter authentication merely to enable a feature test.

**Why:** Retained development accounts can have legitimately changed passwords; failed demo login is not evidence that the feature or authentication configuration is broken.

**How to apply:** Verify the configured authentication mode and use isolated development test sessions without changing real accounts. Do not expose or retain session credentials in project files, memory or test reports.

Do not assume the browser tester can reach a loopback-only helper started by
the shell. Failure to transfer a signed test session is a test-harness
limitation, not evidence of an application login bug.

**Why:** A browser test was blocked by loopback token-transfer failures, while
authenticated API requests from the same shell process worked normally.

**How to apply:** Keep test credentials in memory and preserve production
authentication boundaries. Do not add a public token bridge or change login
configuration merely to enable a test; verify API guards independently and
report any unverified signed-in UI behavior plainly.
