import { and, asc, eq, isNull } from "drizzle-orm";
import { db, emailEventRules, users } from "@workspace/db";
import { deliverEmail } from "./email";
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
  if (!rule) return { rule: null, recipients: [] as Array<{ email: string; name?: string | null }> };
  let recipients: Array<{ email: string; name?: string | null }> = [];
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
  }
  return { rule, recipients: [...new Map(recipients.map((item) => [item.email.toLowerCase(), item])).values()] };
}

export async function dispatchEmailRule(event: AuditEvent) {
  try {
    const result = await resolveEmailRule(db, event);
    if (!result.rule || !result.recipients.length) return result;
    void deliverEmail(db, {
      organizationId: event.organizationId, recipientIds: [], recipients: result.recipients,
      subject: `QMS360: ${event.entityType.replaceAll("_", " ")} ${event.action.replaceAll("_", " ")}`,
      text: `A ${event.entityType.replaceAll("_", " ")} record was ${event.action.replaceAll("_", " ")} in QMS360.${event.entityId ? `\n\nRecord reference: ${event.entityId}` : ""}`,
      context: { kind: "email_event_rule", ruleId: result.rule.id, eventType: result.rule.eventType, entityId: event.entityId },
    });
    return result;
  } catch (error) {
    logger.error({ error, event }, "Email event rule dispatch failed");
    return { rule: null, recipients: [] };
  }
}