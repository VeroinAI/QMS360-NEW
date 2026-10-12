---
name: Email Rule template policy
description: Per-rule content customization and approval-recipient boundaries
---
Email Rule create/edit must allow administrators to save a subject and body template separately for each rule. The user explicitly extended the original plain-text body requirement on 2026-10-12 to allow selected text to be bold, italic, underlined and colored, with formatting preserved in sent emails. Use the supplied Audit email document as editable examples, not automatic replacement of existing rules.

**Why:** The user asked for per-rule email body details and subsequently authorized rich body formatting; they did not request changes to workflow recipients or approval sequencing.

**How to apply:** Blank template fields retain default content. Personalize supported placeholders from the event and recipient; explicitly mark unavailable values. Preserve the existing SMTP From, queue/retry behavior and workflow attachments.

Custom placeholder creation is administrator-only and workspace-specific. A Lessons Learned placeholder must not be offered in Audit, QA/QC, or Document governance rules, even if its source is shared system context.

**Why:** The user explicitly required workspace isolation for wizard-created placeholders.

**How to apply:** Carry workspace scope into any future registry and template editor integration. Keep Document governance separate at the user-facing scope even though its current events are recorded under QA/QC.

The user initially limited the placeholder work to a draft-only wizard, then explicitly authorized activation/deactivation and email integration on 2026-10-12.

**Why:** The earlier draft-only restriction no longer applies; do not treat it as a standing prohibition on functional activation.

**How to apply:** Preserve workspace isolation when extending the now-authorized functionality. Do not activate imported browser drafts without the administrator choosing activation.

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

Lessons Learned “Reject” is a legacy email-event label for the Send back review outcome, not a separate permanent rejection state. Existing rules and selected-event placeholders must continue to recognize both names.

**Why:** Administrators configured a Reject template while the review workflow emitted Send back; the unmatched rule caused a remarks-only fallback email instead of the saved template.

**How to apply:** Keep this compatibility specific to Lessons Learned. Preserve rule priority, actor filters and recipients; do not treat Audit rejection and send-back events as equivalent. Approval dates remain approval-only; use Reviewed at for send-back dates.