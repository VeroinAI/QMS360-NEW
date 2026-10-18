---
name: Audit approval email audience
description: Privacy and recipient rules for Audit Schedule approval messages and final PDF.
---

Approval-request emails go to active members of the current approval role. Each successful intermediate approval sends the memo to the next active approval role. By default, the final approval PDF goes to the submitting user and the people who actually approved, not every member of each approval role. The exception is an enabled parent Audit Schedule final-approval Email Rule selecting workspace roles: its selected active role members replace that default audience (deduplicated), rather than being added to it. A final rule using another recipient mode retains the default audience.

When a parent Audit Schedule (programme) or child Audit is sent back, the default audience is its creator plus CC people who approved during the current submission and the reviewer sending it back. Never automatically include other eligible role members or approvers from earlier submissions. A matching rule controls enablement. The subsequently requested explicit CC-role configuration is the exception: selected active role members are added to CC, including for send-back emails. Do not also dispatch a generic email rule for the same send-back event.

**Why:** Approval requests and review comments should reach only participants in that specific submission. The final parent Schedule notification is explicitly configurable by the administrator to reach selected role audiences; it does not contain send-back review comments.

**How to apply:** Keep default To recipients tied to the saved approval chain and actual actions. The To-role override remains limited to enabled parent final approval. Explicitly configured CC roles are additive for every matching event; show administrators that review comments also reach these CC users. If no CC roles are configured, retain the previous participant-only behavior.

**Why for the CC exception:** The user explicitly requested application-role CC selection in Email Rule editing and delivery when the event is triggered. This is an administrator-configured audience grant, not automatic expansion to all eligible reviewers.