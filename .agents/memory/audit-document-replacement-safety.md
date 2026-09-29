---
name: Audit document replacement safety
description: Tradeoffs for replacing attached audit charts while protecting shared evidence and concurrent document edits.
---

When replacing an Organization Chart, remove the old file from the chart section, but retain the evidence file if a checklist or meeting still cites it. A newly uploaded replacement must be confirmed and tied to the audit before the old chart can be unlinked. Changes to the audit's general metadata must merge with the latest document metadata while holding the same audit row lock used by document edits.

**Why:** Deleting a cited file breaks historical evidence links, while a stale general-audit edit can silently overwrite recently saved document status rows.

**How to apply:** Any future audit attachment replacement or generic audit metadata update should preserve other consumers of evidence IDs and coordinate writes to shared metadata.