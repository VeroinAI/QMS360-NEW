---
name: Daily report uniqueness
description: One Daily Submission report per project and calendar date across every workflow status.
---

Allow only one active Daily Submission report per project and date, regardless of its creator or workflow status, including Draft.

**Why:** The user explicitly requested an error upon selecting an existing project/date and validation again at Save Draft, even when the existing report is in a different status.

**How to apply:** Selection-time feedback is advisory; always recheck inside the save transaction under the project lock shared with historical opening loads. Preserve the unique-index safeguard for concurrent saves. Existence checks may disclose status, not another user's report contents. Allow normal edits to the existing report and retain existing soft-deletion semantics. Monthly reports retain their independent project/month uniqueness rule.
