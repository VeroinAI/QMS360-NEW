---
name: QA/QC role authorization policy
description: Default-role editing, legacy compatibility and QA/QC-only scope boundaries
---
Keep QA/QC default role identities and protected metadata stable while allowing administrators to change their activity permissions in place.

**Why:** The user needs to configure the existing QAQC Representative role, not clone it or replace existing user assignments when saving permissions.

**How to apply:** Keep default names, descriptions and enabled state protected; permission editing must remain available. Preserve compatible legacy grants rather than silently dropping them. New activity-specific grants should not accidentally authorize unrelated activities.

Apply checkbox-based authorization changes to QA/QC only. Do not change Lessons or Audit role-name authorization as a side effect.

**Why:** The user explicitly required that unrelated development not be affected.

**How to apply:** Keep application-specific authorization branches separate; platform administrators retain their existing bypass.

New role permission keys must be accepted by both the application permission catalog and the generated role request/response contracts.

**Why:** Section checkboxes worked in the editor, but role saves failed because the API contract still rejected their keys before persistence.

**How to apply:** When adding QA/QC permissions, update the source API contract, regenerate the validators and clients, and test the actual create/update validators against the full permission catalog, including list/reload responses.

For legacy QA/QC own-record access, original creation/import audit provenance is ownership evidence; later edits must not transfer ownership.

**Why:** Enforcing own access should not require a production schema migration solely for the role-editing fix, or incorrectly attribute a record to its most recent editor.

**How to apply:** Use original creation provenance alongside established submission/reviewer participation; fail closed when ownership cannot be established.

QA/QC monthly reports support section-restricted shared editing. Unauthorized sections stay visible and read-only; authorized contributors may maintain their sections in accessible draft or sent-back reports created by another user.

**Why:** The user explicitly chose read-only visibility and shared contributions rather than hidden sections or creator-only editing.

**How to apply:** Keep existing project and report-state boundaries. Section permissions are additive across roles; an unconfigured whole-report edit role retains legacy section access. Enable section restrictions on each broad role that should be limited. Preserve creator submission/deletion and reviewer responsibilities. Validate the complete report at submission, not as a prerequisite for another contributor's draft save.

On the QA/QC Metrics landing page and its document editor, only Draft documents
may be edited; Display opens read-only even when the viewer could edit a draft.
Keep the separate full monthly-report submission/review workflow's sent-back
correction rules unchanged.

**Why:** The user explicitly required Draft-only editing for the revised Metrics
landing page while asking not to impact other development.

**How to apply:** Reuse monthly-report RBAC and existing section/project scope.
Do not interpret the landing page's Draft-only rule as a global removal of
sent-back corrections, or as permission to expose legacy metric transactions.

QA/QC approval levels are role configuration only until the user explicitly requests the remaining workflow changes. A role with global or activity-specific approval access must have a positive whole-number level when saved; existing roles without a level remain readable.

**Why:** The user requested the Audit-style approver-level option in QA/QC Roles & Permissions but explicitly limited this phase to roles and responsibilities: “Remaining change will be completed latter.”

**How to apply:** Preserve current approver eligibility, selected-approver routing and report states. Do not introduce sequential approvals, infer levels from names, or retrofit in-flight reports just because level metadata is available. Removing every approval grant clears the level, without changing other role permissions.