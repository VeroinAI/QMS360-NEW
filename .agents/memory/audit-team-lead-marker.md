---
name: Audit Team Lead marker
description: Intent and security boundary for the Audit Team Lead role authorization.
---

Treat Audit Team Lead as a role-level authorization marker for explicitly defined QMS Audit features, not as a general-purpose permission to create, review, approve, or view Audit records.

**Why:** The user requested a way to identify the Audit Team Lead role now, for functionality to be specified later. Adding implicit powers before that functionality is defined would change access unexpectedly.

**How to apply:** Future features may explicitly check this authorization on an active assigned Audit role, alongside their normal application access and scope requirements. Do not infer the marker from the role's display name or make it grant existing capabilities.

Only legacy CAR responses already submitted without a configured approval route use the linked Audit Plan's Lead / Internal Auditor and active Audit Team Lead authorization. New submissions and resubmissions use explicit CAR approval roles; see [CAR approval policy](car-approval-policy.md). Do not automatically add CAR approval grants to Team Lead roles.

**Why:** The original single-reviewer workflow must finish without rewriting in-flight decisions, but the user subsequently requested independently configured CAR Approval Levels for all new submissions.

**How to apply:** For legacy pending reviews, assignment and active authorization must both hold. For routed reviews use explicit CAR grants instead. Administrator access alone does not substitute for the assigned reviewer, and the marker alone must not unlock unrelated actions.

New Audit programmes capture the selected Team Lead user IDs at creation. Child Audit Plans choose their Lead / Internal Auditor from that parent selection, not from everyone who currently holds the role. Existing programmes without a saved selection remain unrestricted for compatibility.

**Why:** A user's assignment may change after schedule creation, but the Plan must honor the leads selected for that schedule; older programmes have no historical selection to enforce.

**How to apply:** Resolve new selection options from active role assignments and Audit application access, then enforce the saved parent IDs when creating or updating a Plan. Do not silently substitute the current role membership for the saved selection.

When displaying an existing programme's selected leads, resolve names from its saved user IDs rather than from the currently eligible Audit Team Lead list. Include former/inactive users' names when their user records remain available, and identify missing records explicitly.

**Why:** Eligibility can change after a programme is created; a current-role lookup would make historical schedule details silently lose names even though the selected IDs are still stored.

**How to apply:** Keep creation-time eligibility checks separate from read-only display of the saved selection.