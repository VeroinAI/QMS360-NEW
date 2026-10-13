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

The Audits workspace Report button downloads a PowerPoint report using the supplied consolidated-report PPTX's original branding, colours, tables and slide layouts. Unavailable values read exactly **To be mapped**.

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
Requested NCR/OFI/CAR business reference numbers marked “to be added” remain
“To be mapped”; internal B.x links and client idempotency keys are not substitutes.
A mapping to the classification field cannot supply a photograph capture date.

Slide 3 Project Profile must use the selected audit project's Project Master
Additional Data for Client, Contractor, Contract / project no., Contract signed,
Contract period, TCC, PAC and FAC.

**Why:** The user explicitly chose this maintained project-level source after
requesting the Additional Data popup. Old report-entry or source-master values
must not reappear when an administrator clears the supplementary value.

**How to apply:** Apply this source override only to the PPTX Slide 3 profile.
Keep missing supplementary values exactly “To be mapped”; preserve the cover,
other export formats and department-based audits without a project. Format
Contract signed as a calendar date using the organization's date format.