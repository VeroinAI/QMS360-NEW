---
name: QA/QC calculation tile visibility
description: User-facing Daily and CSAT forms must not show the technical Server calculation tile.
---

Do not display the “Server calculation” tile on Daily Submission or CSAT forms, in create, edit or display modes. Keep the calculations and validation working.

**Why:** The user repeatedly requested its removal from Daily Submission; the follow-up screenshot identified the remaining tile on the shared CSAT form.

**How to apply:** Preserve this display rule when changing shared reporting editors. Do not remove underlying computed values, validation or exported report content as part of hiding the tile.
