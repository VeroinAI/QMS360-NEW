---
name: Lessons dynamic numbering requirement
description: User requirement for selectable project and master-data fields in reference-number prefixes.
---

Lessons Learned reference-number prefixes should support administrator-selected project and master-data fields, initially Project Cost Center and the selected Discipline master Value. The user wants to change the selected fields through configuration rather than requesting code changes each time.

**Why:** Business numbering requirements vary; a fixed text prefix cannot express the requested project and discipline values.

**How to apply:** The user approved an Insert field picker with a master-record preview, initially for those two fields. Resolve fields against the project and discipline selected on the individual Lesson, not an arbitrary master-data row.

Changing a prefix or its master values must not renumber existing Lessons. Keep the existing shared Lessons counter across projects and disciplines; do not introduce per-project counters implicitly. Discipline numbering uses the selected master Value, not its display label or an internal discipline identifier.

**Why:** The user approved the proposed solution with existing-reference preservation, continuous numbering and explicit errors for missing required source values.

**How to apply:** Preview must not allocate a number. Missing required master values must block issuance instead of silently dropping a segment. A change to the counter scope or existing-reference policy needs a separate user decision.

Project Master must include authorized local projects as well as Drona projects. QMS360-owned Cost Center is maintained in each project's Additional Data popup, alongside Client, Contractor, Contract / project no., Contract signed, Contract period, TCC, PAC and FAC. Source-owned project fields remain read-only.

**Why:** The user approved including local projects because legitimate Lessons projects otherwise had no place to maintain the Cost Center needed for numbering, and subsequently requested the per-project Additional Data popup with these eight supplementary fields.

**How to apply:** Drona link metadata is optional display context, not a prerequisite for listing projects or editing additional data. Preserve tenant boundaries, administrator permissions, existing project-access restrictions and issued Lesson numbers.
