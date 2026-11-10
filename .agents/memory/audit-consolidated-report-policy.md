---
name: Audit consolidated report policy
description: Completion, client template coverage, and truthful handling of missing report-only information.
---

Consolidated Audit reports become available only after the Audit is Complete. Completing an Audit does not itself close CARs, require their closure, or freeze workspace editing. Existing Closed audits remain eligible.

**Why:** The user requested a completion gate for reports, not a change to the separate corrective-action lifecycle.

**How to apply:** Keep the visible status, completion date, report links and direct export access consistent. Preserve completion metadata when other audit sections are saved.

Follow the supplied consolidated-report template's sections and fields using each audit's actual records. The user chose editable Report Details for information not otherwise captured; do not copy sample names, references, signatures, ratings or conclusions.

**Why:** The old report was incorrect, and the client template includes information beyond the normal execution forms.

**How to apply:** Reuse factual audit, plan, checklist, finding, CAR and evidence data. Treat missing values as missing rather than accepting generic DTO placeholders, including epoch dates. Keep effectiveness judgments and sign-offs human-entered.

Photo capture dates are not upload dates. Preserve their distinction; missing capture dates can be entered in report captions.

**Why:** Evidence storage records when a file was uploaded, not when the photograph was taken.

**How to apply:** Label the upload date separately and never silently substitute it as the capture date.

Report Details no longer exposes Document Control, Project Profile, Objective/scope/criteria/method, Overall project progress, or Photograph captions. The conclusion tile also omits Report issue date, Distribution, and Report sign-off.

**Why:** The user explicitly removed these inputs from the workspace page and required other functionality to remain unaffected.

**How to apply:** Treat this as editor-only scope. Preserve existing stored values, shared report definitions, and consolidated PDF behavior unless separately requested.

The Audits workspace Report button downloads a PowerPoint report using the supplied consolidated-report PPTX's original branding, colours, tables and slide layouts. Mapped fields without data read exactly **-**; only fields without mapping logic read **To be mapped**.

**Why:** The user explicitly requested a matching PowerPoint report, not a redesigned deck or a PDF. Template sample people, references, dates and conclusions are not audit data.

**How to apply:** Populate the original OOXML template, continue excess rows/photos on matching slides, and use actual saved records. Preserve completion/export guards and the separate CAR lifecycle. Keep the existing PDF endpoint and report editor unaffected.

Do not rely on PowerPoint's automatic text fitting to contain dynamic programme details.

**Why:** A downloaded report showed ISO timestamps and multiline activity details overlapping adjacent rows despite automatic fitting being enabled; template boxes were designed for short time ranges.

**How to apply:** Budget explicit lines and font sizes within each box, display readable saved wall-clock dates, and paginate excess text without dropping recorded information.

The supplied Audit Report Conditions workbook governs missing PPTX mappings
only. Preserve already populated report values and keep PDF/JSON exports,
workspace forms, stored records and authorization unchanged.

**Why:** On 2026-10-12 the user requested mapping the remaining “To be mapped”
values using the workbook, explicitly allowing unresolved values to remain and
requiring nothing else to change.

**How to apply:** Use selected owners/leads, actual project master values,
attachments, checklist records and saved Additional Documents progress.
Role grants do not identify a specific reviewer/approver; do not infer names or
signatures. Keep the template's grading slide (14) unchanged and omit its
priority-actions slide (16) for the time being, as instructed in the workbook.
Do not invent weighted progress totals or treat Plan/Actual as percentages.

When inspecting report mappings outside the HTTP endpoint, resolve identity
references inside serialized workflow metadata as well as UUID columns.

**Why:** A raw-column-only inspection can falsely report a selected lead or
participant as unmapped even when the production user record exists.

**How to apply:** Reuse the report DTOs and tenant-scoped identity resolution.
Distinguish genuinely missing values from empty template rows and continuation
slots when giving a user a mapping inventory.

Explicit later workbook mappings override an older source choice in the PPTX
only: programme participation uses Plan Auditee Roles, finding requirements use
Audit Area, and finding descriptions come from Findings Description rather than
a checklist question. Group NC/OFI photographs by finding on separate slides.

**Why:** The user supplied these source choices in the remaining-mappings workbook,
including instructions in its “Unused slots” sheet.

**How to apply:** Check every worksheet for instructions. Read saved values only;
keep empty source data distinct from unused template slots in the review workbook.
Genuinely unissued business reference numbers remain “-”; internal
B.x links and client idempotency keys are not substitutes for issued numbers.
A mapping to the classification field cannot supply a photograph capture date.

Slide 3 Project Profile must use the selected audit project's Project Master
Additional Data for Client, Contractor, Contract / project no., Contract signed,
Contract period, TCC, PAC and FAC.

**Why:** The user explicitly chose this maintained project-level source after
requesting the Additional Data popup. Old report-entry or source-master values
must not reappear when an administrator clears the supplementary value.

**How to apply:** Apply this source override only to the PPTX Slide 3 profile.
Keep missing supplementary values exactly “-”; preserve the cover,
other export formats and department-based audits without a project. Format
Contract signed as a calendar date using the organization's date format.

OFI PowerPoint entries must match saved Finding Reference numbers, use exactly
`-` only for absent objective evidence, and contain one logical data row per
finding without unused template slots. A zero-entry section states that no OFIs
are recorded; it is not a placeholder-filled finding.

**Why:** The user specifically corrected these OFI semantics while requiring
other tables, PDF/JSON exports, numbering issuance and photographic layouts to
remain unchanged.

**How to apply:** Find the section by OFI content, not its displayed slide
number, which varies with preceding continuations. Preserve ordinary long
entries in taller rows; exceptional prose may continue as labelled text rather
than additional finding rows. The later all-slide missing-data policy below
supersedes the original OFI-only hyphen restriction.

The NCR PowerPoint register also uses saved Finding References and exactly `-`
when no evidence is linked. Unlike OFI, NCR objective evidence excludes generic
finding notes; use linked uploaded file references only.

**Why:** The user corrected the NCR register's reference and evidence semantics,
then supplied a revised six-column register image. The revised layout supersedes
the earlier restriction on changing NCR table geometry.

**How to apply:** Identify NCR by section content (template slide 11), not its
displayed page number. Preserve historical unnumbered findings as missing data,
legacy/checklist coexistence and OFI's independent notes-as-evidence behavior.
Use the column order **Ref, Date, Finding, Objective evidence, Audit Area, Grade**.
Date means the saved Finding Date, using the organization date format, never
the record creation or upload date. Finding retains the audit-area context and
saved description shown in the reference image. Do not infer missing dates or
issue numbers. Preserve the shaded Grade column and readable, fully retained
continuations; do not turn continued text into additional findings. PDF/JSON
and other report sections remain independent.

Conforming Areas in the PowerPoint report must distinguish unused source rows
from missing cells in actual entries. Ignore wholly blank good-practice inputs,
including whitespace-only rows, in both the table and positive-observations
panel. Keep partial entries and factual conforming checklist results.

**Why:** The user identified unused template slots showing “To be mapped” as
invented conforming entries. The later all-slide missing-data rule now applies
within actual retained records too.

**How to apply:** Render only retained data rows, including on the last
continuation page. Empty sections keep branded headers with a conforming-specific
empty state, never CAR wording. This policy is PPTX-only; do not change saved
data, PDF/JSON mapping, or the separate Technical Architecture slide artifact.

All Audit PowerPoint slides distinguish absent transaction data from absent
mapping logic: show exactly `-` for the former and `To be mapped` only for the
latter. This supersedes earlier section-specific missing-value wording.

**Why:** The user needs to distinguish records requiring data correction from
unsupported fields that require IT support.

**How to apply:** Apply the distinction at mapped source boundaries, including
numbers, dates, project profile, sign-offs, findings, CARs and photographs.
Never globally replace placeholder-like words in filenames or entered prose.
Preserve zero/false values, PDF/JSON semantics, source records and numbering.

The PPTX cover Contract / Project no. uses Project Master Additional Data's
Contract / project no., never project code or an old Report Details value.
Document Control Process Owner lists the active organization users carrying the
Product / Process Owner marker, comma-separated; it is not the selected Schedule
owner or a report signatory. Effective date is the report download date.

**Why:** The user explicitly corrected these sources and distinguished role
assignments from the existing saved report/transaction fields.

**How to apply:** Apply these live-source overrides to PPTX only. Preserve
reviewer/sign-off rules and PDF/JSON mappings. Keep long scope prose complete on
continuation slides, show None for empty recurring themes without numbered slots,
and omit the progress total/date/source and separate good-practice panel.

The Audit Program and Participation timeline has one milestone per activity.
Show only Audit Plan main activity headings followed by start/end dates and times in PowerPoint milestones. Do not include per-activity auditees or append recorded opening/closing meetings as additional milestones.
Remarks are subactivities and must be excluded before wrapping and pagination,
including multiline remarks. Oversized visible activities may continue on another
slide but must not gain another bullet or circle.

**Why:** The user supplied a revised reference showing the activity heading above its dates, and explicitly limited the timeline to headings entered in the Audit Plan. Participation remains in the right-hand boxes.

**How to apply:** Preserve saved remarks, meetings and shared PDF/JSON report data, dates
and auditees. Allocate PowerPoint space from visible content only. Remove unused template milestones and leave continuation
text unmarked. Do not change the saved programme or unrelated report sections.

The PowerPoint CAR tracker must show Correction and Corrective action as separate
response fields, with an independent `-` for each missing value. Keep PDF/JSON's
combined response representation unchanged.

**Why:** The user requested a PowerPoint-only separation of the two saved CAR
responses, not a change to CAR entry, storage, workflows or other report formats.

**How to apply:** Preserve field identity through row mapping and continuation
pagination; never infer one response from the other or shift the owner, due date,
status or verification data when changing the tracker columns.

The PowerPoint conclusion uses the supplied three-row sign-off reference:
Prepared by is the explicitly selected Audit Plan Team Lead with the stored
Mark as complete date. Reviewed by uses actual intermediate Audit Report
approval decisions; Approved by and Report issue date use the actual final
approval. Only the current submission cycle signs the report. Distribution
and Acknowledged by are omitted from this slide.

**Why:** The user supplied an annotated conclusion image identifying workflow
sources, rather than manually entered Report Details sign-off text.

**How to apply:** Include available signature images for these identified
users, never signatures belonging merely to eligible role holders. Preserve
missing values as `-`, prior workflow history and all source data. Keep PDF/JSON
mapping independent, and use the common PowerPoint generator for downloads and
email attachments.

The PowerPoint Corrective action tracker includes a leading **Finding ID**
column before the independent CAR Ref column. Use the saved Finding ID from
the Audit Findings workspace for both current checklist findings and standalone
history, not the internal row UUID, client reference or generated B.x link.

**Why:** The user supplied a revised tracker image and explicitly named the
workspace Finding ID as the source of this additional column.

**How to apply:** Preserve both identifiers on continuation pages and keep
Correction, Corrective action, Owner, due date, status and verification aligned.
An unissued Finding ID is `-`; reading the report must never issue a number.
Keep PDF/JSON columns and unrelated PowerPoint sections unchanged.

The Design and procurement status PowerPoint page uses available content space,
not a fixed number of template rows. Keep Design on the left and Procurement
on the right, each inside its original purple panel. Do not borrow the other
section's column. Both panels retain rounded white comment boxes, aligned
below the taller table and its check text.

**Why:** After the premature Total submittals continuation was corrected, the
user rejected the cross-column flow and missing comment-box layout and supplied
the required two-panel screenshot again.

**How to apply:** Retain the two-section branding, all saved rows, totals and
comments. Add table rows and resize/reposition the padded comment boxes first;
only continue when the content cannot fit. Continuations retain the same panel
format, headings and footer clearance. Keep PDF/JSON and other sections independent.

Document control and approval uses the same actual Audit Report signatories
as the Conclusion: selected Audit Lead with Mark Complete date, actual
intermediate approval decisions, and actual final approval decision. Include
available signatures, never infer a signature or approval from eligibility.
Replace the Revision history table with Approval History, without its Revision
column, showing recorded decisions chronologically, including earlier cycles.

**Why:** The user explicitly replaced manual document-control sign-offs and
revision placeholders with the report's factual approval workflow details.

**How to apply:** Preserve the left-hand Document information fields and
original branding. Use missing-value dashes, retain recorded approval remarks
and dates, and continue lengthy history in matching slides without losing text.
Do not change PDF/JSON, report completion guards or the separate CAR workflow.