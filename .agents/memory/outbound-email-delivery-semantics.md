---
name: Outbound email delivery semantics
description: Durable behavioral rules for QMS360 event email delivery, retries, and monitoring.
---

Application-event emails must be persisted as one queued message per notification, with all resolved To recipients visible together and all selected CC recipients in CC. Do not split one notification into individually addressed emails. Connector test emails remain a synchronous direct-send diagnostic path.

**Why:** The user explicitly replaced the earlier per-recipient delivery requirement: administrators and recipients need one shared email with the selected To/CC audience across all QMS modules.

**How to apply:** Resolve and deduplicate the audience before enqueueing; To wins over CC for repeated addresses. Preserve the complete MIME audience for retries, restrict retry envelopes to failed addresses, and use the combined To names/emails for recipient-specific placeholders. Keep distinct workflow events and differently authorized audiences separate.

All QMS360 emails use the configured SMTP From Address for both the visible From header and SMTP envelope. A workflow-specific contact, if saved on a queue row, may be used only for Reply-To and must survive retries.

**Why:** The user requires a consistent organizational sender across all applications; allowing rule-specific visible From addresses made the SMTP setting unreliable.

**How to apply:** Route direct and queued email through the same SMTP delivery policy, including retries and connector test messages. Never use an actor/creator address for the visible From header.

For CC delivery, the SMTP envelope must include CC addresses in addition to the MIME CC header. A fulfilled SMTP call may still report rejected addresses; persist those addresses and retry only their envelope delivery so accepted recipients are not sent duplicate copies.

**Why:** SMTP failures must never roll back application workflows, while Super Admins still need an accurate message-level delivery trail and reliable automatic retries.

**How to apply:** New production notification paths enqueue resolved recipients and include application/event context. Use the tenant-wide organization policy for retention, retry count, and retry delay. Keep queue reads, claims, retries, and cleanup tenant-scoped. Make state transitions that trigger email atomic so concurrent requests cannot enqueue duplicates.