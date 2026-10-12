import { describe, expect, it } from 'vitest';
import {
  SOURCE_CATALOG, blankWizardState, buildDraft, changeSource, changeWorkspace,
  eventsForSource, eventsForWorkspace, findSource, formatsForType, generateToken,
  isValidDraft, loadDrafts, parseStored, saveDrafts, serialize, storageKey, validateStep,
} from './email-placeholder-model';

const events = [
  { value: 'lessons.lesson_form.create', label: 'Create lesson' },
  { value: 'lessons.lesson_form.submit', label: 'Submit lesson' },
  { value: 'lessons.field_controls.update', label: 'Change controls' },
  { value: 'audit.audit_plan.create', label: 'Create plan' },
  { value: 'audit.audit_schedule.submit', label: 'Submit schedule' },
  { value: 'qaqc.metric.create', label: 'Create metric' },
  { value: 'qaqc.document_governance.create', label: 'Create document log' },
  { value: 'invalid', label: 'Malformed event' },
];
const lessonEvents = eventsForWorkspace(events, 'lessons');
const state = {
  ...blankWizardState('lessons'),
  sourceKey: 'lesson_form_title',
};
const now = '2026-10-12T09:00:00.000Z';
const draft = buildDraft(state, null, now, 'test-draft');
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

describe('Email placeholder wizard scope and sources', () => {
  it('keeps Lessons events separate from all other workspaces', () => {
    expect(lessonEvents.map(e => e.value)).toEqual([
      'lessons.lesson_form.create', 'lessons.lesson_form.submit', 'lessons.field_controls.update',
    ]);
  });
  it('separates Document governance from QA/QC although they share a backend app', () => {
    expect(eventsForWorkspace(events, 'docgov').map(e => e.value)).toEqual(['qaqc.document_governance.create']);
    expect(eventsForWorkspace(events, 'qaqc').map(e => e.value)).toEqual(['qaqc.metric.create']);
  });
  it('only allows entity fields on compatible entity events', () => {
    expect(eventsForSource(findSource('lessons', 'lesson_form_title')!, lessonEvents).map(e => e.value))
      .toEqual(['lessons.lesson_form.create', 'lessons.lesson_form.submit']);
  });
  it('offers system sources within the selected workspace only', () => {
    expect(eventsForSource(findSource('lessons', 'recipient_full_name')!, lessonEvents)).toEqual(lessonEvents);
    expect(findSource('audit', 'lesson_form_title')).toBeUndefined();
  });
  it('generates stable workspace-prefixed tokens', () => {
    expect(generateToken('lessons', findSource('lessons', 'lesson_form_title')!)).toBe('lessons_lesson_form_title');
    const names = SOURCE_CATALOG.map(source => generateToken(source.workspace, source));
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(name => /^[a-z][a-z0-9_]*$/.test(name))).toBe(true);
  });
  it('clears incompatible state on a workspace change', () => {
    expect(changeWorkspace({ ...state, description: 'Draft', eventIds: ['lessons.lesson_form.submit'] }, 'audit'))
      .toEqual(blankWizardState('audit'));
  });
  it('resets an unsupported format when changing source', () => {
    expect(changeSource({ ...state, format: 'datetime' }, 'lesson_form_title', lessonEvents).format).toBe('plain');
    expect(formatsForType('text')).toEqual(['plain']);
    expect(formatsForType('timestamp')).toContain('datetime');
  });
});

describe('Email placeholder wizard validation', () => {
  it('validates each step and accepts a complete approved mapping', () => {
    expect(validateStep(0, blankWizardState(), [], [], null)).toContain('Choose a workspace.');
    expect(validateStep(1, blankWizardState('lessons'), lessonEvents, [], null)).toContain('Choose an approved source field.');
    expect(validateStep(4, state, lessonEvents, [], null)).toEqual([]);
  });
  it('blocks workspaces with no registered events', () => {
    expect(validateStep(0, state, [], [], null).join(' ')).toContain('No registered email events');
  });
  it('blocks duplicates but allows editing the same draft', () => {
    expect(validateStep(4, state, lessonEvents, [draft], null).join(' ')).toContain('already exists');
    expect(validateStep(4, state, lessonEvents, [draft], draft.id)).toEqual([]);
  });
  it('requires event selection and rejects cross-workspace and configuration events for record fields', () => {
    expect(validateStep(4, { ...state, applicability: 'selected', eventIds: [] }, lessonEvents, [], null).join(' ')).toContain('at least one event');
    for (const eventId of ['audit.audit_plan.create', 'lessons.field_controls.update', 'lessons.lesson_form.unknown']) {
      expect(validateStep(4, { ...state, applicability: 'selected', eventIds: [eventId] }, lessonEvents, [], null).join(' ')).toContain('no longer registered or compatible');
    }
  });
  it('rejects arbitrary paths and incompatible formats', () => {
    expect(validateStep(4, { ...state, sourceKey: 'users.password' }, lessonEvents, [], null).join(' ')).toContain('approved source');
    expect(validateStep(4, { ...state, format: 'decimal_2' }, lessonEvents, [], null).join(' ')).toContain('format supported');
  });
  it('validates fallback and description lengths', () => {
    for (const fallback of ['', '  ', '{recipient_name}', 'x'.repeat(121)]) {
      expect(validateStep(4, { ...state, fallback }, lessonEvents, [], null).length).toBeGreaterThan(0);
    }
    expect(validateStep(4, { ...state, description: 'x'.repeat(301) }, lessonEvents, [], null).join(' ')).toContain('300');
  });
  it('preserves identity on edit and deduplicates selected events', () => {
    const edited = buildDraft({ ...state, applicability: 'selected', eventIds: ['lessons.lesson_form.submit', 'lessons.lesson_form.submit'] }, draft, '2026-10-13T00:00:00Z', 'unused');
    expect(edited.id).toBe(draft.id);
    expect(edited.createdAt).toBe(now);
    expect(edited.eventIds).toEqual(['lessons.lesson_form.submit']);
  });
});

describe('Browser-local draft persistence', () => {
  it('persists and reloads a validated draft and isolates administrator identities', () => {
    const storage = memory();
    expect(saveDrafts(storage, storageKey('admin-a'), [draft])).toBeNull();
    expect(loadDrafts(storage, storageKey('admin-a')).drafts).toEqual([draft]);
    expect(loadDrafts(storage, storageKey('admin-b')).drafts).toEqual([]);
  });
  it('accepts valid data and rejects altered token, source, type and event scope', () => {
    expect(isValidDraft(draft)).toBe(true);
    for (const patch of [
      { name: 'recipient_name' }, { sourceKey: 'arbitrary' }, { format: 'datetime' },
      { createdAt: 'invalid' }, { fallback: '' }, { description: 'x'.repeat(301) },
      { applicability: 'selected', eventIds: ['audit.audit_plan.create'] },
      { applicability: 'selected', eventIds: ['lessons.field_controls.update'] },
    ]) {
      expect(isValidDraft({ ...draft, ...patch })).toBe(false);
    }
  });
  it('reports malformed JSON and unknown storage versions without throwing', () => {
    expect(parseStored('{bad').error).toContain('corrupted');
    expect(parseStored('{"version":999,"drafts":[]}').error).toContain('unrecognised');
    expect(parseStored(null)).toEqual({ drafts: [], error: null, discarded: 0 });
  });
  it('flags invalid and duplicate stored drafts so the UI can block overwrites', () => {
    expect(parseStored(serialize([{ ...draft, name: 'bad' }])).error).toContain('blocked');
    expect(parseStored(serialize([draft, draft])).error).toContain('duplicate');
  });
  it('reports unavailable or full storage and unconfirmed writes', () => {
    const broken = { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); } };
    expect(loadDrafts(broken, 'key').error).toContain('unavailable');
    expect(saveDrafts(broken, 'key', [draft])).toContain('unavailable');
    expect(saveDrafts({ getItem: () => null, setItem: () => {} }, 'key', [draft])).toContain('confirm');
    const quota = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveDrafts(quota, 'key', [draft])).toContain('full');
  });
  it('rejects invalid draft data before writing', () => {
    const storage = memory();
    expect(saveDrafts(storage, 'key', [{ ...draft, name: 'bad' }])).toContain('nothing was saved');
    expect(storage.getItem('key')).toBeNull();
  });
});
