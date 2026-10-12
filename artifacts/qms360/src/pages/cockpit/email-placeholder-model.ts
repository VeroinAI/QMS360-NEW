// Pure model for the administrator-local Email Placeholder Wizard (draft phase).
// No React, no network. Drafts are never read by live email rendering.
import { emailTemplateFields } from '@workspace/field-controls';

export type WorkspaceKey = 'lessons' | 'audit' | 'qaqc' | 'docgov';
export type FieldType = 'text' | 'date' | 'timestamp' | 'decimal' | 'integer';
export type FormatKey = 'plain' | 'date_dmy' | 'date_iso' | 'date_long' | 'datetime' | 'decimal_0' | 'decimal_2' | 'number_grouped';

export type WorkspaceDef = { key: WorkspaceKey; label: string; tokenPrefix: string; app: string; blurb: string };

export const WORKSPACES: WorkspaceDef[] = [
  { key: 'lessons', label: 'Lessons Learned', tokenPrefix: 'lessons', app: 'lessons', blurb: 'Lesson learned forms raised, submitted, reviewed and transferred.' },
  { key: 'audit', label: 'QMS Audit', tokenPrefix: 'audit', app: 'audit', blurb: 'Audit programmes, schedules, plans, audits, findings and corrective actions.' },
  { key: 'qaqc', label: 'QA/QC', tokenPrefix: 'qaqc', app: 'qaqc', blurb: 'Monthly metrics, material inspections, toolbox talks, satisfaction and quality briefs.' },
  { key: 'docgov', label: 'Document governance', tokenPrefix: 'docgov', app: 'qaqc', blurb: 'Document governance log entries recorded in the QA/QC application.' },
];

export function workspaceDef(key: WorkspaceKey) {
  return WORKSPACES.find((w) => w.key === key)!;
}

export type EventOption = { value: string; label: string };

/** Splits "app.entity.action"; returns null for malformed values. */
export function parseEvent(value: string) {
  const parts = value.split('.');
  if (parts.length < 3 || parts.some((p) => !p)) return null;
  return { app: parts[0], entity: parts[1], action: parts.slice(2).join('.') };
}

export function eventsForWorkspace(events: EventOption[], ws: WorkspaceKey): EventOption[] {
  const def = workspaceDef(ws);
  return events.filter((e) => {
    const p = parseEvent(e.value);
    if (!p || p.app !== def.app) return false;
    if (ws === 'docgov') return p.entity === 'document_governance';
    if (ws === 'qaqc') return p.entity !== 'document_governance';
    return true;
  });
}

export type SourceDef = {
  key: string;            // stable catalog key, used for token generation
  workspace: WorkspaceKey;
  origin: 'record' | 'system';
  entityLabel: string;
  fieldLabel: string;
  schemaRef: string;      // verified schema column reference (informational only)
  type: FieldType;
  description: string;
  eventEntities: string[] | 'all'; // event entity segments this source is valid for
};

type Rec = [entitySlug: string, fieldSlug: string, fieldLabel: string, column: string, type: FieldType, description: string];
function rec(ws: WorkspaceKey, entityLabel: string, table: string, eventEntities: string[], rows: Rec[]): SourceDef[] {
  return rows.map(([entitySlug, fieldSlug, fieldLabel, column, type, description]) => ({
    key: `${entitySlug}_${fieldSlug}`, workspace: ws, origin: 'record', entityLabel, fieldLabel,
    schemaRef: `${table}.${column}`, type, description, eventEntities,
  }));
}

const SYSTEM_ROWS: Array<[string, string, string]> = [
  ['recipient_full_name', 'Recipient full name', 'Full name of the person receiving this email.'],
  ['recipient_email', 'Recipient email', 'Email address of the person receiving this email.'],
  ['actor_full_name', 'Actor full name', 'Full name of the user whose action triggered the event.'],
  ['creator_full_name', 'Creator full name', 'Full name of the user who created the record.'],
  ['system_name', 'System name', 'Product name used as the email signature.'],
];
function system(ws: WorkspaceKey): SourceDef[] {
  return SYSTEM_ROWS.map(([key, fieldLabel, description]) => ({
    key, workspace: ws, origin: 'system', entityLabel: 'System context', fieldLabel,
    schemaRef: key === 'system_name' ? 'system.name' : `shared.users.${key.includes('email') ? 'email' : 'full_name'}`,
    type: 'text', description, eventEntities: 'all',
  }));
}

const LL = 'app2_lessons.lesson_learned_forms';
export const SOURCE_CATALOG: SourceDef[] = [
  ...system('lessons'),
  ...rec('lessons', 'Lesson learned form', LL, ['lesson_form'], [
    ['lesson_form', 'reference_number', 'Reference number', 'reference_number', 'text', 'Generated reference of the lesson form.'],
    ['lesson_form', 'title', 'Title', 'title', 'text', 'Short title entered by the originator.'],
    ['lesson_form', 'categorisation', 'Categorisation', 'categorisation', 'text', 'Categorisation chosen on the form.'],
    ['lesson_form', 'issue_category', 'Issue category', 'issue_category', 'text', 'Issue category of the lesson.'],
    ['lesson_form', 'impact', 'Impact', 'impact', 'text', 'Impact statement.'],
    ['lesson_form', 'description', 'Description', 'description', 'text', 'Narrative description of what happened.'],
    ['lesson_form', 'root_cause', 'Root cause', 'root_cause', 'text', 'Identified root cause.'],
    ['lesson_form', 'corrective_action', 'Corrective action', 'corrective_action', 'text', 'Corrective action recorded.'],
    ['lesson_form', 'captured_at', 'Captured at', 'captured_at', 'timestamp', 'When the lesson was captured.'],
    ['lesson_form', 'submitted_at', 'Submitted at', 'submitted_at', 'timestamp', 'When the form was submitted for review.'],
    ['lesson_form', 'reviewed_at', 'Reviewed at', 'reviewed_at', 'timestamp', 'When the reviewer acted.'],
    ['lesson_form', 'review_comments', 'Review comments', 'review_comments', 'text', 'Comments left by the reviewer.'],
    ['lesson_form', 'repeat_count', 'Repeat count', 'repeat_count', 'integer', 'How many times this issue has repeated.'],
  ]),
  ...system('audit'),
  ...rec('audit', 'Audit programme / schedule', 'app3_audit.audit_schedules', ['audit_programme', 'audit_schedule'], [
    ['audit_schedule', 'title', 'Title', 'title', 'text', 'Title of the yearly programme / schedule.'],
    ['audit_schedule', 'year', 'Year', 'year', 'integer', 'Programme year.'],
    ['audit_schedule', 'workflow_state', 'Workflow state', 'workflow_state', 'text', 'Current approval state.'],
  ]),
  ...rec('audit', 'Audit plan', 'app3_audit.audit_plans', ['audit_plan'], [
    ['audit_plan', 'scope', 'Scope', 'scope', 'text', 'Scope of the planned audit.'],
    ['audit_plan', 'criteria', 'Criteria', 'criteria', 'text', 'Audit criteria.'],
    ['audit_plan', 'audit_date', 'Audit date', 'audit_date', 'date', 'Planned audit date.'],
    ['audit_plan', 'location', 'Location', 'location', 'text', 'Where the audit takes place.'],
  ]),
  ...rec('audit', 'Audit', 'app3_audit.audits', ['audit'], [
    ['audit', 'reference_number', 'Reference number', 'reference_number', 'text', 'Audit reference number.'],
    ['audit', 'workflow_state', 'Workflow state', 'workflow_state', 'text', 'Current audit state.'],
  ]),
  ...rec('audit', 'Audit finding', 'app3_audit.audit_findings', ['audit_finding'], [
    ['audit_finding', 'classification', 'Classification', 'classification', 'text', 'Finding classification.'],
    ['audit_finding', 'priority', 'Priority', 'priority', 'text', 'Finding priority.'],
    ['audit_finding', 'risk_level', 'Risk level', 'risk_level', 'text', 'Assessed risk level.'],
    ['audit_finding', 'description', 'Description', 'description', 'text', 'Finding description.'],
    ['audit_finding', 'responsible_department', 'Responsible department', 'responsible_department', 'text', 'Department responsible for the finding.'],
  ]),
  ...rec('audit', 'Corrective action report', 'app3_audit.corrective_action_reports', ['corrective_action_report'], [
    ['car', 'root_cause', 'Root cause', 'root_cause', 'text', 'Root cause stated on the CAR.'],
    ['car', 'correction', 'Correction', 'correction', 'text', 'Immediate correction.'],
    ['car', 'corrective_action', 'Corrective action', 'corrective_action', 'text', 'Corrective action planned.'],
    ['car', 'due_date', 'Due date', 'due_date', 'date', 'Current due date.'],
    ['car', 'extension_due_date', 'Extension due date', 'extension_due_date', 'date', 'Requested extension date.'],
  ]),
  ...system('qaqc'),
  ...rec('qaqc', 'Monthly metric entry', 'app1_qaqc.qaqc_metric_entries', ['metric'], [
    ['metric', 'reference_number', 'Reference number', 'reference_number', 'text', 'Metric entry reference.'],
    ['metric', 'category', 'Category', 'category', 'text', 'Metric category.'],
    ['metric', 'reporting_period', 'Reporting period', 'reporting_period', 'date', 'Reporting month.'],
    ['metric', 'issued_count', 'Issued count', 'issued_count', 'integer', 'Items issued in the period.'],
    ['metric', 'closed_count', 'Closed count', 'closed_count', 'integer', 'Items closed in the period.'],
  ]),
  ...rec('qaqc', 'Material inspection', 'app1_qaqc.material_inspection_entries', ['material_inspection'], [
    ['material_inspection', 'reporting_period', 'Reporting period', 'reporting_period', 'date', 'Reporting month.'],
    ['material_inspection', 'mirn_total', 'MIRN total', 'mirn_total', 'integer', 'Total material inspection requests.'],
    ['material_inspection', 'rejected_count', 'Rejected count', 'rejected_count', 'integer', 'Rejected inspections.'],
  ]),
  ...rec('qaqc', 'Toolbox talk (QTBT)', 'app1_qaqc.qtbt_entries', ['qtbt'], [
    ['qtbt', 'reporting_period', 'Reporting period', 'reporting_period', 'date', 'Reporting month.'],
    ['qtbt', 'talk_count', 'Talk count', 'talk_count', 'integer', 'Number of talks held.'],
    ['qtbt', 'attendance_count', 'Attendance count', 'attendance_count', 'integer', 'Total attendance.'],
  ]),
  ...rec('qaqc', 'Customer satisfaction', 'app1_qaqc.customer_satisfaction_entries', ['customer_satisfaction'], [
    ['customer_satisfaction', 'reporting_period', 'Reporting period', 'reporting_period', 'date', 'Reporting month.'],
    ['customer_satisfaction', 'feedback', 'Feedback', 'feedback', 'text', 'Customer feedback text.'],
  ]),
  ...rec('qaqc', 'Quality assessment brief', 'app1_qaqc.quality_assessment_briefs', ['quality_brief'], [
    ['quality_brief', 'reporting_period', 'Reporting period', 'reporting_period', 'date', 'Brief reporting month.'],
    ['quality_brief', 'narrative', 'Narrative', 'narrative', 'text', 'Approved narrative text.'],
    ['quality_brief', 'workflow_state', 'Workflow state', 'workflow_state', 'text', 'Current brief state.'],
  ]),
  ...system('docgov'),
  ...rec('docgov', 'Document governance log entry', 'app1_qaqc.document_governance_log_entries', ['document_governance'], [
    ['document_log', 'reporting_period', 'Reporting period', 'reporting_period', 'date', 'Reporting month.'],
    ['document_log', 'entity', 'Document entity', 'entity', 'text', 'Document type tracked (for example drawings).'],
    ['document_log', 'status_value', 'Status', 'status_value', 'text', 'Status bucket being counted.'],
    ['document_log', 'count', 'Count', 'count', 'integer', 'Documents in this status.'],
    ['document_log', 'average_review_days', 'Average review days', 'average_review_days', 'decimal', 'Average review duration in days.'],
    ['document_log', 'pending_days', 'Pending days', 'pending_days', 'integer', 'Days pending.'],
  ]),
];

export function sourcesForWorkspace(ws: WorkspaceKey) {
  return SOURCE_CATALOG.filter((s) => s.workspace === ws);
}
export function findSource(ws: WorkspaceKey, key: string) {
  return SOURCE_CATALOG.find((s) => s.workspace === ws && s.key === key);
}

/** Registered events (already workspace-filtered) on which a source can resolve. */
export function eventsForSource(source: SourceDef, wsEvents: EventOption[]) {
  if (source.eventEntities === 'all') return wsEvents;
  const allowed = source.eventEntities;
  return wsEvents.filter((e) => allowed.includes(parseEvent(e.value)?.entity ?? ''));
}

export function generateToken(ws: WorkspaceKey, source: SourceDef) {
  return `${workspaceDef(ws).tokenPrefix}_${source.key}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}
export const formatToken = (name: string) => `{${name}}`;

export const FORMAT_LABELS: Record<FormatKey, string> = {
  plain: 'Plain text (as stored)',
  date_dmy: 'Date: 14/03/2025',
  date_iso: 'Date: 2025-03-14',
  date_long: 'Date: 14 March 2025',
  datetime: 'Date and time: 14/03/2025 09:30',
  decimal_0: 'Whole number: 13',
  decimal_2: 'Two decimals: 12.75',
  number_grouped: 'Grouped: 1,284',
};
export function formatsForType(type: FieldType): FormatKey[] {
  switch (type) {
    case 'date': return ['date_dmy', 'date_iso', 'date_long'];
    case 'timestamp': return ['date_dmy', 'date_iso', 'date_long', 'datetime'];
    case 'decimal': return ['decimal_2', 'decimal_0'];
    case 'integer': return ['plain', 'number_grouped'];
    default: return ['plain'];
  }
}

/** Fixed illustrative values only; never real records. */
export function sampleValue(source: SourceDef, format: FormatKey) {
  if (source.origin === 'system') {
    return { recipient_full_name: 'Sample Recipient', recipient_email: 'recipient@example.test', actor_full_name: 'Sample Actor', creator_full_name: 'Sample Creator', system_name: 'QMS360' }[source.key] ?? 'Sample value';
  }
  switch (format) {
    case 'date_dmy': return '14/03/2025';
    case 'date_iso': return '2025-03-14';
    case 'date_long': return '14 March 2025';
    case 'datetime': return '14/03/2025 09:30';
    case 'decimal_0': return '13';
    case 'decimal_2': return '12.75';
    case 'number_grouped': return '1,284';
    default: return source.type === 'integer' ? '1284' : `Sample ${source.fieldLabel.toLowerCase()}`;
  }
}

export type PlaceholderDraft = {
  id: string;
  workspace: WorkspaceKey;
  sourceKey: string;
  name: string;
  applicability: 'all' | 'selected';
  eventIds: string[];
  format: FormatKey;
  fallback: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type WizardState = Omit<PlaceholderDraft, 'id' | 'createdAt' | 'updatedAt' | 'workspace' | 'sourceKey' | 'name'> & {
  workspace: WorkspaceKey | '';
  sourceKey: string;
};
export const DEFAULT_FALLBACK = 'Not available';
export const blankWizardState = (workspace: WorkspaceKey | '' = ''): WizardState => ({
  workspace, sourceKey: '', applicability: 'all', eventIds: [], format: 'plain', fallback: DEFAULT_FALLBACK, description: '',
});

/** Resets selections that are not valid for the new workspace. */
export function changeWorkspace(state: WizardState, ws: WorkspaceKey): WizardState {
  return state.workspace === ws ? state : blankWizardState(ws);
}
/** Resets format/event choices that the new source does not support. */
export function changeSource(state: WizardState, sourceKey: string, wsEvents: EventOption[]): WizardState {
  if (!state.workspace) return state;
  const src = findSource(state.workspace, sourceKey);
  if (!src) return { ...state, sourceKey: '', eventIds: [] };
  const allowed = new Set(eventsForSource(src, wsEvents).map((e) => e.value));
  const formats = formatsForType(src.type);
  return { ...state, sourceKey, eventIds: state.eventIds.filter((id) => allowed.has(id)), format: formats.includes(state.format) ? state.format : formats[0] };
}

export const BUILT_IN_PLACEHOLDERS: readonly string[] = emailTemplateFields;
export const WIZARD_STEPS = ['Workspace', 'Source field', 'Applicability', 'Formatting', 'Review'] as const;

export function validateStep(step: number, state: WizardState, wsEvents: EventOption[], drafts: PlaceholderDraft[], editingId: string | null): string[] {
  const errors: string[] = [];
  const src = state.workspace ? findSource(state.workspace, state.sourceKey) : undefined;
  if (step >= 0 && !state.workspace) errors.push('Choose a workspace.');
  if (step >= 0 && state.workspace && wsEvents.length === 0) errors.push('No registered email events exist for this workspace yet. Drafts cannot be created until events are registered.');
  if (step >= 1 && !src) errors.push('Choose an approved source field.');
  if (step >= 1 && src && state.workspace) {
    const name = generateToken(state.workspace, src);
    if (BUILT_IN_PLACEHOLDERS.includes(name)) errors.push(`${formatToken(name)} is a built-in placeholder and cannot be overwritten.`);
    if (drafts.some((d) => d.workspace === state.workspace && d.name === name && d.id !== editingId)) errors.push(`A draft named ${formatToken(name)} already exists in this workspace.`);
    if (eventsForSource(src, wsEvents).length === 0) errors.push('This source has no compatible registered events.');
  }
  if (step >= 2 && src && state.applicability === 'selected') {
    const allowed = new Set(eventsForSource(src, wsEvents).map((e) => e.value));
    if (state.eventIds.length === 0) errors.push('Select at least one event.');
    if (state.eventIds.some((id) => !allowed.has(id))) errors.push('Some selected events are no longer registered or compatible.');
  }
  if (step >= 3 && src) {
    if (!formatsForType(src.type).includes(state.format)) errors.push('Choose a format supported by this field type.');
    if (!state.fallback.trim()) errors.push('Fallback text is required.');
    if (state.fallback.length > 120) errors.push('Fallback text must be 120 characters or fewer.');
    if (/[{}]/.test(state.fallback)) errors.push('Fallback text cannot contain braces.');
    if (state.description.length > 300) errors.push('Description must be 300 characters or fewer.');
  }
  return errors;
}

export function buildDraft(state: WizardState, existing: PlaceholderDraft | null, now: string, id: string): PlaceholderDraft {
  const ws = state.workspace as WorkspaceKey;
  const src = findSource(ws, state.sourceKey)!;
  return {
    id: existing?.id ?? id, workspace: ws, sourceKey: src.key, name: generateToken(ws, src),
    applicability: state.applicability, eventIds: state.applicability === 'selected' ? [...new Set(state.eventIds)].sort() : [],
    format: state.format, fallback: state.fallback.trim(), description: state.description.trim(),
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
}
export function draftToState(d: PlaceholderDraft): WizardState {
  return { workspace: d.workspace, sourceKey: d.sourceKey, applicability: d.applicability, eventIds: [...d.eventIds], format: d.format, fallback: d.fallback, description: d.description };
}

// ---------------------------------------------------------------- storage
export const STORAGE_VERSION = 1;
export function storageKey(userId: string) {
  // User IDs are unique and organization-bound; names can change without losing drafts.
  return `qms360.emailPlaceholderDrafts.v${STORAGE_VERSION}:${encodeURIComponent(userId)}`;
}

const WS_KEYS = new Set(WORKSPACES.map((w) => w.key));
const FORMAT_KEYS = new Set(Object.keys(FORMAT_LABELS));
export function isValidDraft(v: unknown): v is PlaceholderDraft {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  const str = (k: string) => typeof d[k] === 'string';
  if (!['id', 'workspace', 'sourceKey', 'name', 'format', 'fallback', 'description', 'createdAt', 'updatedAt'].every(str)) return false;
  if (!WS_KEYS.has(d.workspace as WorkspaceKey) || !FORMAT_KEYS.has(d.format as string)) return false;
  if (d.applicability !== 'all' && d.applicability !== 'selected') return false;
  if (!Array.isArray(d.eventIds) || !d.eventIds.every((e) => typeof e === 'string')) return false;
  const src = findSource(d.workspace as WorkspaceKey, d.sourceKey as string);
  if (!src || generateToken(d.workspace as WorkspaceKey, src) !== d.name) return false;
  if (!formatsForType(src.type).includes(d.format as FormatKey)) return false;
  if (!(d.id as string).trim() || !Number.isFinite(Date.parse(d.createdAt as string)) || !Number.isFinite(Date.parse(d.updatedAt as string))) return false;
  if (!(d.fallback as string).trim() || (d.fallback as string).length > 120 || /[{}]/.test(d.fallback as string) || (d.description as string).length > 300) return false;
  if (d.applicability === 'all' && d.eventIds.length !== 0) return false;
  if (d.applicability === 'selected' && d.eventIds.length === 0) return false;
  const scoped = eventsForWorkspace((d.eventIds as string[]).map(value => ({ value, label: value })), d.workspace as WorkspaceKey);
  return scoped.length === d.eventIds.length && eventsForSource(src, scoped).length === d.eventIds.length;
}

export type LoadResult = { drafts: PlaceholderDraft[]; error: string | null; discarded: number };
export function parseStored(raw: string | null): LoadResult {
  if (raw == null) return { drafts: [], error: null, discarded: 0 };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== STORAGE_VERSION || !Array.isArray((parsed as { drafts?: unknown }).drafts)) {
      return { drafts: [], error: 'Stored drafts use an unrecognised format and were not loaded.', discarded: 0 };
    }
    const all = (parsed as { drafts: unknown[] }).drafts;
    const drafts = all.filter(isValidDraft);
    const discarded = all.length - drafts.length;
    const duplicates = new Set(drafts.map(d => `${d.workspace}:${d.name}`)).size !== drafts.length
      || new Set(drafts.map(d => d.id)).size !== drafts.length;
    return { drafts, error: discarded ? `${discarded} stored draft(s) failed validation. Changes are blocked to preserve the original stored data.` : duplicates ? 'Stored drafts contain duplicate names or identities. Changes are blocked to preserve the original stored data.' : null, discarded };
  } catch {
    return { drafts: [], error: 'Stored drafts could not be read (corrupted data).', discarded: 0 };
  }
}
export function serialize(drafts: PlaceholderDraft[]) {
  return JSON.stringify({ version: STORAGE_VERSION, drafts });
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function loadDrafts(storage: StorageLike, key: string): LoadResult {
  try { return parseStored(storage.getItem(key)); } catch { return { drafts: [], error: 'Browser storage is unavailable.', discarded: 0 }; }
}
/** Writes and reads back; returns an error message instead of silently failing. */
export function saveDrafts(storage: StorageLike, key: string, drafts: PlaceholderDraft[]): string | null {
  if (!drafts.every(isValidDraft)) return 'One or more drafts failed validation; nothing was saved.';
  const payload = serialize(drafts);
  try {
    storage.setItem(key, payload);
    if (storage.getItem(key) !== payload) return 'Browser storage did not confirm the write.';
    return null;
  } catch (e) {
    return e instanceof Error && /quota/i.test(e.name + e.message) ? 'Browser storage is full.' : 'Browser storage is unavailable.';
  }
}
