---
name: Audit Plan PDF policy
description: User requirements for the branded Audit Plan download and missing values.
---

Treat the supplied Audit Plan PDF as the authoritative branding and layout reference. Retain its actual logos and artwork, but never reuse its sample project details, activity text, people or signatures in another audit's report. Populate saved Plan, Schedule and available Project/User values; unavailable information must display exactly “To Be Mapped”. Activity rows may require additional pages; do not drop rows to force the sample's page count.

**Why:** The user explicitly requested the attached document's logos, design and layout, populated from each audit's own records, with this exact missing-value wording.

**How to apply:** Keep report generation read-only and independent from schedule approval, plan submission and execution. Do not fabricate missing dates from UI defaults or infer contract numbers from project codes. The user specified that no other development should be impacted.

The activity table column is **Auditee Role**, populated from each saved
activity's selected roles, not its assigned auditee users or the plan-level
Auditee selection. Use the same label for that activity field in forms,
read-only displays, field settings and printed output.

**Why:** On 2026-10-09 the user explicitly corrected the PDF showing individual
names in this column and requested the activity-role label change everywhere.

**How to apply:** Resolve all saved activity-role IDs for reporting. Retain
separate activity auditee user selections and plan-level Auditee roles; missing
activity roles must read “To Be Mapped”, not fall back to people or live master
defaults.