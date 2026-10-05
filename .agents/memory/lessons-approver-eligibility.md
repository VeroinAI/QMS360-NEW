---
name: Lessons approver eligibility
description: Explicit role authorization is required for Lessons approver selection, without administrator exemptions.
---

Only users with an explicit Lessons **Approve / reject** grant through an active assigned role may appear in the Approver dropdown. This includes Super Admin, Org Admin and workspace administrators; role names and administrator status alone do not qualify.

**Why:** The user explicitly required the New Lesson Learned approver list to reflect the role permission matrix, including administrators, without changing unrelated development.

**How to apply:** Enforce the same eligibility when accepting approver assignments at the API, preserve existing scope and self-approval restrictions, and never reinsert an ineligible saved approver as a dropdown fallback. Keep this assignment rule separate from global administrator authorization behavior.
