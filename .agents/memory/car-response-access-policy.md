---
name: CAR response access
description: Permission and display boundaries for the CAR Register response popup.
---

The CAR Register's Audit Schedule link opens the same response workflow as Edit for eligible users, but remains usable as a read-only view for other users and non-editable statuses. Show the register's descriptive data in the popup without making it maintainable there. Only Root Cause, Correction and Corrective Action may be editable, subject to existing assignment, lifecycle and field-access checks.

**Why:** The user requested a convenient entry point to respond to a finding, not broader permission to alter its schedule, finding, assignment or other register data.

**How to apply:** Preserve the existing response-save and authorization paths. Read-only opening, including an unstarted response, must not create a CAR, issue a number or open an edit session.
