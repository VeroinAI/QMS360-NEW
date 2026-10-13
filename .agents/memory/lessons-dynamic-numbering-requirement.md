---
name: Lessons dynamic numbering requirement
description: User requirement for selectable project and master-data fields in reference-number prefixes.
---

Lessons Learned reference-number prefixes should support administrator-selected project and master-data fields, initially Project Cost Center and the selected Discipline master Value. The user wants to change the selected fields through configuration rather than requesting code changes each time.

**Why:** Business numbering requirements vary; a fixed text prefix cannot express the requested project and discipline values.

**How to apply:** The user approved an Insert field picker with a master-record preview, initially for those two fields. Resolve fields against the project and discipline selected on the individual Lesson, not an arbitrary master-data row.

Changing a prefix or its master values must not renumber existing Lessons. Lessons Learned counters are now independent per project, shared across that project's disciplines. Discipline numbering uses the selected master Value, not its display label or an internal discipline identifier.

**Why:** The user subsequently explicitly requested project-specific numbering, manual go-live starts and a default start of 1 for projects without a maintained range, replacing the earlier organization-wide sequence.

**How to apply:** Administrators maintain each project's next number in Lessons Settings → Numbering. Default to 1, ignore the old organization-wide Lessons counter, preserve project counters through shared-pattern changes/resets, and never reuse reserved numbers or modify existing references. Scope uniqueness by organization and project. Historical same-project reference collisions must be skipped. Preview must not allocate a number; missing required master values block issuance before incrementing. QA/QC and Audit numbering retain their existing scope.

Project Master must include authorized local projects as well as Drona projects. QMS360-owned Cost Center is maintained in each project's Additional Data popup, alongside Client, Contractor, Contract / project no., Contract signed, Contract period, TCC, PAC and FAC. Source-owned project fields remain read-only.

**Why:** The user approved including local projects because legitimate Lessons projects otherwise had no place to maintain the Cost Center needed for numbering, and subsequently requested the per-project Additional Data popup with these eight supplementary fields.

**How to apply:** Drona link metadata is optional display context, not a prerequisite for listing projects or editing additional data. Preserve tenant boundaries, administrator permissions, existing project-access restrictions and issued Lesson numbers.
