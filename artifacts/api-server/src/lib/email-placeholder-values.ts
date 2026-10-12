import { and, asc, eq, getTableColumns, isNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  db, lessonLearnedForms, auditSchedules, auditPlans, audits, auditFindings, correctiveActionReports,
  qaqcMetricEntries, materialInspectionEntries, qtbtEntries, customerSatisfactionEntries,
  qualityAssessmentBriefs, documentGovernanceLogEntries, users,
  auditLogEntries, lessonsAuditLogEntries, auditAuditLogEntries,
} from '@workspace/db';
import { definitionMatchesEvent, findSource, unknownEmailTemplateFields, emailRuleBodyText, type FormatKey, type PlaceholderDefinition } from '@workspace/field-controls';
import { listPlaceholderDefinitions, ruleReferencesPlaceholder } from './email-placeholder-registry';

export const EMAIL_PLACEHOLDER_TABLES: Record<string, PgTable> = {
  'app2_lessons.lesson_learned_forms': lessonLearnedForms,
  'app3_audit.audit_schedules': auditSchedules, 'app3_audit.audit_plans': auditPlans,
  'app3_audit.audits': audits, 'app3_audit.audit_findings': auditFindings,
  'app3_audit.corrective_action_reports': correctiveActionReports,
  'app1_qaqc.qaqc_metric_entries': qaqcMetricEntries, 'app1_qaqc.material_inspection_entries': materialInspectionEntries,
  'app1_qaqc.qtbt_entries': qtbtEntries, 'app1_qaqc.customer_satisfaction_entries': customerSatisfactionEntries,
  'app1_qaqc.quality_assessment_briefs': qualityAssessmentBriefs,
  'app1_qaqc.document_governance_log_entries': documentGovernanceLogEntries,
};
const ENTITY_TABLES: Record<string, PgTable> = {
  'lessons.lesson_form': lessonLearnedForms,
  'audit.audit_programme': auditSchedules, 'audit.audit_schedule': auditSchedules,
  'audit.audit_plan': auditPlans, 'audit.audit': audits, 'audit.audit_finding': auditFindings,
  'audit.corrective_action_report': correctiveActionReports, 'qaqc.metric': qaqcMetricEntries,
  'qaqc.material_inspection': materialInspectionEntries, 'qaqc.qtbt': qtbtEntries,
  'qaqc.customer_satisfaction': customerSatisfactionEntries, 'qaqc.quality_brief': qualityAssessmentBriefs,
  'qaqc.document_governance': documentGovernanceLogEntries,
};
export function formatPlaceholderValue(value: unknown, format: FormatKey, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (format === 'plain') return value instanceof Date ? value.toISOString() : typeof value === 'object' ? fallback : String(value);
  if (['decimal_0', 'decimal_2', 'number_grouped'].includes(format)) {
    const number = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(number)) return fallback;
    if (format === 'decimal_0') return number.toFixed(0);
    if (format === 'decimal_2') return number.toFixed(2);
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(number);
  }
  // Calendar strings preserve their date/wall-clock components rather than shifting timezones.
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!match) return fallback;
  const [, year, month, day, hour = '00', minute = '00'] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour) > 23 || Number(minute) > 59) return fallback;
  if (format === 'date_iso') return `${year}-${month}-${day}`;
  if (format === 'date_long') return `${Number(day)} ${new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(date)} ${year}`;
  return `${day}/${month}/${year}${format === 'datetime' ? ` ${hour}:${minute}` : ''}`;
}
export type PlaceholderEventContext = { eventType: string; entityId?: string | null; actorId?: string | null; record?: Record<string, any> };
export function renderCustomPlaceholderValues(definitions: PlaceholderDefinition[], eventType: string, getValue: (d: PlaceholderDefinition) => unknown) {
  return Object.fromEntries(definitions.filter(d => definitionMatchesEvent(d, eventType)).map(d => [
    d.name, d.active ? formatPlaceholderValue(getValue(d), d.format, d.fallback) : d.fallback,
  ]));
}
export async function prepareCustomPlaceholderValues(database: typeof db, organizationId: string, event: PlaceholderEventContext, template: { subjectTemplate?: string; bodyTemplate?: string; bodyRichText?: Record<string, unknown> | null }) {
  if (!unknownEmailTemplateFields(`${template.subjectTemplate ?? ''}\n${emailRuleBodyText(template)}`).length) {
    return (_recipient: { name?: string | null; email: string }): Record<string, string> => ({});
  }
  const definitions = (await listPlaceholderDefinitions(database, organizationId))
    .filter(d => definitionMatchesEvent(d, event.eventType) && ruleReferencesPlaceholder({ recipientConfig: template }, d.name));
  if (!definitions.length) return (_recipient: { name?: string | null; email: string }): Record<string, string> => ({});
  const active = definitions.filter(d => d.active);
  const table = ENTITY_TABLES[event.eventType.split('.').slice(0, 2).join('.')];
  const needsApprover = table === lessonLearnedForms && active.some(d => d.sourceKey === 'approver_full_name');
  let record: Record<string, any> = {};
  const snapshot = event.record;
  const trustedSnapshot = snapshot?.id === event.entityId && snapshot?.organizationId === organizationId;
  if (trustedSnapshot && snapshot) {
    record = snapshot;
  } else if (table && event.entityId && /^[0-9a-f-]{36}$/i.test(event.entityId) && (needsApprover || active.some(d => findSource(d.workspace, d.sourceKey)?.origin === 'record' || d.sourceKey === 'creator_full_name'))) {
    const columns = getTableColumns(table);
    [record] = await database.select().from(table).where(and(eq(columns.id, event.entityId), eq(columns.organizationId, organizationId))).limit(1) as Record<string, any>[];
    record ??= {};
  }
  // Some events carry a partial record snapshot. Load the assignment only when
  // omitted; an explicit null means unassigned and must not use a later value.
  if (needsApprover && trustedSnapshot && record.approverId === undefined && event.entityId && /^[0-9a-f-]{36}$/i.test(event.entityId)) {
    const [form] = await database.select({ approverId: lessonLearnedForms.approverId }).from(lessonLearnedForms).where(and(
      eq(lessonLearnedForms.id, event.entityId), eq(lessonLearnedForms.organizationId, organizationId),
    )).limit(1);
    record = { ...record, approverId: form?.approverId };
  }
  const nameOf = async (id: unknown) => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const [user] = await database.select({ name: users.fullName }).from(users).where(and(
      eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.deletedAt),
    )).limit(1);
    return user?.name;
  };
  let creatorId: unknown = record.creatorId ?? record.createdById;
  if (active.some(d => d.sourceKey === 'creator_full_name') && !creatorId && event.entityId) {
    const app = event.eventType.split('.')[0];
    const logs = app === 'audit' ? auditAuditLogEntries : app === 'lessons' ? lessonsAuditLogEntries : auditLogEntries;
    const [created] = await database.select({ actorId: logs.actorId }).from(logs).where(and(
      eq(logs.organizationId, organizationId), eq(logs.entityId, event.entityId),
      eq(logs.entityType, event.eventType.split('.')[1]), eq(logs.action, 'create'),
    )).orderBy(asc(logs.createdAt)).limit(1);
    creatorId = created?.actorId;
  }
  const [actorName, creatorName, approverName] = await Promise.all([
    active.some(d => d.sourceKey === 'actor_full_name') ? nameOf(event.actorId) : undefined,
    active.some(d => d.sourceKey === 'creator_full_name') ? nameOf(creatorId) : undefined,
    needsApprover ? nameOf(record.approverId) : undefined,
  ]);
  return (recipient: { name?: string | null; email: string }) => renderCustomPlaceholderValues(definitions, event.eventType, d => {
    const source = findSource(d.workspace, d.sourceKey)!;
    if (source.origin === 'system') {
      return ({ recipient_full_name: recipient.name ?? recipient.email, recipient_email: recipient.email, actor_full_name: actorName, creator_full_name: creatorName, approver_full_name: approverName, system_name: 'QMS360' } as Record<string, unknown>)[source.key];
    }
    const parts = source.schemaRef.split('.');
    const sourceTable = EMAIL_PLACEHOLDER_TABLES[parts.slice(0, -1).join('.')];
    // Also assert source table equals event table; no cross-entity field resolution.
    if (sourceTable !== table) return undefined;
    const key = Object.entries(getTableColumns(sourceTable)).find(([, column]) => column.name === parts.at(-1))?.[0];
    return key ? record[key] : undefined;
  });
}
