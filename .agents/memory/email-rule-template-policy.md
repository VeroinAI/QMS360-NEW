---
name: Email Rule template policy
description: Per-rule content customization and approval-recipient boundaries
---
Email Rule create/edit must allow administrators to save a subject and plain-text body template separately for each rule. Use the supplied Audit email document as editable examples, not automatic replacement of existing rules.

**Why:** The user asked for per-rule email body details using their Audit email examples; they did not request changes to workflow recipients or approval sequencing.

**How to apply:** Blank template fields retain default content. Personalize supported placeholders from the event and recipient; explicitly mark unavailable values. Preserve the existing SMTP From, queue/retry behavior and workflow attachments.

Protected Audit approval emails must use the workflow queue only, not a second generic rule dispatch.

**Why:** Once templates can contain review comments, a duplicate generic dispatch could expose content outside the saved approval audience or bypass a disabled matching workflow rule.

**How to apply:** Apply content templates inside the existing participant-scoped approval queue. Do not copy the example document's To/CC lists into new recipient rules.