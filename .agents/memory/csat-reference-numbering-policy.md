---
name: CSAT reference numbering scope
description: Requested CSAT format, date source, go-live counters and staged integration boundary.
---

CSAT Reference numbering is Prefix + Project + four-digit Year + Running number. The year must come from the CSAT form's Date, not the creation timestamp. Go-live maintenance accepts the last-used number, so the next running number is last-used plus one, using independent project/year ranges and no backwards movement.

**Why:** The user requested parity with Audit go-live counter maintenance but specifically limited this development to Number Range settings, with a separate prompt to link CSAT forms.

**How to apply:** Keep configuration separate from existing CSAT reference generation until the user explicitly requests integration. Do not renumber existing CSAT records or consume counters when saving or previewing settings. The settings use Project Master project code for the Project segment; confirm any different requested project identifier before changing that convention.
