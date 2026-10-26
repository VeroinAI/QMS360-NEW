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

Administrators may explicitly select CC recipients using the same recipient
modes as To, but must choose a different mode for CC. This is a mode-level
restriction, even when two role selections would resolve to different people.
Existing role-only CC rules retain delivery until edited; flag conflicts on
edit instead of silently deleting their CC audience. Resolve CC in the event's
application and tenant, using active roles, assignments and users. Apply CC in
both generic and protected Audit queues without changing To, Reply-To or
duplicating workflow dispatch.

**Why:** The user expanded CC beyond workspace roles and explicitly prohibited
selecting the same Recipient mode for To and CC.

**How to apply:** Enforce this on both the editor and new/updated rules. Preserve
stored legacy delivery, organization isolation and To-over-CC address deduplication.

**Why:** The user requested CC-role maintenance in Edit Rule and actual delivery
for triggered emails. This explicitly configured audience is distinct from
automatically copying sample-document recipients.

Event Email Rules explicitly control report attachments, including Lessons
submission and configured Audit approval emails. No report selection means no
attachment; selecting a report attaches the triggering record's supported PDF/PPT.

**Why:** The user superseded the earlier automatic Lessons submission-PDF rule
with optional, event-specific attachment selection across QMS360. An automatic
PDF must not override an administrator's No attachment choice.

**How to apply:** Preserve recipients, CC, templates and protected approval
audiences. Permit only reports supported for the selected event, validate on
the server, keep private snapshots for retries, and retry selected-report
failures rather than sending without the report. Independent scheduled
distribution and already queued messages retain their existing behavior.

Lessons Learned “Reject” is a legacy email-event label for the Send back review outcome, not a separate permanent rejection state. Existing rules and selected-event placeholders must continue to recognize both names.

**Why:** Administrators configured a Reject template while the review workflow emitted Send back; the unmatched rule caused a remarks-only fallback email instead of the saved template.

**How to apply:** Keep this compatibility specific to Lessons Learned. Preserve rule priority, actor filters and recipients; do not treat Audit rejection and send-back events as equivalent. Approval dates remain approval-only; use Reviewed at for send-back dates.