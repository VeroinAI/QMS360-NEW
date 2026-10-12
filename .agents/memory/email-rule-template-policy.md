---
name: Email Rule template policy
description: Per-rule content customization and approval-recipient boundaries
---
Email Rule create/edit must allow administrators to save a subject and plain-text body template separately for each rule. Use the supplied Audit email document as editable examples, not automatic replacement of existing rules.

**Why:** The user asked for per-rule email body details using their Audit email examples; they did not request changes to workflow recipients or approval sequencing.

**How to apply:** Blank template fields retain default content. Personalize supported placeholders from the event and recipient; explicitly mark unavailable values. Preserve the existing SMTP From, queue/retry behavior and workflow attachments.

Custom placeholder creation is administrator-only and workspace-specific. A Lessons Learned placeholder must not be offered in Audit, QA/QC, or Document governance rules, even if its source is shared system context.

**Why:** The user explicitly required workspace isolation for wizard-created placeholders.

**How to apply:** Carry workspace scope into any future registry and template editor integration. Keep Document governance separate at the user-facing scope even though its current events are recorded under QA/QC.

The placeholder wizard must be finalized before enabling custom placeholders in live email triggering.

**Why:** The user requested only the wizard and its Integration Cockpit access initially, with further development deferred until wizard finalization.

**How to apply:** Do not automatically wire draft definitions into live email templates or delivery. Seek explicit approval for the later integration phase.

Protected Audit approval emails must use the workflow queue only, not a second generic rule dispatch.

**Why:** Once templates can contain review comments, a duplicate generic dispatch could expose content outside the saved approval audience or bypass a disabled matching workflow rule.

**How to apply:** Apply content templates inside the existing participant-scoped approval queue. Do not copy the example document's To/CC lists into new recipient rules.

Lessons Learned submission emails must include the form PDF as an actual
attachment, using the same report as the form's Download PDF action.

**Why:** The business requested the downloadable form in the existing email sent
for approval, without changing unrelated workflows. A download link alone does
not fulfill this requirement.

**How to apply:** Preserve the configured submission recipients and templates.
Keep a private submitted-report snapshot available for queued delivery retries;
do not add PDFs to Lessons review emails or other application events as a side
effect.