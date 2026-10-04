---
name: Shared application approval recovery
description: Why approval queues cannot rely solely on the shared application-access status.
---

An active shared application-access record does not mean every application has been approved. Missing application requests must be recoverable from active role assignments and the application's own access flag.

**Why:** A production account can already have Lessons and Audit access while QA/QC remains unapproved. Looking only for shared records marked pending hides that account after a successful QA/QC role assignment. Changing shared status merely to surface the request can also confuse another application's approval queue.

**How to apply:** Surface recoverable requests without granting access or changing unrelated application flags. Persist an explicit approval or rejection only when an authorized administrator decides. Preserve rejection until a fresh role assignment renews the request, and retain project and organization authorization on both listing and decisions.

Shared legacy rejections are ambiguous: recover their originating application from
that application's decision log, never propagate them to all applications. A
known rejection's timestamp must remain independent of unrelated app changes.

**Why:** One shared row can contain approvals and pending or rejected requests for
different applications; another application's write changes shared timestamps
without renewing the rejected application's request.

**How to apply:** Keep each application's review outcome and time separate.
Use legacy log evidence where available; where attribution is absent, require
an administrator review of an unapproved role holder rather than granting access
or inventing three rejections.

An Audit legacy request event must not erase a previous rejection timestamp.

**Why:** Legacy request events do not record project scope; an outside-project
assignment can emit one even when the reviewing administrator's own manageable
assignments remain older than the rejection.

**How to apply:** Preserve the last actual legacy decision independently of request
events, then authorize renewal using fresh assignments inside the reviewer's scope.

Do not impose one application's assignment project on a new shared access record.

**Why:** The same user can have application roles in different projects; inheriting
the first application's project hides other applications' requests from their own
authorized project administrators.

**How to apply:** Authorize synthesized requests against each application's roles
and leave new shared records unscoped. Preserve explicit legacy record boundaries.
