---
name: Lessons approver eligibility
description: Explicit role authorization is required for Lessons approver selection, without administrator exemptions.
---

Only users with an explicit Lessons **Approve / reject** grant through an active assigned role may appear in the Approver dropdown. This includes Super Admin, Org Admin and workspace administrators; role names and administrator status alone do not qualify.

**Why:** The user explicitly required the New Lesson Learned approver list to reflect the role permission matrix, including administrators, without changing unrelated development.

**How to apply:** Enforce the same eligibility when accepting approver assignments at the API, preserve existing scope and self-approval restrictions, and never reinsert an ineligible saved approver as a dropdown fallback. Keep this assignment rule separate from global administrator authorization behavior.

Display the saved assigned approver's identity independently of the selectable
approver list.

**Why:** The list excludes the logged-in user and can exclude a previously
assigned person whose eligibility changed. Neither should erase the recorded
assignment's display name or justify expanding selection permissions.

**How to apply:** Resolve the assigned name on authorized record responses.
Showing that name must not add the person to selectable options or confer review
rights; review authorization remains a separate server-side decision.
