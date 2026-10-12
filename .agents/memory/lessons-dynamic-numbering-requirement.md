---
name: Lessons dynamic numbering requirement
description: User requirement for selectable project and master-data fields in reference-number prefixes.
---

Lessons Learned reference-number prefixes should support administrator-selected project and master-data fields, initially Project Cost Center and the selected Discipline master Value. The user wants to change the selected fields through configuration rather than requesting code changes each time.

**Why:** Business numbering requirements vary; a fixed text prefix cannot express the requested project and discipline values.

**How to apply:** Treat this as a requested capability, not an implemented feature or an approved detailed design. Resolve fields against the project and discipline selected on the individual Lesson, not an arbitrary master-data row.
