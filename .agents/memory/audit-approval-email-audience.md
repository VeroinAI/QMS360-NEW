---
name: Audit approval email audience
description: Privacy and recipient rules for Audit Schedule approval messages and final PDF.
---

Approval-request emails go to active members of the current approval role. Each successful intermediate approval sends the memo to the next active approval role. The final approval PDF goes to the submitting user and the people who actually approved, not every member of each approval role.

**Why:** The final PDF contains the submitted memo and schedule details. Role eligibility alone should not broaden the audience beyond workflow participants.

**How to apply:** Keep recipients tied to the saved approval-chain state and actual actions, not configurable arbitrary recipient modes. Email rules may enable or explicitly suppress these workflow messages; absence of a matching rule permits delivery.