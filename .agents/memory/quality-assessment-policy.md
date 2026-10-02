---
name: Monthly quality assessment policy
description: Critical NCR classification and human review requirements for the QA/QC monthly assessment.
---

For the monthly Quality Assessment Brief, every open NCR in the >45-day ageing bucket is treated as critical. Do not add a separate critical checkbox or require an independent severity source.

**Why:** On 2026-10-02 the user explicitly chose age-based criticality instead of adding a critical marker to NCR ageing rows.

**How to apply:** Use the selected project's monthly external/internal NCR ageing counts. This reporting definition does not authorize changing individual record classifications in other modules.

AI suggestions remain separate from the final assessment. The representative may accept, edit or override them, and must explicitly review and confirm the final text before submission. Report edits invalidate that confirmation.

**Why:** The supplied assessment specification requires human-reviewed final text, not automatic AI substitution or submission.

**How to apply:** Preserve draft saving and manual entry without requiring an AI call. Summarize the same accumulated-rate variances shown in the metric/PQI/material tiles; flag sustained low PQI only with exact consecutive-month evidence.

Evidence-heavy monthly assessment generation needs a bounded, feature-specific response budget rather than the deadline used for short text rephrasing.

**Why:** The live assessment succeeded using the existing integration, but only after the generic short deadline had expired. A timeout here is not evidence that credentials need replacement.

**How to apply:** Measure a real reporting payload before reducing its response budget. Preserve the saved draft on failure, report the error explicitly, and avoid automatic repeated provider calls.