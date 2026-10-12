import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, emailEventRules, organizationSettings } from '@workspace/db';
import {
  buildDraft, definitionMatchesEvent, draftToState, eventsForWorkspace, isValidDraft,
  unknownEmailTemplateFields, emailRuleBodyText, validateStep, type EventOption, type PlaceholderDefinition, type WizardState,
} from '@workspace/field-controls';
import { HttpError, writeAuditLog } from './workspace';

export function readPlaceholderRegistry(branding: Record<string, unknown> | undefined): PlaceholderDefinition[] {
  const value = branding?.emailPlaceholders;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(d => isValidDraft(d) && typeof (d as PlaceholderDefinition).active === 'boolean')) {
    throw new HttpError(500, 'Email placeholder settings are invalid; existing settings were preserved.');
  }
  return value as PlaceholderDefinition[];
}
export async function listPlaceholderDefinitions(database: typeof db, organizationId: string) {
  const [row] = await database.select({ branding: organizationSettings.branding }).from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  return readPlaceholderRegistry(row?.branding);
}
export function compatiblePlaceholderNames(definitions: PlaceholderDefinition[], eventType: string) {
  // Inactive references remain valid in saved rules; delivery uses their explicit fallback.
  return definitions.filter(d => definitionMatchesEvent(d, eventType)).map(d => d.name);
}
export async function validateCustomRuleTemplate(database: typeof db, org: string, eventType: string, template: { subjectTemplate?: string; bodyTemplate?: string; bodyRichText?: Record<string, unknown> | null }) {
  const content = `${template.subjectTemplate ?? ''}\n${emailRuleBodyText(template)}`;
  if (!unknownEmailTemplateFields(content).length) return;
  const definitions = await listPlaceholderDefinitions(database, org);
  const unknown = unknownEmailTemplateFields(content, compatiblePlaceholderNames(definitions, eventType));
  if (unknown.length) throw new HttpError(422, `Unsupported or incompatible email placeholders: ${unknown.join(', ')}`);
}
export type RegistryMutation =
  | { kind: 'create'; input: WizardState }
  | { kind: 'update'; id: string; input: WizardState }
  | { kind: 'activation'; id: string; active: boolean }
  | { kind: 'delete'; id: string };

export function definitionInput(d: PlaceholderDefinition) {
  return JSON.stringify(draftToState(d));
}
export function registryBrandingUpdate(definitions: PlaceholderDefinition[]) {
  return sql`${organizationSettings.branding} || jsonb_build_object('emailPlaceholders', ${JSON.stringify(definitions)}::jsonb)`;
}
export function ruleReferencesPlaceholder(rule: { recipientConfig: { subjectTemplate?: string; bodyTemplate?: string; bodyRichText?: Record<string, unknown> | null } | null }, name: string) {
  const tokens = [...`${rule.recipientConfig?.subjectTemplate ?? ''}\n${rule.recipientConfig ? emailRuleBodyText(rule.recipientConfig) : ''}`.matchAll(/\{\{?\s*([^{}]+?)\s*\}?\}/g)];
  return tokens.some(match => match[1].trim().toLowerCase().replace(/[\s/]+/g, '_') === name);
}
export async function mutatePlaceholderRegistry(org: string, actorId: string, mutation: RegistryMutation, events: EventOption[]) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`email-placeholders:${org}`}))`);
    // Ensure a single settings row even when other configuration writes create it concurrently.
    await tx.insert(organizationSettings).values({ organizationId: org })
      .onConflictDoNothing({ target: organizationSettings.organizationId, where: sql`${organizationSettings.deletedAt} IS NULL` });
    const [settings] = await tx.select().from(organizationSettings).where(and(
      eq(organizationSettings.organizationId, org), isNull(organizationSettings.deletedAt),
    )).for('update').limit(1);
    const definitions = readPlaceholderRegistry(settings.branding);
    const current = mutation.kind === 'create' ? undefined : definitions.find(d => d.id === mutation.id);
    if (mutation.kind !== 'create' && !current) throw new HttpError(404, 'Placeholder not found in this organization.');
    let result: PlaceholderDefinition | undefined;
    let next = definitions;
    const now = new Date().toISOString();
    if (mutation.kind === 'create' || mutation.kind === 'update') {
      const input = mutation.input;
      const errors = validateStep(4, input, eventsForWorkspace(events, input.workspace as PlaceholderDefinition['workspace']), [], null);
      if (errors.length) throw new HttpError(422, errors.join(' '));
      result = { ...buildDraft(input, current ?? null, now, randomUUID()), active: current?.active ?? false };
      if (!isValidDraft(result)) throw new HttpError(422, 'Invalid placeholder definition.');
      const duplicate = definitions.find(d => d.name === result!.name && d.id !== current?.id);
      if (duplicate) {
        if (mutation.kind === 'create' && definitionInput(duplicate) === definitionInput(result)) return duplicate;
        throw new HttpError(409, 'A placeholder with this generated name already exists. Edit the existing definition instead.');
      }
      if (current?.active && current.name !== result.name) throw new HttpError(409, 'Deactivate this placeholder before changing its source or workspace.');
      if (!current && definitions.length >= 200) throw new HttpError(422, 'This organization already has 200 placeholder definitions.');
      next = current ? definitions.map(d => d.id === current.id ? result! : d) : [...definitions, result];
    } else if (mutation.kind === 'activation') {
      if (mutation.active) {
        const errors = validateStep(4, draftToState(current!), eventsForWorkspace(events, current!.workspace), [], null);
        if (errors.length) throw new HttpError(422, `Cannot activate: ${errors.join(' ')}`);
      }
      result = { ...current!, active: mutation.active, updatedAt: now };
      next = definitions.map(d => d.id === result!.id ? result! : d);
    } else {
      next = definitions.filter(d => d.id !== current!.id);
    }
    if (current && (mutation.kind === 'delete' || mutation.kind === 'update')) {
      const rules = await tx.select().from(emailEventRules).where(and(eq(emailEventRules.organizationId, org), isNull(emailEventRules.deletedAt)));
      const referencing = rules.filter(rule => ruleReferencesPlaceholder(rule, current.name));
      if (referencing.length && (mutation.kind === 'delete' || result!.name !== current.name || referencing.some(rule => !definitionMatchesEvent(result!, rule.eventType)))) {
        throw new HttpError(409, 'This placeholder is used by an email rule. Remove its references before deleting, renaming or narrowing its event scope. You can deactivate it instead.');
      }
    }
    await tx.update(organizationSettings).set({
      branding: registryBrandingUpdate(next),
      updatedAt: new Date(),
    }).where(eq(organizationSettings.id, settings.id));
    await writeAuditLog(tx as unknown as typeof db, 'audit', {
      organizationId: org, actorId, entityType: 'email_placeholder', entityId: result?.id ?? current!.id,
      action: mutation.kind === 'activation' ? (mutation.active ? 'activate' : 'deactivate') : mutation.kind,
      before: current as any, after: result as any,
    });
    return result;
  });
}
