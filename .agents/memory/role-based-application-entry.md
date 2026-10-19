---
name: Role-based application entry
description: User-requested removal of separate application approvals across all three QMS modules.
---

Lessons Learned, QA/QC & Document Governance, and Audit must grant application
entry directly from active module role assignments. There is no additional
administrator approval step or Access request queue.

**Why:** On 2026-10-19 the user explicitly replaced the earlier separate-approval
policy because assigning a role and approving the same person's access doubled
administrator work. This supersedes previous Audit approval and shared approval
recovery decisions.

**How to apply:** Existing role holders must not remain blocked by historical
pending/rejected application reviews. Preserve organization/project boundaries,
active-user and active-role checks, operation-level RBAC and Drona project limits.
Report/document submission approval is a different workflow and must remain
unchanged. Removing the final active role must remove ordinary users' module
access; historical approval flags alone must not grant entry. Keep platform
administrator behavior. Retain legacy application access history rather than
deleting it or rewriting all old approvals.
