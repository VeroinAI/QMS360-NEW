---
name: Reference PowerPoint import destination
description: Prevent app-report reference imports from replacing the unrelated Architecture slide deck.
---

The PowerPoint import callback can target an existing registered slides artifact
and replace its slide manifest; it is not a reference-only extraction operation.

**Why:** Importing an Audit report supplied as a mapping reference targeted the
unrelated Architecture presentation. Its original deck had to be preserved.

**How to apply:** Inspect app-report reference files through their OOXML contents.
For actual editable-slide imports, establish the intended isolated destination
before importing, and verify that unrelated registered presentations are intact.
