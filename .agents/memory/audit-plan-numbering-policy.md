---
name: Audit Plan numbering policy
description: Business rules for Audit Plan identifiers and go-live counter maintenance.
---

Audit Plans have their own numbers, separate from Audit Schedule QA/QC References, Audit Numbers and Audit Execution references. The configurable format is prefix + automatic source + middle text + running number, without a year. Project audits use Project Master Additional Data **Contract / project no.**; department audits use Department Master **Cost ID** as text, preserving leading zeroes. Neither the old Cost Center nor Department Value/label is a fallback.

The running sequence starts at 1 per **project or department**, continues across years and never resets annually. At go-live, administrators enter the **last already used** number for that source; the next new plan gets one more. This differs from Lessons Learned, whose go-live field is the *next* number. Preserve existing plan identifiers and never silently reuse allocated numbers.

**Why:** The user replaced yearly Plan, Report, Finding and CAR numbering with yearless continuous source sequences, retaining existing numbers and the master-owned source mappings.

**How to apply:** Continue above the highest saved last-used value across former yearly ranges, rather than resetting, summing or choosing only the latest year. Serialize counter maintenance with creation; preserve issued numbers and keep other Audit ranges independent.

The Create Audit Plan screen must include a read-only **Audit Plan Number** field, not just instructional text. Before save, display the calculated next number without reserving or consuming the sequence; the actual number is assigned atomically on save.

**Why:** The user explicitly requested the field. Reserving numbers merely by opening or changing a form would consume unused numbers, and concurrent plan creators can change the next available number before save.

**How to apply:** Reuse the same source, continuous counter and format logic for display and allocation. Explain that the displayed next number is confirmed on save; keep existing saved plan numbers unchanged.

Dependent numbering lookups must follow the same Department master alias priority as the schedule dropdown; do not merge all alias-matching groups into one list.

**Why:** Existing tenant masters may use singular or differently cased group codes. A separate exact-code lookup rejected valid Civil selections; merging groups could instead select a different master UUID and split the department's counter.

**How to apply:** Use one consistent group resolution for schedule selections, number preview/allocation and go-live department lists. Retain master-value UUIDs as counter scope identities.

In the Audit Plan and Audit Execution landing registers, **Audit ID** means the linked child's QA/QC Reference; **Audit Plan Reference Number** means the plan's independently issued number. Neither column should substitute the Schedule's separate Audit Number / Site Visit No. or an internal UUID.

**Why:** The user requested both identifiers as distinct columns on both registers. Their numbering sequences have different business meanings and must not be combined for display.

**How to apply:** Use the linked Schedule QA/QC Reference for Audit ID, retaining the saved Plan QA/QC Reference only as a legacy fallback when the linked source is absent or blank. Display an unavailable lookup explicitly rather than guessing a reference.
