---
name: Audit attachment scopes
description: How the Audit Attachment tile separates old and new files from Checklist evidence.
---

New Checklist and standalone Attachment uploads should have distinct categories. When listing standalone attachments, also exclude IDs referenced by Checklist items: older Checklist uploads used broad MIME-based categories shared with files uploaded directly to the audit. Do not rely on category alone or old standalone attachments will disappear.

**Why:** The legacy evidence list mixed every audit file; filtering only by category cannot distinguish historical Checklist documents from standalone uploads.

**How to apply:** Preserve access to older standalone audit files while hiding Checklist-linked files in the Attachment tile; keep the unscoped evidence list available for Checklist and other document consumers.