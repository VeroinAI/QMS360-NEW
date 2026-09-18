---
name: Lessons approval escalation digest
description: Durable business rules for scheduled Lessons Learned pending-approval escalation summaries.
---

Lessons escalation email is a scheduled summary report. Include only forms still in Submitted state, calculate age from the submission timestamp in the tenant's local working calendar, and apply the highest configured threshold reached.

**Why:** The business process requires consolidated pending-approval reporting. Creation age, draft/sent-back records, or one email per form produce incorrect escalation outcomes and excessive email.

**How to apply:** Group qualifying forms by the applicable escalation rule/level because each row can have different Target and CC roles. Target users receive the report in To; CC-role users receive real email CC only. Scheduling supports custom interval, daily, weekly, and monthly frequencies in the tenant timezone, with database-level occurrence idempotency and distributed serialization.