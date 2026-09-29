---
name: Audit document replacement safety
description: Tradeoffs for replacing attached audit charts while protecting shared evidence and concurrent document edits.
---

When replacing an Organization Chart, remove the old file from the chart section, but retain the evidence file if a checklist or meeting still cites it. Removing a Good Practices row unlinks its attachment from that row but leaves the uploaded file accessible in Evidence files. A newly uploaded replacement must be confirmed and tied to the audit before the old chart can be unlinked. Changes to the audit's general metadata must merge with the latest document metadata while holding the same audit row lock used by document edits. For large audit attachments, send bytes directly from the browser to a short-lived App Storage signed URL; verify stored size and media type before confirming.

**Why:** Deleting a cited file breaks historical evidence links, and removing a row should not quietly delete the underlying evidence from the audit. A stale general-audit edit can silently overwrite recently saved document status rows. Replit's request-body limit can return a 502 before the API receives a large upload, leaving no backend request log.

**How to apply:** Any future audit attachment replacement, row removal, or generic audit metadata update should preserve other consumers of evidence IDs and coordinate writes to shared metadata. For large file uploads, issue a narrowly scoped URL through the authenticated API, upload directly to storage, and verify before linking the file.