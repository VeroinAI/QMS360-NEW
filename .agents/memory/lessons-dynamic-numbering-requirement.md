---
name: Lessons dynamic numbering requirement
description: User requirement for selectable project and master-data fields in reference-number prefixes.
---

Lessons Learned reference-number prefixes support administrator-selected project and master-data fields. Project and Department Lessons have separate configurable patterns, selected from the Lesson's source type, with independent counters for each project and department.

**Why:** Business numbering requirements vary. The user explicitly requested separate Project / Department prefix maintenance and department go-live next numbers, rather than a shared pattern or fixed department prefix.

**How to apply:** Provide source-appropriate Insert field choices and a master-record preview. Resolve values from the individual Lesson's selected project or department and discipline. Project fields include Cost Center and Contract; Department fields include Cost ID. Discipline uses its master Value for numbering in either source type.

“Project Master → Contract” means the **Contract / project no.** field in Additional Data, not Contractor. Department Cost ID is text and must retain leading zeros.

**Why:** The user explicitly confirmed which Contract field they meant and requested Department Master's text Cost ID as an insertable numbering field.

**How to apply:** Never substitute Contractor, a master label, a UUID or another source's data for an inserted field. Missing required master values must block allocation without consuming a number.

Changing a prefix or its master values must not renumber existing Lessons. Lessons Learned counters are now independent per project, shared across that project's disciplines. Discipline numbering uses the selected master Value, not its display label or an internal discipline identifier.

**Why:** The user subsequently explicitly requested project-specific numbering, manual go-live starts and a default start of 1 for projects without a maintained range, replacing the earlier organization-wide sequence.

**How to apply:** Administrators maintain each project's or department's next number in Lessons Settings → Numbering. Default to 1, ignore the old organization-wide Lessons counter, preserve both kinds of counter through source-specific pattern changes/resets, and never reuse reserved numbers or modify existing references. Scope uniqueness by organization and source. Historical same-source reference collisions must be skipped. Preview must not allocate a number; missing required master values block issuance before incrementing. QA/QC and Audit numbering retain their existing scope.

Project Master must include authorized local projects as well as Drona projects. QMS360-owned Cost Center is maintained in each project's Additional Data popup, alongside Client, Contractor, Contract / project no., Contract signed, Contract period, TCC, PAC and FAC. Source-owned project fields remain read-only.

**Why:** The user approved including local projects because legitimate Lessons projects otherwise had no place to maintain the Cost Center needed for numbering, and subsequently requested the per-project Additional Data popup with these eight supplementary fields.

**How to apply:** Drona link metadata is optional display context, not a prerequisite for listing projects or editing additional data. Preserve tenant boundaries, administrator permissions, existing project-access restrictions and issued Lesson numbers.
