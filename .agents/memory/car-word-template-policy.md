---
name: CAR Word template policy
description: User requirements for the CAR Register's Word report format and unmapped fields.
---

CAR Register row downloads must be Word documents matching the supplied CAR template's format, look, colours and branding. Unavailable or unmappable values must display exactly **To be mapped**.

**Why:** The user explicitly requested the attached Word format, not a redesigned report, PDF, or invented values.

**How to apply:** Preserve the original template for exports. Map actual finding, response and verification records; do not invent CAR numbers, signature evidence, risk levels or dates to fill gaps. Downloading is read-only and must not create a response or add a response-save log entry.

The Audit / Assessment Reference is the linked individual audit's saved QA/QC reference (or the Plan's saved reference), never the execution title stored in its reference-number column. Area / Activity displays only the shared Audit Area master label, without the stored key or appended clause. Source is the containing Schedule / Programme name, not the audit type.

**Why:** The user identified these three incorrect mappings in the downloaded CAR form and explicitly specified their meanings.

**How to apply:** Resolve these fields at export time without modifying records or the supplied template. Missing references or unresolved labels follow the existing unavailable-value policy; do not substitute titles for missing numbers.
