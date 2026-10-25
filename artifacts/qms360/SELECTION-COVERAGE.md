# Searchable selection coverage

QMS360 only. Architecture slides, video and Canvas are unchanged.

## Shared single-select rollout

Every consumer of `components/ui/select` now opens a popup containing an editable
combobox and listbox. Filtering uses the complete visible label, not the stored
value. The full React option tree supplies trigger labels independently of the
filtered popup. Empty groups disappear, disabled options cannot be selected,
and search is discarded when the popup unmounts. The existing value,
defaultValue, onValueChange, open, disabled, required, name and form contracts
remain available. No server option queries or permission scopes were changed.

Covered consumers (all paths relative to `src/`):

| Area | Files / fields |
| --- | --- |
| Shared feedback | `components/feedback-widget.tsx`, `pages/feedback/index.tsx` — feedback categories and filters |
| Lessons | `pages/lessons/index.tsx`, `lesson-form.tsx`, `source-filter.tsx`, `ai-entry.tsx` — forms, source/project/department, disciplines, categories, impacts, creators, approvers, states, reassignment and assistant choices |
| Audit | `pages/audit/index.tsx`, `activity-role-fields.tsx`, `audit-report-details.tsx`, `car-register.tsx`, `finding-items.tsx` — programmes, schedules, Plans, meeting/report fields, findings/CARs, filter and role choices |
| QA/QC | `pages/qaqc/index.tsx` — dashboard filters, legacy forms, approval and administration choices |
| QA/QC reporting | `pages/qaqc/reporting/{dashboard-page,governance-dashboard-page,historical-balances-page,form-kit,metric-details-form,metrics-entry-form,metrics-report-list,metrics-report-submit-dialog,pdf-template-picker,pdf-templates-admin,report-editor,report-list,settings-page,csat-form}.tsx` — project/report/month/status filters, monthly/daily fields, import and historical-balance settings, submission choices, templates |
| Master data | `pages/master-data/index.tsx` — group, application, category and configuration selections |
| Settings | `pages/settings/{index,numbering-form,audit-car-numbering,audit-finding-numbering,audit-plan-numbering,audit-report-numbering}.tsx` — platform/workspace users, scopes, approvers, delegations, escalations, role configuration and numbering sources |
| Integration cockpit | `pages/cockpit/{index,date-format-tab,email-queue-tab,email-placeholders-tab,email-rule-cc-editor,email-rules-tab}.tsx` — connectors, imports, date format, events, queue filters, recipients, projects, rule and placeholder configuration |

## Former native dropdowns

These use `components/ui/native-selection`, which keeps a hidden native form
bridge but gives the visible trigger the ID, test/validation attributes and
accessible label. Choosing an option dispatches the original change handler
with its original value. All values are encoded internally (including empty),
so no stored value collides with an empty sentinel.

- `components/layout/app-shell.tsx`: project navigation/filter, including mobile.
- `pages/cockpit/index.tsx`: SMTP Security, including its short two-item list.
- `pages/cockpit/email-rules-tab.tsx`: rule event and simulator event.
- `pages/cockpit/email-rule-template-editor.tsx`: Audit email example.
- `pages/qaqc/reporting/approved-revisions.tsx`: Drawing/Submittal for every row.
- `pages/qaqc/reporting/metrics-entry-form.tsx`: manpower disciplines, including
  disabled duplicate choices and previously saved values.
- `pages/qaqc/reporting/additional-metrics-tiles.tsx`: every native tile field,
  including static type, status and ageing choices.

## Multi-value and bespoke fields

- Shared checkbox/radio dropdown contents add search without replacing checked
  state or callbacks. This covers Audit team leads, Audit Team, Auditee Roles,
  Circulation, activity users/roles, Plan methods/criteria, and Settings
  escalation recipients/CC. Empty lists still show search and no-results
  feedback. Ordinary action menus do not gain search.
- `pages/audit/index.tsx`: inline Add Team Lead candidates and send-for-execution
  notification roles now have selection search. Selected lead removal remains
  separate, so filtering candidates cannot remove leads.
- `pages/master-data/index.tsx`: Linked Audit Types checkbox list.
- `pages/cockpit/email-rules-tab.tsx`: receiver workspace roles.
- `pages/cockpit/email-rule-cc-editor.tsx`: CC workspace roles.
- `pages/cockpit/email-placeholders-tab.tsx`: application, applicability, event
  and format lists. Existing source-field search is retained.
- `pages/settings/index.tsx`: delegation lesson choices. Select all continues
  to use the entire originally eligible set, not only search matches.
- `pages/qaqc/reporting/csat-form.tsx`: ratings, outcome choices and follow-up
  checkbox choices keep their original values, validation and disabled state.
- Audit feasibility and QA/QC OSD availability radio groups also provide search,
  even though their underlying values are boolean.

Inline lists keep hidden rows mounted and do not modify value arrays. Menu
search only hides/disables unmatched items for keyboard navigation; checked
state and unavailable-option removal callbacks remain intact.

## Existing searchable controls retained

- `pages/master-data/role-picker.tsx`: assigned application roles, including
  inactive/unavailable removal and Clear roles.
- `pages/settings/index.tsx`: project/department assignment scopes.
- Audit programme/project, activity-user and meeting-attendee command pickers;
  `pages/audit/not-represented-closing-attendees.tsx` stays read-only.
- Cockpit placeholder source fields. Free-text source-path/template-binding
  datalists remain suggestion inputs, not constrained fields.

## Genuine non-field exclusions

- Action buttons/menus, tabs, navigation links and workflow confirmation buttons.
- Table row selection for exports, bulk reassignment and other row actions.
- Standalone boolean switches/checkboxes (enabled/active, include legacy,
  required and confirmation).
- Permission matrices: each checkbox independently enables one named action or
  report section. These are capability booleans, not a choice field replacing a
  user's stored list value. Their business rules and layout remain unchanged.
- Dates/calendars, free text, numbers, read-only summaries, selected-value badges
  and removal actions. Search does not invent values for any of these.

## Regression checks

`components/ui/selection-search.test.tsx` exercises labels versus IDs,
case-insensitive substring matching, reset/clear/no-results, selected labels,
disabled/grouped items, keyboard focus/selection, form safety, native events and
form values, and retained hidden multi-selections/unavailable removal.
`components/ui/selection-coverage.test.ts` guards against reintroducing a visible
native or direct Radix Select outside the shared adapters. Existing reporting
tests continue to check allowed options, disabled duplicate disciplines and
the validation attributes on the visible controls.

## Verification result

- Focused selection/reporting interaction and regression tests, type check and
  production build pass.
- The broader frontend suite has unrelated pre-existing failures: a removed
  priority-actions tile assertion, obsolete QA/QC role-screen wording, and
  incomplete Daily download API mocks. No business behavior was changed to
  satisfy those assertions.
- Browser verification confirmed Lessons dropdowns and the shared native-
  replacement project selector, including 390px mobile access, using read-only
  browser fixtures. The seeded administrator login returned 401, so no
  authenticated save or server-scoped option claim is made. Audit/QAQC/admin
  browser coverage is blocked by the existing local sign-in issue; shared
  primitive and reporting component regressions are covered by automated tests.
