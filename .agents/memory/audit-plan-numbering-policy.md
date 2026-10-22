---
name: Audit Plan numbering policy
description: Business rules for Audit Plan identifiers and go-live counter maintenance.
---

Audit Plans have their own numbers, separate from Audit Schedule QA/QC References, Audit Numbers and Audit Execution references. The configurable format has literal text before and after an automatic source value, followed by the two-digit year from the **linked child Audit Schedule's From Date**, then a numeric running sequence. Project audits use Project Master Additional Data **Contract / project no.**; department audits use Department Master **Cost ID** as text, preserving leading zeroes. Neither the old Cost Center nor Department Value/label is a fallback.

The running sequence starts at 1 per **project or department and full four-digit year**. At a mid-year go-live, administrators enter the **last already used** number for a particular scope/year; the next new plan gets one more. This differs from Lessons Learned, whose go-live field is the *next* number. Preserve existing plan identifiers and never silently reuse allocated numbers.

**Why:** The user requested continuity for a mid-year rollout and wanted source selection to follow the Audit Plan's linked project or department, not require typing an identifier into each form. They subsequently explicitly changed all applicable Audit source mappings to Contract / project no. and Department Cost ID.

**How to apply:** Validate the source master value and schedule From Date before allocating; serialize counter maintenance with plan creation, keep an issued number on subsequent edits, and avoid renumbering existing plans when a format or schedule changes. Keep the other Audit numbering systems independent.

The Create Audit Plan screen must include a read-only **Audit Plan Number** field, not just instructional text. Before save, display the calculated next number without reserving or consuming the sequence; the actual number is assigned atomically on save.

**Why:** The user explicitly requested the field. Reserving numbers merely by opening or changing a form would consume unused numbers, and concurrent plan creators can change the next available number before save.

**How to apply:** Reuse the same source, From Date year, counter and format logic for display and allocation. Explain that the displayed next number is confirmed on save; keep existing saved plan numbers unchanged.

Dependent numbering lookups must follow the same Department master alias priority as the schedule dropdown; do not merge all alias-matching groups into one list.

**Why:** Existing tenant masters may use singular or differently cased group codes. A separate exact-code lookup rejected valid Civil selections; merging groups could instead select a different master UUID and split the department's counter.

**How to apply:** Use one consistent group resolution for schedule selections, number preview/allocation and go-live department lists. Retain master-value UUIDs as counter scope identities.
