---
name: Audit approval email audience
description: Privacy and recipient rules for Audit Schedule approval messages and final PDF.
---

Approval-request emails go to active members of the current approval role. Each successful intermediate approval sends the memo to the next active approval role. The final approval PDF goes to the submitting user and the people who actually approved, not every member of each approval role.

When a child Audit Schedule is sent back, send to its creator and CC only people who approved during the current submission plus the reviewer sending it back. Never include other eligible role members or approvers from earlier submissions. A matching email rule controls enablement but cannot widen the participant audience.

**Why:** Approval messages and review comments should reach only participants in that specific submission, not people merely eligible to review.

**How to apply:** Keep recipients tied to the saved approval-chain state and actual actions, not configurable arbitrary recipient modes. Email rules may enable or explicitly suppress these workflow messages; absence of a matching rule permits delivery.