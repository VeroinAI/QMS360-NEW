---
name: Audit Plan PDF policy
description: User requirements for the branded Audit Plan download and missing values.
---

Treat the supplied Audit Plan PDF as the authoritative branding and layout reference. Retain its actual logos and artwork, but never reuse its sample project details, activity text, people or signatures in another audit's report. Populate saved Plan, Schedule and available Project/User values. For this PDF only, absent mapped data (including absent related records or unresolved user/role references) displays “-”; only genuinely absent mapping logic displays exactly “To be mapped”. Activity rows may require additional pages; do not drop rows to force the sample's page count.

**Why:** The user explicitly requested the attached document's logos, design and layout, populated from each audit's own records. On 2026-10-23 they superseded the blanket missing-value label with the mapped-empty versus unimplemented distinction.

**How to apply:** Keep report generation read-only and independent from schedule approval, plan submission and execution. Do not fabricate missing dates from UI defaults or infer contract numbers from project codes. The user specified that no other development should be impacted.

Omit the Revision line entirely from the Audit Plan PDF.

**Why:** On 2026-10-28 the user explicitly requested removal of “Revision: To be mapped” from this download.

**How to apply:** Do not print a revision label or placeholder; preserve the surrounding branded cover layout and other report data.

The **Section/Activities to be Accessed** column must display the organization's
Activities master label, not its stored key. Preserve historical free-text
sections when no master mapping exists.

**Why:** On 2026-10-12 the user reported `opening_meeting` in the downloaded
Audit Plan report and requested its Master Data label, with no unrelated changes.

**How to apply:** Resolve labels only for reporting; do not rename saved keys,
rewrite plans, or change the Activities master to fix a display problem.

Master group codes can retain title case (`Activities`) in both development
and production. Reporting lookups must match group codes case-insensitively,
as the form's master lookup does.

**Why:** A case-sensitive lowercase report lookup returned no labels despite
the master entry existing, so mapper-only tests passed while downloads still
printed keys.

**How to apply:** Test the database lookup as well as the value-to-label mapper;
retain organization boundaries and historical inactive labels.

The activity table column is **Auditee Role**, populated from each saved
activity's selected roles, not its assigned auditee users or the plan-level
Auditee selection. Use the same label for that activity field in forms,
read-only displays, field settings and printed output.

**Why:** On 2026-10-09 the user explicitly corrected the PDF showing individual
names in this column and requested the activity-role label change everywhere.

**How to apply:** Resolve all saved activity-role IDs for reporting. Retain
separate activity auditee user selections and plan-level Auditee roles; missing
activity roles must read “-”, not fall back to people or live master
defaults.

Prepared By remains the selected Lead Auditor. The **Audit Program Manager**
block names the person who originally created the Audit Plan, not the current
downloader or the schedule owner. Each block uses that same user's master
signature, centered above its Signature text.

**Why:** On 2026-10-09 the user confirmed the Prepared By name was correct and
requested both user-master signatures plus the creator in the renamed manager
block.

**How to apply:** Resolve the original creator from retained creation history;
do not infer them from later edits or the selected lead. Preserve missing-data
markers if no creator or signature is available, and never reuse sample
signatures from the template.

Project Details must respect the Project Master Additional Data — 2 meaning:
the generic Name is a contact, not the Project Name or Project Manager.
TCC, PAC and FAC are free text, while Contract Signed is a calendar date.
Canonical saved clears must never revive old imported aliases.

**Why:** The user explicitly required the saved QMS-owned values without
substituting contact, contract period, cost-centre or other unrelated data.

**How to apply:** Keep this correction read-only and scoped to the Plan PDF;
do not infer missing Consultant, Contract Value or PTS fields or migrate projects.

Continuation-content checks must account for repeated headers and footers
interleaving extracted PDF text, including in the middle of a phrase.

**Why:** Text extraction can place page furniture between two words of a
fully retained value, causing a contiguous-string assertion to falsely report loss.

**How to apply:** Verify short unique content markers across continuations or
strip page furniture before comparing complete multi-page values.