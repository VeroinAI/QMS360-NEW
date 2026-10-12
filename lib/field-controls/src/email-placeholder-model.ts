import { emailTemplateFields } from './email-templates';

export type WorkspaceKey = 'lessons' | 'audit' | 'qaqc' | 'docgov';
export type FieldType = 'text' | 'date' | 'timestamp' | 'decimal' | 'integer';
export type FormatKey = 'plain' | 'date_dmy' | 'date_iso' | 'date_long' | 'datetime' | 'decimal_0' | 'decimal_2' | 'number_grouped';
export type EventOption = { value: string; label: string };
export const WORKSPACES = [
  { key: 'lessons', label: 'Lessons Learned', tokenPrefix: 'lessons', app: 'lessons', blurb: 'Lesson learned forms raised, submitted, reviewed and transferred.' },
  { key: 'audit', label: 'QMS Audit', tokenPrefix: 'audit', app: 'audit', blurb: 'Audit programmes, schedules, plans, findings and corrective actions.' },
  { key: 'qaqc', label: 'QA/QC', tokenPrefix: 'qaqc', app: 'qaqc', blurb: 'Quality metrics, inspections, toolbox talks and assessment briefs.' },
  { key: 'docgov', label: 'Document governance', tokenPrefix: 'docgov', app: 'qaqc', blurb: 'Document governance events, isolated from other QA/QC events.' },
] as const;
export function workspaceDef(key: WorkspaceKey) { return WORKSPACES.find(w => w.key === key)!; }
export function parseEvent(value: string) {
  const parts = value.split('.');
  return parts.length < 3 || parts.some(p => !p) ? null : { app: parts[0], entity: parts[1], action: parts.slice(2).join('.') };
}
/** Lessons review has one negative outcome: send back, historically catalogued as reject. */
export function canonicalEmailEventType(value: string) {
  return value === 'lessons.lesson_form.reject' ? 'lessons.lesson_form.send_back' : value;
}
export function eventsForWorkspace(events: EventOption[], workspace: WorkspaceKey) {
  return events.filter(e => {
    const p = parseEvent(e.value);
    return p?.app === workspaceDef(workspace).app && (workspace === 'docgov' ? p.entity === 'document_governance' : workspace !== 'qaqc' || p.entity !== 'document_governance');
  });
}
export type SourceDef = {
  key: string; workspace: WorkspaceKey; origin: 'record' | 'system'; entityLabel: string;
  fieldLabel: string; schemaRef: string; type: FieldType; description: string; eventEntities: string[] | 'all';
};
type Field = [key: string, label: string, type?: FieldType];
function recordSources(workspace: WorkspaceKey, slug: string, label: string, table: string, entities: string[], fields: Field[]): SourceDef[] {
  return fields.map(([key, fieldLabel, type = 'text']) => ({
    key: `${slug}_${key}`, workspace, origin: 'record', entityLabel: label, fieldLabel, schemaRef: `${table}.${key}`,
    type, description: `${fieldLabel} from the ${label.toLowerCase()} associated with this event.`, eventEntities: entities,
  }));
}
function systemSources(workspace: WorkspaceKey): SourceDef[] {
  return [
    ['recipient_full_name', 'Recipient full name'], ['recipient_email', 'Recipient email'],
    ['actor_full_name', 'Actor full name'], ['creator_full_name', 'Creator full name'], ['system_name', 'System name'],
  ].map(([key, label]) => ({
    key, workspace, origin: 'system', entityLabel: 'System context', fieldLabel: label,
    schemaRef: key === 'system_name' ? 'system.name' : `shared.users.${key === 'recipient_email' ? 'email' : 'full_name'}`,
    type: 'text', description: `${label} from the recipient or event context.`, eventEntities: 'all',
  }));
}
// Fixed approved catalog shared by the API, wizard and email editor. No user-supplied paths.
export const SOURCE_CATALOG: SourceDef[] = [
  ...systemSources('lessons'),
  {
    key: 'approver_full_name', workspace: 'lessons', origin: 'system', entityLabel: 'System context',
    fieldLabel: 'Approver full name', schemaRef: 'shared.users.full_name', type: 'text',
    description: 'Full name of the approver assigned to this lesson learned form. This is independent of the email recipient and the person triggering the event. An unassigned or unavailable approver uses the configured fallback.',
    eventEntities: ['lesson_form'],
  },
  {
    key: 'lesson_form_approved_at', workspace: 'lessons', origin: 'record', entityLabel: 'Lesson learned form',
    fieldLabel: 'Approval date and time', schemaRef: 'app2_lessons.lesson_learned_forms.reviewed_at',
    type: 'timestamp', eventEntities: ['lesson_form'],
    description: 'Recorded date and time when the approver approved this lesson learned form. Pending approvals and send-back decisions use the configured fallback. Choose a date-only or date-and-time format.',
  },
  ...recordSources('lessons', 'lesson_form', 'Lesson learned form', 'app2_lessons.lesson_learned_forms', ['lesson_form'], [
    ['reference_number', 'Reference number'], ['title', 'Title'], ['categorisation', 'Categorisation'],
    ['issue_category', 'Issue category'], ['impact', 'Impact'], ['description', 'Description'], ['root_cause', 'Root cause'],
    ['corrective_action', 'Corrective action'], ['captured_at', 'Captured at', 'timestamp'],
    ['submitted_at', 'Submitted at', 'timestamp'], ['reviewed_at', 'Reviewed at', 'timestamp'],
    ['review_comments', 'Review comments'], ['repeat_count', 'Repeat count', 'integer'],
  ]),
  {
    key: 'lesson_form_approval_remarks', workspace: 'lessons', origin: 'record', entityLabel: 'Lesson learned form',
    fieldLabel: 'Approval remarks', schemaRef: 'app2_lessons.lesson_learned_forms.review_comments',
    type: 'text', eventEntities: ['lesson_form'],
    description: 'Comments saved by the reviewer when approving this lesson learned form. Empty remarks, pending reviews and send-back decisions use the configured fallback.',
  },
  {
    key: 'lesson_form_send_back_remarks', workspace: 'lessons', origin: 'record', entityLabel: 'Lesson learned form',
    fieldLabel: 'Send-back remarks', schemaRef: 'app2_lessons.lesson_learned_forms.review_comments',
    type: 'text', eventEntities: ['lesson_form'],
    description: 'Comments saved by the reviewer when sending this lesson learned form back for rework. Empty remarks, pending reviews and approval decisions use the configured fallback.',
  },
  ...systemSources('audit'),
  ...recordSources('audit', 'audit_schedule', 'Audit programme / schedule', 'app3_audit.audit_schedules', ['audit_programme', 'audit_schedule'], [
    ['title', 'Title'], ['year', 'Year', 'integer'], ['workflow_state', 'Workflow state'],
  ]),
  ...recordSources('audit', 'audit_plan', 'Audit plan', 'app3_audit.audit_plans', ['audit_plan'], [
    ['scope', 'Scope'], ['criteria', 'Criteria'], ['audit_date', 'Audit date', 'date'], ['location', 'Location'],
  ]),
  ...recordSources('audit', 'audit', 'Audit', 'app3_audit.audits', ['audit'], [['reference_number', 'Reference number'], ['workflow_state', 'Workflow state']]),
  ...recordSources('audit', 'audit_finding', 'Audit finding', 'app3_audit.audit_findings', ['audit_finding'], [
    ['classification', 'Classification'], ['priority', 'Priority'], ['risk_level', 'Risk level'],
    ['description', 'Description'], ['responsible_department', 'Responsible department'],
  ]),
  ...recordSources('audit', 'car', 'Corrective action report', 'app3_audit.corrective_action_reports', ['corrective_action_report'], [
    ['root_cause', 'Root cause'], ['correction', 'Correction'], ['corrective_action', 'Corrective action'],
    ['due_date', 'Due date', 'date'], ['extension_due_date', 'Extension due date', 'date'],
  ]),
  ...systemSources('qaqc'),
  ...recordSources('qaqc', 'metric', 'Monthly metric entry', 'app1_qaqc.qaqc_metric_entries', ['metric'], [
    ['reference_number', 'Reference number'], ['category', 'Category'], ['reporting_period', 'Reporting period', 'date'],
    ['issued_count', 'Issued count', 'integer'], ['closed_count', 'Closed count', 'integer'],
  ]),
  ...recordSources('qaqc', 'material_inspection', 'Material inspection', 'app1_qaqc.material_inspection_entries', ['material_inspection'], [
    ['reporting_period', 'Reporting period', 'date'], ['mirn_total', 'MIRN total', 'integer'], ['rejected_count', 'Rejected count', 'integer'],
  ]),
  ...recordSources('qaqc', 'qtbt', 'Toolbox talk (QTBT)', 'app1_qaqc.qtbt_entries', ['qtbt'], [
    ['reporting_period', 'Reporting period', 'date'], ['talk_count', 'Talk count', 'integer'], ['attendance_count', 'Attendance count', 'integer'],
  ]),
  ...recordSources('qaqc', 'customer_satisfaction', 'Customer satisfaction', 'app1_qaqc.customer_satisfaction_entries', ['customer_satisfaction'], [
    ['reporting_period', 'Reporting period', 'date'], ['feedback', 'Feedback'],
  ]),
  ...recordSources('qaqc', 'quality_brief', 'Quality assessment brief', 'app1_qaqc.quality_assessment_briefs', ['quality_brief'], [
    ['reporting_period', 'Reporting period', 'date'], ['narrative', 'Narrative'], ['workflow_state', 'Workflow state'],
  ]),
  ...systemSources('docgov'),
  ...recordSources('docgov', 'document_log', 'Document governance log entry', 'app1_qaqc.document_governance_log_entries', ['document_governance'], [
    ['reporting_period', 'Reporting period', 'date'], ['entity', 'Document entity'], ['status_value', 'Status'],
    ['count', 'Count', 'integer'], ['average_review_days', 'Average review days', 'decimal'], ['pending_days', 'Pending days', 'integer'],
  ]),
];
export const sourcesForWorkspace = (ws: WorkspaceKey) => SOURCE_CATALOG.filter(s => s.workspace === ws);
export const findSource = (ws: WorkspaceKey, key: string) => SOURCE_CATALOG.find(s => s.workspace === ws && s.key === key);
export function eventsForSource(source: SourceDef, events: EventOption[]) {
  return source.eventEntities === 'all' ? events : events.filter(e => (source.eventEntities as string[]).includes(parseEvent(e.value)?.entity ?? ''));
}
export const generateToken = (ws: WorkspaceKey, source: SourceDef) => `${workspaceDef(ws).tokenPrefix}_${source.key}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
export const formatToken = (name: string) => `{${name}}`;
export const FORMAT_LABELS: Record<FormatKey, string> = {
  plain: 'Plain text (as stored)', date_dmy: 'Date: 14/03/2025', date_iso: 'Date: 2025-03-14',
  date_long: 'Date: 14 March 2025', datetime: 'Date and time: 14/03/2025 09:30',
  decimal_0: 'Whole number: 13', decimal_2: 'Two decimals: 12.75', number_grouped: 'Grouped: 1,284',
};
export function formatsForType(type: FieldType): FormatKey[] {
  if (type === 'date') return ['date_dmy', 'date_iso', 'date_long'];
  if (type === 'timestamp') return ['date_dmy', 'date_iso', 'date_long', 'datetime'];
  if (type === 'decimal') return ['decimal_2', 'decimal_0'];
  if (type === 'integer') return ['plain', 'number_grouped'];
  return ['plain'];
}
export function sampleValue(source: SourceDef, format: FormatKey) {
  if (source.origin === 'system') return ({ recipient_full_name: 'Sample Recipient', recipient_email: 'recipient@example.test', actor_full_name: 'Sample Actor', creator_full_name: 'Sample Creator', approver_full_name: 'Sample Approver', system_name: 'QMS360' } as Record<string, string>)[source.key] ?? 'Sample value';
  return ({ date_dmy: '14/03/2025', date_iso: '2025-03-14', date_long: '14 March 2025', datetime: '14/03/2025 09:30', decimal_0: '13', decimal_2: '12.75', number_grouped: '1,284' } as Record<string, string>)[format] ?? (source.type === 'integer' ? '1284' : `Sample ${source.fieldLabel.toLowerCase()}`);
}
export type PlaceholderDraft = {
  id: string; workspace: WorkspaceKey; sourceKey: string; name: string; applicability: 'all' | 'selected';
  eventIds: string[]; format: FormatKey; fallback: string; description: string; createdAt: string; updatedAt: string;
};
export type PlaceholderDefinition = PlaceholderDraft & { active: boolean };
export type WizardState = Omit<PlaceholderDraft, 'id' | 'createdAt' | 'updatedAt' | 'workspace' | 'name'> & { workspace: WorkspaceKey | '' };
export const DEFAULT_FALLBACK = 'Not available';
export const BUILT_IN_PLACEHOLDERS: readonly string[] = emailTemplateFields;
export const WIZARD_STEPS = ['Workspace', 'Source field', 'Applicability', 'Formatting', 'Review'] as const;
export const blankWizardState = (workspace: WorkspaceKey | '' = ''): WizardState => ({ workspace, sourceKey: '', applicability: 'all', eventIds: [], format: 'plain', fallback: DEFAULT_FALLBACK, description: '' });
export const changeWorkspace = (state: WizardState, ws: WorkspaceKey) => state.workspace === ws ? state : blankWizardState(ws);
export function changeSource(state: WizardState, sourceKey: string, events: EventOption[]): WizardState {
  const source = state.workspace ? findSource(state.workspace, sourceKey) : undefined;
  if (!source) return { ...state, sourceKey: '', eventIds: [] };
  const allowed = new Set(eventsForSource(source, events).map(e => e.value));
  const formats = formatsForType(source.type);
  return { ...state, sourceKey, eventIds: state.eventIds.filter(id => allowed.has(id)), format: formats.includes(state.format) ? state.format : formats[0] };
}
export function validateStep(step: number, state: WizardState, events: EventOption[], drafts: PlaceholderDraft[], editingId: string | null) {
  const errors: string[] = [];
  const source = state.workspace ? findSource(state.workspace, state.sourceKey) : undefined;
  if (!state.workspace) errors.push('Choose a workspace.');
  if (state.workspace && !events.length) errors.push('No registered email events exist for this workspace yet.');
  if (step >= 1 && !source) errors.push('Choose an approved source field.');
  if (step >= 1 && source && state.workspace) {
    const name = generateToken(state.workspace, source);
    if (BUILT_IN_PLACEHOLDERS.includes(name)) errors.push('Built-in placeholders cannot be overwritten.');
    if (drafts.some(d => d.workspace === state.workspace && d.name === name && d.id !== editingId)) errors.push(`A draft named ${formatToken(name)} already exists in this workspace.`);
    if (!eventsForSource(source, events).length) errors.push('This source has no compatible registered events.');
  }
  if (step >= 2 && source && state.applicability === 'selected') {
    const allowed = new Set(eventsForSource(source, events).map(e => e.value));
    if (!state.eventIds.length) errors.push('Select at least one event.');
    if (state.eventIds.some(id => !allowed.has(id))) errors.push('Some selected events are no longer registered or compatible.');
  }
  if (step >= 3 && source) {
    if (!formatsForType(source.type).includes(state.format)) errors.push('Choose a format supported by this field type.');
    if (!state.fallback.trim()) errors.push('Fallback text is required.');
    if (state.fallback.length > 120) errors.push('Fallback text must be 120 characters or fewer.');
    if (/[{}]/.test(state.fallback)) errors.push('Fallback text cannot contain braces.');
    if (state.description.length > 300) errors.push('Description must be 300 characters or fewer.');
  }
  return errors;
}
export function buildDraft(state: WizardState, existing: PlaceholderDraft | null, now: string, id: string): PlaceholderDraft {
  const source = findSource(state.workspace as WorkspaceKey, state.sourceKey)!;
  return { ...state, workspace: source.workspace, sourceKey: source.key, id: existing?.id ?? id, name: generateToken(source.workspace, source), eventIds: state.applicability === 'selected' ? [...new Set(state.eventIds)].sort() : [], fallback: state.fallback.trim(), description: state.description.trim(), createdAt: existing?.createdAt ?? now, updatedAt: now };
}
export const draftToState = (d: PlaceholderDraft): WizardState => ({ workspace: d.workspace, sourceKey: d.sourceKey, applicability: d.applicability, eventIds: [...d.eventIds], format: d.format, fallback: d.fallback, description: d.description });
export function definitionMatchesEvent(d: PlaceholderDraft, eventType: string) {
  const source = findSource(d.workspace, d.sourceKey);
  const scoped = eventsForWorkspace([{ value: eventType, label: eventType }], d.workspace);
  return !!source && eventsForSource(source, scoped).length > 0 && (d.applicability === 'all'
    || d.eventIds.some(id => canonicalEmailEventType(id) === canonicalEmailEventType(eventType)));
}
export const STORAGE_VERSION = 1;
export const storageKey = (userId: string) => `qms360.emailPlaceholderDrafts.v${STORAGE_VERSION}:${encodeURIComponent(userId)}`;
export function isValidDraft(value: unknown): value is PlaceholderDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as PlaceholderDraft;
  if (!['id', 'workspace', 'sourceKey', 'name', 'format', 'fallback', 'description', 'createdAt', 'updatedAt'].every(k => typeof (d as unknown as Record<string, unknown>)[k] === 'string')) return false;
  if (!WORKSPACES.some(w => w.key === d.workspace) || !['all', 'selected'].includes(d.applicability) || !Array.isArray(d.eventIds) || !d.eventIds.every(e => typeof e === 'string')) return false;
  const source = findSource(d.workspace, d.sourceKey);
  return !!source && generateToken(d.workspace, source) === d.name && formatsForType(source.type).includes(d.format)
    && !!d.id.trim() && Number.isFinite(Date.parse(d.createdAt)) && Number.isFinite(Date.parse(d.updatedAt))
    && !!d.fallback.trim() && d.fallback.length <= 120 && !/[{}]/.test(d.fallback) && d.description.length <= 300
    && (d.applicability === 'all' ? !d.eventIds.length : d.eventIds.length > 0)
    && d.eventIds.every(e => definitionMatchesEvent(d, e));
}
export type LoadResult = { drafts: PlaceholderDraft[]; error: string | null; discarded: number };
export function parseStored(raw: string | null): LoadResult {
  if (raw === null) return { drafts: [], error: null, discarded: 0 };
  try {
    const data = JSON.parse(raw);
    if (data?.version !== STORAGE_VERSION || !Array.isArray(data?.drafts)) return { drafts: [], error: 'Stored drafts use an unrecognised format and were not loaded.', discarded: 0 };
    const drafts: PlaceholderDraft[] = data.drafts.filter(isValidDraft);
    const discarded = data.drafts.length - drafts.length;
    const duplicate = new Set(drafts.map(d => `${d.workspace}:${d.name}`)).size !== drafts.length || new Set(drafts.map(d => d.id)).size !== drafts.length;
    return { drafts, discarded, error: discarded ? `${discarded} stored draft(s) failed validation. Changes are blocked to preserve the original stored data.` : duplicate ? 'Stored drafts contain duplicate names or identities. Changes are blocked.' : null };
  } catch { return { drafts: [], error: 'Stored drafts could not be read (corrupted data).', discarded: 0 }; }
}
export const serialize = (drafts: PlaceholderDraft[]) => JSON.stringify({ version: STORAGE_VERSION, drafts });
export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export function loadDrafts(storage: StorageLike, key: string): LoadResult {
  try { return parseStored(storage.getItem(key)); } catch { return { drafts: [], error: 'Browser storage is unavailable.', discarded: 0 }; }
}
export function saveDrafts(storage: StorageLike, key: string, drafts: PlaceholderDraft[]) {
  if (!drafts.every(isValidDraft)) return 'One or more drafts failed validation; nothing was saved.';
  const payload = serialize(drafts);
  try {
    storage.setItem(key, payload);
    return storage.getItem(key) === payload ? null : 'Browser storage did not confirm the write.';
  } catch (error) { return error instanceof Error && /quota/i.test(error.name + error.message) ? 'Browser storage is full.' : 'Browser storage is unavailable.'; }
}
