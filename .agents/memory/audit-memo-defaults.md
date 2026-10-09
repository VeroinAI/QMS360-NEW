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
