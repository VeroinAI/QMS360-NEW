---
name: Audit Plan numbering policy
description: Business rules for Audit Plan identifiers and go-live counter maintenance.
---

Audit Plans have their own numbers, separate from Audit Schedule QA/QC References, Audit Numbers and Audit Execution references. The configurable format has literal text before and after an automatic source value, followed by the two-digit year from the **linked child Audit Schedule's From Date**, then a numeric running sequence. Project audits use the Project Master Cost Center; department audits use the Department master **Value**, not the display label.

The running sequence starts at 1 per **project or department and full four-digit year**. At a mid-year go-live, administrators enter the **last already used** number for a particular scope/year; the next new plan gets one more. This differs from Lessons Learned, whose go-live field is the *next* number. Preserve existing plan identifiers and never silently reuse allocated numbers.

**Why:** The user requested continuity for a mid-year rollout and wanted source selection to follow the Audit Plan's linked project or department, not require typing an identifier into each form.

**How to apply:** Validate the source master value and schedule From Date before allocating; serialize counter maintenance with plan creation, keep an issued number on subsequent edits, and avoid renumbering existing plans when a format or schedule changes. Keep the other Audit numbering systems independent.

The Create Audit Plan screen must include a read-only **Audit Plan Number** field, not just instructional text. Before save, display the calculated next number without reserving or consuming the sequence; the actual number is assigned atomically on save.

**Why:** The user explicitly requested the field. Reserving numbers merely by opening or changing a form would consume unused numbers, and concurrent plan creators can change the next available number before save.

**How to apply:** Reuse the same source, From Date year, counter and format logic for display and allocation. Explain that the displayed next number is confirmed on save; keep existing saved plan numbers unchanged.
