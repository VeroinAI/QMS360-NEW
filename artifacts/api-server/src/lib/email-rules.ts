import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  auditUserWorkspaceRoles, auditWorkspaceRoles, db, emailEventRules,
  lessonLearnedForms, lessonsUserWorkspaceRoles, lessonsWorkspaceRoles, userWorkspaceRoles, users, workspaceRoles,
} from "@workspace/db";
import { enqueueEmail } from "./email-queue";
import { logger } from "./logger";

export type AuditEvent = {
  organizationId: string; app: string; entityType: string; action: string;
  actorId?: string | null; entityId?: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function resolveEmailRule(database: typeof db, event: AuditEvent) {
  const rules = await database.select().from(emailEventRules).where(and(
    eq(emailEventRules.organizationId, event.organizationId),
    eq(emailEventRules.enabled, true), isNull(emailEventRules.deletedAt),
  )).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  const rule = rules.find((candidate) =>
    candidate.eventType === `${event.app}.${event.entityType}.${event.action}` &&
    (!candidate.createdByUserId || candidate.createdByUserId === event.actorId));
  if (!rule) return { rule: null, recipients: [] as Array<{ email: string; name?: string | null }>, sender: null as { email: string; name?: string | null } | null };
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
    } else if (config.roleName) {
      const appTables = event.app === "lessons"
        ? { assignments: lessonsUserWorkspaceRoles, roles: lessonsWorkspaceRoles }
        : event.app === "audit"
          ? { assignments: auditUserWorkspaceRoles, roles: auditWorkspaceRoles }
          : { assignments: userWorkspaceRoles, roles: workspaceRoles };
      const conditions = [
        eq(users.organizationId, event.organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt),
        eq(appTables.roles.organizationId, event.organizationId), eq(appTables.roles.name, config.roleName),
        eq(appTables.roles.status, "active"), isNull(appTables.roles.deletedAt),
        eq(appTables.assignments.status, "active"), isNull(appTables.assignments.deletedAt),
      ];
      if (rule.recipientMode === "project_role") {
        if (!projectIds.length) return { rule, recipients: [], sender };
        conditions.push(inArray(users.projectId, projectIds));
      }
      const rows = await database.select({ email: users.email, name: users.fullName }).from(appTables.assignments)
        .innerJoin(appTables.roles, eq(appTables.assignments.workspaceRoleId, appTables.roles.id))
        .innerJoin(users, eq(appTables.assignments.userId, users.id))
        .where(and(...conditions));
      recipients = rows.map((row) => ({ email: row.email, name: row.name }));
    }
  }
  return { rule, recipients: [...new Map(recipients.map((item) => [item.email.toLowerCase(), item])).values()], sender };
}

export async function dispatchEmailRule(event: AuditEvent) {
  try {
    const result = await resolveEmailRule(db, event);
    if (!result.rule || !result.recipients.length) return result;
    await enqueueEmail(db, {
      organizationId: event.organizationId, recipientIds: [], recipients: result.recipients,
      sender: result.sender ?? undefined,
      subject: `QMS360: ${event.entityType.replaceAll("_", " ")} ${event.action.replaceAll("_", " ")}`,
      text: `A ${event.entityType.replaceAll("_", " ")} record was ${event.action.replaceAll("_", " ")} in QMS360.${event.entityId ? `\n\nRecord reference: ${event.entityId}` : ""}`,
      context: { kind: "email_event_rule", app: event.app, ruleId: result.rule.id, eventType: result.rule.eventType, entityId: event.entityId },
    });
    return result;
  } catch (error) {
    logger.error({ error, event }, "Email event rule dispatch failed");
    return { rule: null, recipients: [] };
  }
}

export async function queueAuditApprovalEmail(
  database: typeof db,
  input: {
    organizationId: string;
    actorId: string;
    entityType: "audit_programme" | "audit_schedule";
    entityId: string;
    action: "submit" | "approve" | "approved_final";
    recipientIds: string[];
    subject: string;
    text: string;
    attachments?: Array<{ filename: string; contentType: "application/pdf"; objectPath: string }>;
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

  // Approval workflows supply the complete, privacy-scoped participant list.
  // Rule recipient modes are deliberately ignored for these notifications.
  if (rule && !rule.enabled) return { queued: 0 };

  return enqueueEmail(database, {
    organizationId: input.organizationId,
    recipientIds: [...new Set(input.recipientIds)],
    subject: input.subject,
    text: input.text,
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
