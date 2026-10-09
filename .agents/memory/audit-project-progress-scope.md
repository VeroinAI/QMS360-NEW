---
name: Overall project progress scope
description: User-defined manual-entry and calculation boundaries for the Audit project progress tile
---

Overall project progress belongs in Audit Workspace → Additional Documents and
follows the Procurement Status visual style. Its phase rows use manually
entered Weight, Plan, Actual, Prior period and per-row Remarks.

Only Weight was explicitly specified as a percentage; its total must be at
most 100%. Variance is read-only Actual minus Plan. Do not invent weighted
overall progress, auto-populate values from other systems, or treat the sample
weights in the supplied spreadsheet as defaults.

**Why:** On 2026-10-09 the user requested manual information entry and precisely
these calculations and constraints. The reference sheet says “Manual” for
Plan and Actual but gives no further units or aggregation formula.

**How to apply:** Preserve blank values until manually entered; leave Variance
blank if Plan or Actual is unavailable. Enforce the weight cap server-side as
well as in the form, and keep other Additional Documents metadata intact.
Adding derived metrics or report mappings needs a separately agreed scope.
