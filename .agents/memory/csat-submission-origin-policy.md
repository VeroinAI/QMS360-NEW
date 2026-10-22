---
name: CSAT submission origin
description: Current final-submission policy for CSAT and the scope of customer-origin discussion.
---

Customers may submit their own satisfaction surveys, or internal employees may submit on customers' behalf. The current requested CSAT workflow is final submission for either source: “Submit” opens a Yes/No confirmation; Yes submits and locks the survey, while No actually saves the answers as a draft. No approver selection or send-back is permitted for submitted CSAT surveys.

**Why:** After discussing separate customer/employee approval routes, the user explicitly requested replacing “Submit for approval” with final “Submit” and a Yes/No draft-saving confirmation.

**How to apply:** Enforce the final lock on the API as well as the form, and exclude submitted surveys from approval action queues. Preserve existing approved history without bulk status rewriting. Do not implement customer invitation links or a separate employee approval route based only on the earlier suggestions; they were not approved development requirements.
