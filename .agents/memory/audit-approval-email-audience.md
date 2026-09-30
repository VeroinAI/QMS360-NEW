---
name: Audit approval email audience
description: Privacy and recipient rules for Audit Schedule approval messages and final PDF.
---

Approval-request emails go to active members of the current approval role. Each successful intermediate approval sends the memo to the next active approval role. By default, the final approval PDF goes to the submitting user and the people who actually approved, not every member of each approval role. The exception is an enabled parent Audit Schedule final-approval Email Rule selecting workspace roles: its selected active role members replace that default audience (deduplicated), rather than being added to it. A final rule using another recipient mode retains the default audience.

When a parent Audit Schedule (programme) or child Audit is sent back, send to its creator and CC only people who approved during the current submission plus the reviewer sending it back. Never include other eligible role members or approvers from earlier submissions. A matching email rule controls enablement but cannot widen this send-back audience. Do not also dispatch a generic email rule for the same send-back event, which could duplicate the message or reach unrelated people.

**Why:** Approval requests and review comments should reach only participants in that specific submission. The final parent Schedule notification is explicitly configurable by the administrator to reach selected role audiences; it does not contain send-back review comments.

**How to apply:** Keep submit, intermediate approval, child final approval, and send-back recipients tied to the saved approval-chain state and actual actions. Apply selected workspace roles only to the enabled parent final-approval event; if no matching rule exists, use participant defaults. Email rules may enable or explicitly suppress workflow messages.