---
name: Monthly NCR ageing uniqueness
description: Department and ageing bucket uniqueness for monthly QA/QC Metrics reports.
---

Within each monthly External NCR or Internal NCR ageing breakdown, a BU/Department
and ageing bucket pair may appear only once. The same department may use the other
buckets; another department may use that bucket. External and Internal NCR are
independent breakdowns. Compare department values ignoring surrounding whitespace
and letter case, without changing their saved/displayed labels.

**Why:** The user explicitly requested that already-used department/bucket pairs
be grayed out instead of allowing repeated ageing entries.

**How to apply:** Reserve a pair as soon as selected, not only after a positive
count is entered. Exclude the row itself when checking its existing selection.
Changing a department must clear a conflicting bucket; deleting or changing the
other row releases its reservation. Also reject duplicates on API save, submission
and workbook import. Do not delete or merge existing report history automatically.
