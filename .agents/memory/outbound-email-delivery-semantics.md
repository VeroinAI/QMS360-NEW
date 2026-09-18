---
name: Outbound email delivery semantics
description: Durable behavioral rules for QMS360 event email delivery, retries, and monitoring.
---

Application-event emails must be persisted as one queue row per resolved recipient before SMTP delivery. Status, attempts, retry timing, and errors are tracked per recipient. Connector test emails remain a synchronous direct-send diagnostic path.

When a workflow needs a user-visible sender, persist that sender on the queue row and preserve it across every retry. Keep the connector address as the SMTP envelope sender; use the workflow sender only for the message From and Reply-To headers.

For CC delivery, the SMTP envelope must include CC addresses in addition to the MIME CC header. A fulfilled SMTP call may still report rejected addresses; persist those addresses and retry only their envelope delivery so accepted recipients are not sent duplicate copies.

**Why:** SMTP failures must never roll back application workflows, while Super Admins still need an accurate recipient-level delivery trail and reliable automatic retries.

**How to apply:** New production notification paths enqueue resolved recipients and include application/event context. Use the tenant-wide organization policy for retention, retry count, and retry delay. Keep queue reads, claims, retries, and cleanup tenant-scoped. Make state transitions that trigger email atomic so concurrent requests cannot enqueue duplicates.