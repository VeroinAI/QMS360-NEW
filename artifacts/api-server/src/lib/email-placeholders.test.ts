import { describe, expect, it, vi } from 'vitest';
import { and, eq, getTableColumns } from 'drizzle-orm';
import {
  db, organizationSettings, lessonLearnedForms, users,
} from '@workspace/db';
import {
  SOURCE_CATALOG, blankWizardState, buildDraft, definitionMatchesEvent, unknownEmailTemplateFields,
  findSource, sampleValue, sourcesForWorkspace,
  type PlaceholderDefinition,
} from '@workspace/field-controls';
import {
  compatiblePlaceholderNames, definitionInput, listPlaceholderDefinitions,
  readPlaceholderRegistry, ruleReferencesPlaceholder, validateCustomRuleTemplate,
  registryBrandingUpdate,
} from './email-placeholder-registry';
import {
  EMAIL_PLACEHOLDER_TABLES, formatPlaceholderValue, prepareCustomPlaceholderValues, renderCustomPlaceholderValues,
} from './email-placeholder-values';
import { enqueueEmail } from './email-queue';

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const eventType = 'lessons.lesson_form.submit';
function definition(sourceKey = 'lesson_form_title', active = true): PlaceholderDefinition {
  return { ...buildDraft({ ...blankWizardState('lessons'), sourceKey }, null, '2026-10-12T12:00:00Z', sourceKey), active };
}

function fixture(definitions: PlaceholderDefinition[], extra = new Map<any, any[]>()) {
  const sqlQueries: Array<{ sql: string; params: unknown[] }> = [];
  const rows = new Map<any, any[]>([
    [organizationSettings, [{ organizationId: org, branding: { emailPlaceholders: definitions } }]],
    ...extra,
  ]);
  const fake = {
    select: (fields?: any) => ({
      from: (table: any) => {
        let condition: any;
        const chain = {
          where: (value: any) => { condition = value; return chain; },
          orderBy: () => chain,
          limit: async () => {
            const query = db.select(fields).from(table).where(condition).toSQL();
            sqlQueries.push(query);
            const matched = (rows.get(table) ?? []).filter(row =>
              (!row.organizationId || query.params.includes(row.organizationId)) && (!row.id || query.params.includes(row.id)));
            if (!fields) return matched;
            return matched.map(row => Object.fromEntries(Object.entries(fields).map(([key, column]: [string, any]) => {
              const prop = Object.entries(getTableColumns(table)).find(([, c]) => c === column)?.[0];
              return [key, prop ? row[prop] : undefined];
            })));
          },
        };
        return chain;
      },
    }),
  };
  return { fake: fake as unknown as typeof db, sqlQueries };
}

describe('Shared approved placeholder catalog', () => {
  it('every record source points to a real approved column', () => {
    for (const source of SOURCE_CATALOG.filter(s => s.origin === 'record')) {
      const parts = source.schemaRef.split('.');
      const table = EMAIL_PLACEHOLDER_TABLES[parts.slice(0, -1).join('.')];
      expect(table, source.schemaRef).toBeDefined();
      expect(Object.values(getTableColumns(table)).some(c => c.name === parts.at(-1)), source.schemaRef).toBe(true);
    }
  });
  it('keeps workspace/event boundaries including Document governance', () => {
    const d = definition();
    expect(definitionMatchesEvent(d, eventType)).toBe(true);
    expect(definitionMatchesEvent(d, 'audit.audit_plan.create')).toBe(false);
    expect(definitionMatchesEvent(d, 'lessons.field_controls.update')).toBe(false);
    expect(definitionMatchesEvent({ ...d, applicability: 'selected', eventIds: ['lessons.lesson_form.create'] }, eventType)).toBe(false);
  });
});

describe('Activation and rendering', () => {
  it('queues personalized subject/body values and deactivation changes only subsequent messages', async () => {
    const title = definition();
    const recipient = definition('recipient_full_name');
    const definitions = [title, recipient];
    const { fake } = fixture(definitions);
    const queued: Array<{ subject: string; bodyText: string }> = [];
    (fake as any).insert = () => ({ values: async (rows: any[]) => queued.push(...rows) });
    const input = {
      organizationId: org, recipientIds: [], recipients: [
        { name: 'Recipient One', email: 'one@example.test' }, { name: 'Recipient Two', email: 'two@example.test' },
      ],
      subject: 'Default', text: 'Default',
      ruleTemplate: { subjectTemplate: `{${title.name}}`, bodyTemplate: `Dear {${recipient.name}}, {${title.name}}` },
      placeholderEvent: { eventType, entityId, record: { id: entityId, organizationId: org, title: 'Saved lesson title' } },
      context: { eventType, app: 'lessons', entityId },
    };
    await expect(enqueueEmail(fake, input)).resolves.toEqual({ queued: 2 });
    expect(queued[0]).toMatchObject({ subject: 'Saved lesson title', bodyText: 'Dear Recipient One, Saved lesson title' });
    expect(queued[1].bodyText).toBe('Dear Recipient Two, Saved lesson title');
    title.active = false;
    title.fallback = 'Unavailable title';
    await enqueueEmail(fake, input);
    expect(queued[2].subject).toBe('Unavailable title');
    expect(queued[0].subject).toBe('Saved lesson title');
  });
  it('resolves active values in subject and body, but inactive definitions use fallback without reading value', () => {
    const getter = vi.fn(() => 'Actual lesson title');
    const d = definition();
    expect(renderCustomPlaceholderValues([d], eventType, getter)[d.name]).toBe('Actual lesson title');
    getter.mockClear();
    expect(renderCustomPlaceholderValues([{ ...d, active: false, fallback: 'Disabled' }], eventType, getter)[d.name]).toBe('Disabled');
    expect(getter).not.toHaveBeenCalled();
  });
  it('does not resolve cross-workspace or incompatible events', () => {
    expect(renderCustomPlaceholderValues([definition()], 'audit.audit_plan.create', () => 'private')).toEqual({});
  });
  it('does not mistake zero for an empty value', () => {
    expect(formatPlaceholderValue(0, 'plain', 'Missing')).toBe('0');
    expect(formatPlaceholderValue(0, 'decimal_2', 'Missing')).toBe('0.00');
    expect(formatPlaceholderValue(false, 'plain', 'Missing')).toBe('false');
  });
  it('uses fallback for null, empty, invalid numbers and invalid dates', () => {
    for (const v of [null, undefined, '']) expect(formatPlaceholderValue(v, 'plain', 'Missing')).toBe('Missing');
    expect(formatPlaceholderValue('bad', 'decimal_2', 'Missing')).toBe('Missing');
    expect(formatPlaceholderValue('2026-02-30', 'date_dmy', 'Missing')).toBe('Missing');
  });
  it('formats dates without changing their calendar day and formats decimal and grouped numbers', () => {
    expect(formatPlaceholderValue('2026-10-12', 'date_dmy', 'Missing')).toBe('12/10/2026');
    expect(formatPlaceholderValue('2026-10-12T09:15:00', 'datetime', 'Missing')).toBe('12/10/2026 09:15');
    expect(formatPlaceholderValue('2026-10-12', 'date_long', 'Missing')).toBe('12 October 2026');
    expect(formatPlaceholderValue('12.75', 'decimal_0', 'Missing')).toBe('13');
    expect(formatPlaceholderValue(1284, 'number_grouped', 'Missing')).toBe('1,284');
  });
  it('resolves record fields from a tenant-scoped event record query', async () => {
    const d = definition();
    const { fake, sqlQueries } = fixture([d], new Map([[lessonLearnedForms, [{ id: entityId, organizationId: org, title: 'Actual title' }]]]));
    const render = await prepareCustomPlaceholderValues(fake, org, { eventType, entityId }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'example@example.test' })[d.name]).toBe('Actual title');
    expect(sqlQueries[1].params).toContain(org);
    expect(sqlQueries[1].params).toContain(entityId);
    expect(sqlQueries[1].sql).toContain('"organization_id"');
  });
  it('ignores a foreign-organization snapshot and uses the authorized record', async () => {
    const d = definition();
    const { fake } = fixture([d], new Map([[lessonLearnedForms, [{ id: entityId, organizationId: org, title: 'Authorized' }]]]));
    const render = await prepareCustomPlaceholderValues(fake, org, {
      eventType, entityId, record: { id: entityId, organizationId: otherOrg, title: 'Foreign' },
    }, { subjectTemplate: `{${d.name}}` });
    expect(render({ email: 'example@example.test' })[d.name]).toBe('Authorized');
  });
  it('personalizes recipient name per email and falls back to email address', async () => {
    const d = definition('recipient_full_name');
    const { fake } = fixture([d]);
    const render = await prepareCustomPlaceholderValues(fake, org, { eventType }, { bodyTemplate: `{${d.name}}` });
    expect(render({ name: 'Recipient One', email: 'one@example.test' })[d.name]).toBe('Recipient One');
    expect(render({ email: 'two@example.test' })[d.name]).toBe('two@example.test');
  });
  it('resolves the actor by organization and user ID', async () => {
    const d = definition('actor_full_name');
    const { fake, sqlQueries } = fixture([d], new Map([[users, [{ id: userId, organizationId: org, fullName: 'Actor Name' }]]]));
    const render = await prepareCustomPlaceholderValues(fake, org, { eventType, actorId: userId }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'example@example.test' })[d.name]).toBe('Actor Name');
    expect(sqlQueries[1].params).toContain(org);
    expect(sqlQueries[1].params).toContain(userId);
  });
  it('does not fetch records when only inactive tokens are referenced', async () => {
    const d = definition('lesson_form_title', false);
    const { fake, sqlQueries } = fixture([d]);
    const render = await prepareCustomPlaceholderValues(fake, org, { eventType, entityId }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'example@example.test' })[d.name]).toBe('Not available');
    expect(sqlQueries).toHaveLength(1);
  });
});

describe('Registry and email rule safety', () => {
  it('keeps built-in-only emails and rules independent of the custom registry', async () => {
    const database = { select: vi.fn(() => { throw new Error('Registry unavailable'); }) } as unknown as typeof db;
    await expect(validateCustomRuleTemplate(database, org, eventType, { bodyTemplate: 'Dear {recipient_name}' })).resolves.toBeUndefined();
    const render = await prepareCustomPlaceholderValues(database, org, { eventType }, { bodyTemplate: 'Dear {recipient_name}' });
    expect(render({ email: 'example@example.test' })).toEqual({});
    expect(database.select).not.toHaveBeenCalled();
  });
  it('accepts absent registry and valid data but reports corrupted settings', () => {
    expect(readPlaceholderRegistry({ unrelated: 'preserve' })).toEqual([]);
    expect(readPlaceholderRegistry({ emailPlaceholders: [definition()] })).toHaveLength(1);
    expect(() => readPlaceholderRegistry({ emailPlaceholders: [{ active: 'true' }] })).toThrow('invalid');
  });
  it('scopes registry reads to requesting organization', async () => {
    const { fake, sqlQueries } = fixture([definition()]);
    expect(await listPlaceholderDefinitions(fake, otherOrg)).toEqual([]);
    expect(sqlQueries[0].params).toContain(otherOrg);
  });
  it('recognizes custom references with both brace styles in subject or body', () => {
    const name = definition().name;
    expect(ruleReferencesPlaceholder({ recipientConfig: { subjectTemplate: `Hello {{ ${name.toUpperCase()} }}` } }, name)).toBe(true);
    expect(ruleReferencesPlaceholder({ recipientConfig: { bodyTemplate: `{${name}}` } }, name)).toBe(true);
    expect(ruleReferencesPlaceholder({ recipientConfig: { bodyTemplate: `{${name}_other}` } }, name)).toBe(false);
  });
  it('permits inactive compatible references without permitting them in other modules', () => {
    const d = definition('lesson_form_title', false);
    expect(compatiblePlaceholderNames([d], eventType)).toEqual([d.name]);
    expect(compatiblePlaceholderNames([d], 'audit.audit_plan.create')).toEqual([]);
    expect(unknownEmailTemplateFields(`{${d.name}}`, [d.name])).toEqual([]);
    expect(unknownEmailTemplateFields('{recipient_name}')).toEqual([]);
  });
  it('rejects unknown and cross-workspace tokens when saving rules', async () => {
    const d = definition();
    const { fake } = fixture([d]);
    await expect(validateCustomRuleTemplate(fake, org, eventType, { bodyTemplate: `{${d.name}}` })).resolves.toBeUndefined();
    await expect(validateCustomRuleTemplate(fake, org, 'audit.audit_plan.create', { bodyTemplate: `{${d.name}}` })).rejects.toThrow('incompatible');
    await expect(validateCustomRuleTemplate(fake, org, eventType, { bodyTemplate: '{unknown}' })).rejects.toThrow('unknown');
  });
  it('import equivalence excludes active status, ID and server timestamps', () => {
    const d = definition();
    expect(definitionInput(d)).toBe(definitionInput({ ...d, id: 'other', active: false, updatedAt: '2026-10-13T00:00:00Z' }));
  });
  it('registry updates use a JSON merge rather than replacing unrelated settings', () => {
    const query = db.update(organizationSettings).set({
      branding: registryBrandingUpdate([definition()]),
    }).where(and(eq(organizationSettings.organizationId, org))).toSQL();
    expect(query.params).toContain(org);
    expect(query.sql).toContain('|| jsonb_build_object');
    expect(query.sql).toContain("'emailPlaceholders'");
    expect(query.params).toContain(JSON.stringify([definition()]));
  });
});

describe('Lessons assigned approver placeholder', () => {
  it('is selectable and previewable only for Lessons form events', () => {
    const source = findSource('lessons', 'approver_full_name')!;
    const d = definition('approver_full_name');
    expect(source.fieldLabel).toBe('Approver full name');
    expect(sourcesForWorkspace('lessons')).toContain(source);
    expect(sampleValue(source, 'plain')).toBe('Sample Approver');
    expect(d.name).toBe('lessons_approver_full_name');
    for (const workspace of ['audit', 'qaqc', 'docgov'] as const) {
      expect(findSource(workspace, 'approver_full_name')).toBeUndefined();
    }
    expect(definitionMatchesEvent(d, eventType)).toBe(true);
    expect(definitionMatchesEvent(d, 'lessons.lesson_form.approve')).toBe(true);
    expect(definitionMatchesEvent(d, 'lessons.lesson_form.transfer')).toBe(true);
    expect(definitionMatchesEvent(d, 'lessons.user_profile.update')).toBe(false);
    expect(definitionMatchesEvent(d, 'audit.audit_schedule.approve')).toBe(false);
  });
  it('loads the assigned approver, not the actor or recipient, with organization-scoped lookups', async () => {
    const d = definition('approver_full_name');
    const { fake, sqlQueries } = fixture([d], new Map<any, any[]>([
      [lessonLearnedForms, [{ id: entityId, organizationId: org, approverId: userId }]],
      [users, [{ id: userId, organizationId: org, fullName: 'Assigned Approver' }]],
    ]));
    const render = await prepareCustomPlaceholderValues(fake, org, { eventType, entityId, actorId: '55555555-5555-4555-8555-555555555555' }, { bodyTemplate: `{${d.name}}` });
    expect(render({ name: 'Different Recipient', email: 'recipient@example.test' })[d.name]).toBe('Assigned Approver');
    expect(sqlQueries[1].params).toContain(org);
    expect(sqlQueries[1].params).toContain(entityId);
    expect(sqlQueries[2].params).toContain(org);
    expect(sqlQueries[2].params).toContain(userId);
  });
  it('uses the assigned identity from a trusted event snapshot without reloading the form', async () => {
    const d = definition('approver_full_name');
    const { fake, sqlQueries } = fixture([d], new Map<any, any[]>([
      [users, [{ id: userId, organizationId: org, fullName: 'Snapshot Approver' }]],
    ]));
    const render = await prepareCustomPlaceholderValues(fake, org, {
      eventType, entityId, record: { id: entityId, organizationId: org, approverId: userId },
    }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'recipient@example.test' })[d.name]).toBe('Snapshot Approver');
    expect(sqlQueries).toHaveLength(2);
  });
  it('retrieves an omitted assignment when the event snapshot is partial', async () => {
    const d = definition('approver_full_name');
    const { fake } = fixture([d], new Map<any, any[]>([
      [lessonLearnedForms, [{ id: entityId, organizationId: org, approverId: userId }]],
      [users, [{ id: userId, organizationId: org, fullName: 'Assigned Approver' }]],
    ]));
    const render = await prepareCustomPlaceholderValues(fake, org, {
      eventType, entityId, record: { id: entityId, organizationId: org, title: 'Partial record' },
    }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'recipient@example.test' })[d.name]).toBe('Assigned Approver');
  });
  it('keeps an explicit unassigned snapshot unassigned and uses its configured fallback', async () => {
    const d = { ...definition('approver_full_name'), fallback: 'No approver assigned' };
    const { fake, sqlQueries } = fixture([d], new Map<any, any[]>([
      [lessonLearnedForms, [{ id: entityId, organizationId: org, approverId: userId }]],
      [users, [{ id: userId, organizationId: org, fullName: 'Later assignment' }]],
    ]));
    const render = await prepareCustomPlaceholderValues(fake, org, {
      eventType, entityId, actorId: userId, record: { id: entityId, organizationId: org, approverId: null },
    }, { bodyTemplate: `{${d.name}}` });
    expect(render({ name: 'Recipient', email: 'recipient@example.test' })[d.name]).toBe('No approver assigned');
    expect(sqlQueries).toHaveLength(1);
  });
  it('does not expose a foreign-organization user name or trust a foreign snapshot', async () => {
    const d = definition('approver_full_name');
    const { fake } = fixture([d], new Map<any, any[]>([
      [lessonLearnedForms, [{ id: entityId, organizationId: org, approverId: userId }]],
      [users, [{ id: userId, organizationId: otherOrg, fullName: 'Foreign Approver' }]],
    ]));
    const render = await prepareCustomPlaceholderValues(fake, org, {
      eventType, entityId, record: { id: entityId, organizationId: otherOrg, approverId: userId },
    }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'recipient@example.test' })[d.name]).toBe('Not available');
  });
  it('uses fallback for inactive definitions without querying assignment or users', async () => {
    const d = { ...definition('approver_full_name', false), fallback: 'Review pending' };
    const { fake, sqlQueries } = fixture([d]);
    const render = await prepareCustomPlaceholderValues(fake, org, { eventType, entityId }, { bodyTemplate: `{${d.name}}` });
    expect(render({ email: 'recipient@example.test' })[d.name]).toBe('Review pending');
    expect(sqlQueries).toHaveLength(1);
  });
});
