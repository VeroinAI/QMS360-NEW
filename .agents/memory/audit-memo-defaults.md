---
name: Audit Schedule memo defaults
description: Reusable From/To heading policy for submit and resubmit, separate from historical approval content and email audiences
---

Organization administrators configure reusable free-text From and To memo headings
in Quality Audit Settings, not Integration Cockpit. Each newly opened Submit or Resubmit memo uses the latest
nonempty configured headings. An empty default falls back to a heading previously
saved on that schedule. From and To are read-only in both submission popups.

**Why:** The user asked for reusable text determined at submission and resubmission.
Always preferring the old record would prevent changed defaults taking effect on
resubmission; empty defaults should not erase a previously customized heading.

The memo shown to the user is captured with that submission. Do not replace saved
approval content with live configuration when reviewing or exporting historical
memos. Do not reinterpret From or To as SMTP sender identities or email recipients.

**Why:** The user explicitly moved this configuration into Quality Audit Settings
and required read-only headings in Submit and Resubmit. Configuration remains
editable by organization administrators, not by submitters inside the popup.
Approval email audiences follow the existing role and participant policy.

**How to apply:** Load current defaults when opening a new memo, keep the headings
read-only while that popup is open, and keep approval email delivery and saved memo snapshots
independent from subsequent configuration changes.

Editable Subject and Memo reuse the most recent saved submission on reopening;
unlike From/To, they do not take live organization defaults. New or legacy gaps
fall back independently to the schedule title and an empty memo. Cancelled edits
are not retained.

**Why:** Resubmission should let users amend the last submitted content rather than
retype it, without mixing unsaved drafts or another schedule's memo.

**How to apply:** Initialize editable content once per popup opening, separately
from asynchronous heading loading; only a successful submission replaces saved content.
