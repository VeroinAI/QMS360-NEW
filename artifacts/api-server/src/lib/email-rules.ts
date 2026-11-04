import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  auditPlans, auditUserWorkspaceRoles, auditWorkspaceRoles, db, emailEventRules,
  lessonLearnedForms, lessonsUserWorkspaceRoles, lessonsWorkspaceRoles, userWorkspaceRoles, users, workspaceRoles,
} from "@workspace/db";
import { enqueueEmail } from "./email-queue";
import { canonicalEmailEventType, selectedEmailReports } from "@workspace/field-controls";
import { removeEmailPdfAttachment, type EmailPdfAttachment } from "./email-attachments";
import { logger } from "./logger";
import { emailTemplateContext } from "./email-template-context";
import { legacyEmailEvent } from "./approval-email-events";

export type AuditEvent = {
  organizationId: string; app: string; entityType: string; action: string;
  actorId?: string | null; entityId?: string | null;
  record?: Record<string, any>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function configuredWorkspaceRoleNames(config: { roleName?: string; roleNames?: string[] } | null | undefined) {
  return [...new Set([
    ...(config?.roleNames ?? []),
    ...(config?.roleName ? [config.roleName] : []),
  ].map((name) => name.trim()).filter(Boolean))];
}

export function auditProgrammeFinalRoleOverride(
  eventType: string,
  rule: { enabled: boolean; recipientMode: string } | null | undefined,
) {
  return eventType === "audit.audit_programme.approved_final"
    && Boolean(rule?.enabled && rule.recipientMode === "workspace_role");
}

async function resolveWorkspaceRoleUserIds(
  database: typeof db,
  organizationId: string,
  app: string,
  roleNames: string[],
) {
  if (!roleNames.length) return [];
  const appTables = app === "lessons"
    ? { assignments: lessonsUserWorkspaceRoles, roles: lessonsWorkspaceRoles }
    : app === "audit"
      ? { assignments: auditUserWorkspaceRoles, roles: auditWorkspaceRoles }
      : { assignments: userWorkspaceRoles, roles: workspaceRoles };
  const rows = await database.select({ userId: appTables.assignments.userId }).from(appTables.assignments)
    .innerJoin(appTables.roles, eq(appTables.assignments.workspaceRoleId, appTables.roles.id))
    .innerJoin(users, eq(appTables.assignments.userId, users.id))
    .where(and(
      eq(appTables.assignments.organizationId, organizationId),
      eq(appTables.assignments.status, "active"), isNull(appTables.assignments.deletedAt),
      eq(appTables.roles.organizationId, organizationId), inArray(appTables.roles.name, roleNames),
      eq(appTables.roles.status, "active"), isNull(appTables.roles.deletedAt),
      eq(users.organizationId, organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
  return [...new Set(rows.map((row) => row.userId))];
}

export async function resolveEmailRule(database: typeof db, event: AuditEvent) {
  const planSend = event.app === "audit" && event.entityType === "audit_plan" && event.action === "send_for_audit";
  const eventType = `${event.app}.${event.entityType}.${event.action}`;
  // Retired shared submission event: keep saved rules/history, but never send.
  if (eventType === "qaqc.qaqc_report.submit")
    return { rule: null, recipients: [], sender: null, ccRecipients: [] };
  const legacyEventType = legacyEmailEvent(eventType);
  const rules = await database.select().from(emailEventRules).where(and(
    eq(emailEventRules.organizationId, event.organizationId),
    ...(planSend || legacyEventType ? [] : [eq(emailEventRules.enabled, true)]), isNull(emailEventRules.deletedAt),
  )).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  const rule = rules.find((candidate) =>
    (candidate.enabled || planSend || Boolean(legacyEventType)) &&
    canonicalEmailEventType(candidate.eventType) === canonicalEmailEventType(eventType) &&
    (!candidate.createdByUserId || candidate.createdByUserId === event.actorId))
    ?? (legacyEventType ? rules.find(candidate => candidate.enabled
      && candidate.eventType === legacyEventType
      && (!candidate.createdByUserId || candidate.createdByUserId === event.actorId)) : undefined);
  // Explicit specific rules (including disabled rules) supersede legacy shared rules.
  if ((planSend || legacyEventType) && rule && !rule.enabled) return { rule, recipients: [], sender: null, ccRecipients: [] };
  const circulation = planSend ? await resolveAuditPlanCirculation(database, event) : [];
  if (!rule) return { rule: null, recipients: circulation, sender: null, ccRecipients: [] };
  const { recipients, sender } = await resolveEmailTarget(database, event, rule);
  const ccRecipients = await resolveEmailRuleCc(database, event, rule.recipientConfig);
  return { rule, recipients: [...new Map([...recipients, ...circulation].map(item => [item.email.toLowerCase(), item])).values()], sender, ccRecipients };
}

/** Saved circulation is authoritative; never trust handoff request role IDs or free-text names. */
export async function resolveAuditPlanCirculation(database: typeof db, event: AuditEvent) {
  if (!event.entityId) return [];
  const [plan] = await database.select({ status: auditPlans.status }).from(auditPlans).where(and(
    eq(auditPlans.id, event.entityId), eq(auditPlans.organizationId, event.organizationId),
    isNull(auditPlans.deletedAt),
  ));
  if (!plan) return [];
  let meta: { circulationRoleIds?: unknown };
  try { meta = JSON.parse(plan.status); } catch { return []; }
  const roleIds = Array.isArray(meta?.circulationRoleIds)
    ? [...new Set(meta.circulationRoleIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))] : [];
  if (!roleIds.length) return [];
  const rows = await database.select({ email: users.email, name: users.fullName }).from(auditUserWorkspaceRoles)
    .innerJoin(auditWorkspaceRoles, eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId))
    .innerJoin(users, eq(users.id, auditUserWorkspaceRoles.userId))
    .where(and(
      eq(auditUserWorkspaceRoles.organizationId, event.organizationId),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
      eq(auditWorkspaceRoles.organizationId, event.organizationId), inArray(auditWorkspaceRoles.id, roleIds),
      eq(auditWorkspaceRoles.status, "active"), isNull(auditWorkspaceRoles.deletedAt),
      eq(users.organizationId, event.organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
  return [...new Map(rows.filter(row => row.email && emailPattern.test(row.email))
    .map(row => [row.email.toLowerCase(), row])).values()];
}

type RecipientTarget = Pick<typeof emailEventRules.$inferSelect, "recipientMode" | "receiverEmail" | "receiverName" | "receiverUserId" | "recipientConfig">;
type RecipientEvent = Pick<AuditEvent, "organizationId" | "app"> & Partial<AuditEvent>;
/** Resolve To and explicit CC targets identically; only To can determine Reply-To. */
async function resolveEmailTarget(database: typeof db, event: RecipientEvent, rule: RecipientTarget) {
  let recipients: Array<{ email: string; name?: string | null }> = [];
  let sender: { email: string; name?: string | null } | null = null;
  if (rule.recipientMode === "external_email" && rule.receiverEmail && emailPattern.test(rule.receiverEmail)) {
    recipients = [{ email: rule.receiverEmail, name: rule.receiverName }];
  } else if (rule.recipientMode === "internal_user" && rule.receiverUserId) {
    const rows = await database.select({ email: users.email, name: users.fullName }).from(users).where(and(
      eq(users.id, rule.receiverUserId), eq(users.organizationId, event.organizationId),
      eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
    recipients = rows.map((row) => ({ email: row.email, name: row.name }));
  } else if (rule.recipientMode === "all_users") {
    const rows = await database.select({ email: users.email, name: users.fullName }).from(users).where(and(
      eq(users.organizationId, event.organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
    recipients = rows.map((row) => ({ email: row.email, name: row.name }));
  } else if (rule.recipientMode === "linked_approver" && event.app === "lessons" && event.entityType === "lesson_form" && event.entityId) {
    const [form] = await database.select({
      approverEmail: users.email,
      approverName: users.fullName,
      creatorId: lessonLearnedForms.creatorId,
    }).from(lessonLearnedForms)
      .innerJoin(users, eq(lessonLearnedForms.approverId, users.id))
      .where(and(
        eq(lessonLearnedForms.id, event.entityId),
        eq(lessonLearnedForms.organizationId, event.organizationId),
        eq(users.organizationId, event.organizationId),
        eq(users.accessStatus, "active"),
        isNull(users.deletedAt),
      )).limit(1);
    if (form) {
      const [creator] = await database.select({ email: users.email, name: users.fullName }).from(users).where(and(
        eq(users.id, form.creatorId), eq(users.organizationId, event.organizationId),
        eq(users.accessStatus, "active"), isNull(users.deletedAt),
      )).limit(1);
      if (creator) {
        recipients = [{ email: form.approverEmail, name: form.approverName }];
        sender = creator;
      }
    }
  } else if (rule.recipientMode === "linked_creator" && event.app === "lessons" && event.entityType === "lesson_form" && event.entityId && event.actorId) {
    const [form] = await database.select({
      creatorEmail: users.email,
      creatorName: users.fullName,
    }).from(lessonLearnedForms)
      .innerJoin(users, eq(lessonLearnedForms.creatorId, users.id))
      .where(and(
        eq(lessonLearnedForms.id, event.entityId),
        eq(lessonLearnedForms.organizationId, event.organizationId),
        eq(users.organizationId, event.organizationId),
        eq(users.accessStatus, "active"),
        isNull(users.deletedAt),
      )).limit(1);
    if (form) {
      const [triggeringUser] = await database.select({ email: users.email, name: users.fullName }).from(users).where(and(
        eq(users.id, event.actorId), eq(users.organizationId, event.organizationId),
        eq(users.accessStatus, "active"), isNull(users.deletedAt),
      )).limit(1);
      if (triggeringUser) {
        recipients = [{ email: form.creatorEmail, name: form.creatorName }];
        sender = triggeringUser;
      }
    }
  } else if (["workspace_role", "project_members", "project_role"].includes(rule.recipientMode)) {
    const config = rule.recipientConfig ?? {};
    const projectIds = (config.projectIds ?? []).filter(Boolean);
    if (rule.recipientMode === "project_members") {
      if (projectIds.length) {
        const rows = await database.select({ email: users.email, name: users.fullName }).from(users).where(and(
          eq(users.organizationId, event.organizationId), eq(users.accessStatus, "active"),
          isNull(users.deletedAt), inArray(users.projectId, projectIds),
        ));
        recipients = rows.map((row) => ({ email: row.email, name: row.name }));
      }
    } else {
      const roleNames = rule.recipientMode === "workspace_role"
        ? configuredWorkspaceRoleNames(config)
        : configuredWorkspaceRoleNames({ roleName: config.roleName });
      if (!roleNames.length) return { recipients: [], sender };
      const appTables = event.app === "lessons"
        ? { assignments: lessonsUserWorkspaceRoles, roles: lessonsWorkspaceRoles }
        : event.app === "audit"
          ? { assignments: auditUserWorkspaceRoles, roles: auditWorkspaceRoles }
          : { assignments: userWorkspaceRoles, roles: workspaceRoles };
      const conditions = [
        eq(appTables.assignments.organizationId, event.organizationId),
        eq(users.organizationId, event.organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt),
        eq(appTables.roles.organizationId, event.organizationId), inArray(appTables.roles.name, roleNames),
        eq(appTables.roles.status, "active"), isNull(appTables.roles.deletedAt),
        eq(appTables.assignments.status, "active"), isNull(appTables.assignments.deletedAt),
      ];
      if (rule.recipientMode === "project_role") {
        if (!projectIds.length) return { recipients: [], sender };
        conditions.push(inArray(users.projectId, projectIds));
      }
      const rows = await database.select({ email: users.email, name: users.fullName }).from(appTables.assignments)
        .innerJoin(appTables.roles, eq(appTables.assignments.workspaceRoleId, appTables.roles.id))
        .innerJoin(users, eq(appTables.assignments.userId, users.id))
        .where(and(...conditions));
      recipients = rows.map((row) => ({ email: row.email, name: row.name }));
    }
  }
  return { recipients: [...new Map(recipients.map((item) => [item.email.toLowerCase(), item])).values()], sender };
}

/** Resolve explicit CC grants in the event's application, never another tenant/app. */
export async function resolveEmailRuleCc(
  database: typeof db,
  event: RecipientEvent,
  config: { ccRoleNames?: string[]; ccRecipient?: NonNullable<RecipientTarget["recipientConfig"]>["ccRecipient"] } | null | undefined,
) {
  if (config?.ccRecipient) {
    const cc = config.ccRecipient;
    if (["workspace_role", "project_role"].includes(cc.mode) && !["audit", "lessons", "qaqc"].includes(event.app)) return [];
    const result = await resolveEmailTarget(database, event, {
      recipientMode: cc.mode, receiverUserId: cc.userId ?? null, receiverName: cc.name ?? null,
      receiverEmail: cc.email ?? null, recipientConfig: {
        roleName: cc.roleName, roleNames: cc.roleNames, projectIds: cc.projectIds,
      },
    });
    return result.recipients;
  }
  const names = [...new Set((config?.ccRoleNames ?? []).map(name => name.trim()).filter(Boolean))];
  if (!names.length || !["audit", "lessons", "qaqc"].includes(event.app)) return [];
  const ids = await resolveWorkspaceRoleUserIds(database, event.organizationId, event.app, names);
  if (!ids.length) return [];
  return database.select({ email: users.email, name: users.fullName }).from(users).where(and(
    eq(users.organizationId, event.organizationId), eq(users.accessStatus, "active"),
    isNull(users.deletedAt), inArray(users.id, ids),
  ));
}

export async function dispatchEmailRule(event: AuditEvent, options: {
  emailAttachments?: () => Promise<EmailPdfAttachment[]>;
} = {}) {
  let attachments: EmailPdfAttachment[] = [];
  let queued = false;
  try {
    const result = await resolveEmailRule(db, event);
    if (!result.recipients.length) return result;
    // Only generate/store a report when an enabled rule actually has recipients.
    // The queue retains the private snapshot for SMTP retries.
    // Report choice is frozen on the queue row. Generation is performed by the
    // retryable worker, never by the business transaction or an implicit default.
    const delivery = await enqueueEmail(db, {
      organizationId: event.organizationId, recipientIds: [], recipients: result.recipients,
      ccRecipients: result.ccRecipients ?? [],
      ...(attachments.length ? { attachments } : {}),
      sender: result.sender ?? undefined,
      ruleTemplate: result.rule?.recipientConfig,
      placeholderEvent: { eventType: result.rule?.eventType ?? `${event.app}.${event.entityType}.${event.action}`, entityId: event.entityId, actorId: event.actorId, record: event.record },
      templateValues: result.rule?.recipientConfig?.subjectTemplate || result.rule?.recipientConfig?.bodyTemplate || result.rule?.recipientConfig?.bodyRichText
        ? await emailTemplateContext(db, event) : undefined,
      subject: `QMS360: ${event.entityType.replaceAll("_", " ")} ${event.action.replaceAll("_", " ")}`,
      text: `A ${event.entityType.replaceAll("_", " ")} record was ${event.action.replaceAll("_", " ")} in QMS360.${event.entityId ? `\n\nRecord reference: ${event.entityId}` : ""}`,
      context: { kind: "email_event_rule", app: event.app, ruleId: result.rule?.id, eventType: result.rule?.eventType ?? `${event.app}.${event.entityType}.${event.action}`, entityId: event.entityId },
    });
    queued = delivery.queued > 0;
    return result;
  } catch (error) {
    logger.error({ error, event }, "Email event rule dispatch failed");
    return { rule: null, recipients: [] };
  } finally {
    if (!queued) {
      for (const attachment of attachments) {
        await removeEmailPdfAttachment(event.organizationId, attachment.objectPath).catch(error => {
          logger.warn({ error, event }, "Unqueued email PDF attachment cleanup failed");
        });
      }
    }
  }
}

/** Only reviewers who acted on this submission cycle belong on the send-back CC. */
export function auditScheduleSendBackCcIds(creatorId: string | null, approvedIds: string[], reviewerId: string): string[] {
  return [...new Set([...approvedIds, reviewerId])].filter(id => id !== creatorId);
}

export async function queueAuditApprovalEmail(
  database: typeof db,
  input: {
    organizationId: string;
    actorId: string;
    entityType: "audit_programme" | "audit_schedule";
    entityId: string;
    action: "submit" | "approve" | "approved_final" | "send_back";
    recipientIds: string[];
    ccRecipientIds?: string[];
    subject: string;
    text: string;
    record?: Record<string, any>;
    templateValues?: Record<string, unknown>;
    attachments?: EmailPdfAttachment[];
  },
): Promise<{ queued: number }> {
  const eventType = `audit.${input.entityType}.${input.action}`;
  const rules = await database.select().from(emailEventRules).where(and(
    eq(emailEventRules.organizationId, input.organizationId),
    isNull(emailEventRules.deletedAt),
  )).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  const rule = rules.find((candidate) =>
    candidate.eventType === eventType &&
    (!candidate.createdByUserId || candidate.createdByUserId === input.actorId));

  // To recipients remain workflow-scoped; explicit configured CC roles are additive.
  if (rule && !rule.enabled) return { queued: 0 };

  let recipientIds = [...new Set(input.recipientIds)];
  if (auditProgrammeFinalRoleOverride(eventType, rule)) {
    recipientIds = await resolveWorkspaceRoleUserIds(
      database,
      input.organizationId,
      "audit",
      configuredWorkspaceRoleNames(rule?.recipientConfig),
    );
  }

  const ccIds = [...new Set(input.ccRecipientIds ?? [])].filter(id => !recipientIds.includes(id));
  const ccRecipients = ccIds.length ? await database.select({ email: users.email, name: users.fullName }).from(users).where(and(
    eq(users.organizationId, input.organizationId), eq(users.accessStatus, "active"),
    isNull(users.deletedAt), inArray(users.id, ccIds),
  )) : [];
  return enqueueEmail(database, {
    organizationId: input.organizationId,
    recipientIds,
    ccRecipients: [...ccRecipients, ...await resolveEmailRuleCc(database, {
      organizationId: input.organizationId, app: "audit", actorId: input.actorId,
      entityType: input.entityType, entityId: input.entityId, action: input.action,
    }, rule?.recipientConfig)],
    subject: input.subject,
    text: input.text,
    ruleTemplate: rule?.recipientConfig,
    placeholderEvent: { eventType, entityId: input.entityId, actorId: input.actorId, record: input.record },
    templateValues: rule?.recipientConfig?.subjectTemplate || rule?.recipientConfig?.bodyTemplate || rule?.recipientConfig?.bodyRichText
      ? await emailTemplateContext(database, { ...input, values: input.templateValues }) : undefined,
    attachments: input.attachments,
    context: {
      kind: rule ? "email_event_rule" : "audit_approval",
      app: "audit",
      eventType,
      ruleId: rule?.id ?? null,
      entityId: input.entityId,
    },
  });
}

export async function auditApprovalEmailEnabled(
  database: typeof db,
  input: {
    organizationId: string;
    actorId: string;
    entityType: "audit_programme" | "audit_schedule";
  },
): Promise<boolean> {
  const rules = await database.select().from(emailEventRules).where(and(
    eq(emailEventRules.organizationId, input.organizationId),
    isNull(emailEventRules.deletedAt),
    eq(emailEventRules.eventType, `audit.${input.entityType}.approved_final`),
  )).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  const rule = rules.find(candidate => !candidate.createdByUserId || candidate.createdByUserId === input.actorId);
  return rule?.enabled ?? true;
}

/** Keep unconfigured legacy workflow mail unchanged; configured rules opt in. */
export async function auditApprovalAttachmentEnabled(
  database: typeof db, input: { organizationId: string; actorId: string; entityType: "audit_programme" | "audit_schedule" },
) {
  const rules = await database.select().from(emailEventRules).where(and(
    eq(emailEventRules.organizationId, input.organizationId), isNull(emailEventRules.deletedAt),
    eq(emailEventRules.eventType, `audit.${input.entityType}.approved_final`),
  )).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  const rule = rules.find(candidate => !candidate.createdByUserId || candidate.createdByUserId === input.actorId);
  return !rule || (rule.enabled && selectedEmailReports(rule.recipientConfig).includes("audit_schedule_pdf"));
}
