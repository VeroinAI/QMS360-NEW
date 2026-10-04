---
name: Shared application approval recovery
description: Why approval queues cannot rely solely on the shared application-access status.
---

An active shared application-access record does not mean every application has been approved. Missing application requests must be recoverable from active role assignments and the application's own access flag.

**Why:** A production account can already have Lessons and Audit access while QA/QC remains unapproved. Looking only for shared records marked pending hides that account after a successful QA/QC role assignment. Changing shared status merely to surface the request can also confuse another application's approval queue.

**How to apply:** Surface recoverable requests without granting access or changing unrelated application flags. Persist an explicit approval or rejection only when an authorized administrator decides. Preserve rejection until a fresh role assignment renews the request, and retain project and organization authorization on both listing and decisions.