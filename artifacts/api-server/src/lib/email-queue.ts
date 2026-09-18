import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, organizationSettings, outboundEmails, users } from "@workspace/db";
import { deliverEmail, type EmailDeliveryInput } from "./email";
import { logger } from "./logger";

type Database = typeof db;
export type EmailDeliveryPolicy = {
  retentionDays: number;
  maxRetries: number;
  retryDelayMinutes: number;
};

export const DEFAULT_EMAIL_DELIVERY_POLICY: EmailDeliveryPolicy = {
  retentionDays: 90,
  maxRetries: 3,
  retryDelayMinutes: 15,
};

export async function getEmailDeliveryPolicy(database: Database, organizationId: string): Promise<EmailDeliveryPolicy> {
  const [row] = await database.select({ policy: organizationSettings.emailDeliveryPolicy })
    .from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)))
    .limit(1);
  return { ...DEFAULT_EMAIL_DELIVERY_POLICY, ...(row?.policy ?? {}) };
}

function applicationFromContext(context?: Record<string, unknown>): "qaqc" | "lessons" | "audit" | "platform" {
  const app = typeof context?.app === "string" ? context.app
    : typeof context?.eventType === "string" ? context.eventType.split(".")[0] : "";
  return app === "qaqc" || app === "lessons" || app === "audit" ? app : "platform";
}

export async function enqueueEmail(database: Database, input: EmailDeliveryInput): Promise<{ queued: number }> {
  const recipientIds = [...new Set(input.recipientIds)].filter(Boolean);
  const internal = recipientIds.length ? await database.select({ email: users.email, name: users.fullName })
    .from(users).where(and(
      eq(users.organizationId, input.organizationId),
      inArray(users.id, recipientIds),
      eq(users.accessStatus, "active"),
      isNull(users.deletedAt),
    )) : [];
  const explicit = (input.recipients ?? []).filter((recipient) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email));
  const recipients = [...new Map([...internal, ...explicit]
    .map((recipient) => [recipient.email.trim().toLowerCase(), { email: recipient.email.trim().toLowerCase(), name: recipient.name ?? null }])).values()];
  if (!recipients.length) return { queued: 0 };

  const policy = await getEmailDeliveryPolicy(database, input.organizationId);
  const context = input.context ?? {};
  const eventType = typeof context.eventType === "string" ? context.eventType : null;
  const ruleId = typeof context.ruleId === "string" ? context.ruleId : null;
  const entityId = typeof context.entityId === "string" ? context.entityId : null;
  await database.insert(outboundEmails).values(recipients.map((recipient) => ({
    organizationId: input.organizationId,
    app: applicationFromContext(context),
    eventType,
    ruleId,
    entityId,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    subject: input.subject,
    bodyText: input.text,
    context,
    deliveryStatus: "queued",
    attemptCount: 0,
    maxAttempts: policy.maxRetries + 1,
    nextAttemptAt: new Date(),
  })));
  return { queued: recipients.length };
}

async function claimDueEmails(database: Database) {
  const now = new Date();
  const staleLock = new Date(now.getTime() - 5 * 60_000);
  const due = or(
    and(inArray(outboundEmails.deliveryStatus, ["queued", "retrying"]), lte(outboundEmails.nextAttemptAt, now)),
    and(eq(outboundEmails.deliveryStatus, "sending"), lt(outboundEmails.lockedAt, staleLock)),
  );
  const candidates = await database.select({ id: outboundEmails.id }).from(outboundEmails)
    .where(and(isNull(outboundEmails.deletedAt), due))
    .orderBy(outboundEmails.nextAttemptAt)
    .limit(20);
  if (!candidates.length) return [];
  return database.update(outboundEmails).set({
    deliveryStatus: "sending",
    lockedAt: now,
    updatedAt: now,
  }).where(and(inArray(outboundEmails.id, candidates.map((row) => row.id)), isNull(outboundEmails.deletedAt), due)).returning();
}

async function processClaimedEmail(database: Database, row: typeof outboundEmails.$inferSelect) {
  const attemptedAt = new Date();
  const result = await deliverEmail(database, {
    organizationId: row.organizationId,
    recipientIds: [],
    recipients: [{ email: row.recipientEmail, name: row.recipientName }],
    subject: row.subject,
    text: row.bodyText,
    context: { ...row.context, queueId: row.id, queueAttempt: row.attemptCount + 1 },
  });
  const attemptCount = row.attemptCount + 1;
  const succeeded = result.attempted && result.failed === 0;
  if (succeeded) {
    await database.update(outboundEmails).set({
      deliveryStatus: "sent", attemptCount, lastAttemptAt: attemptedAt, sentAt: new Date(),
      lastError: null, lockedAt: null, updatedAt: new Date(),
    }).where(eq(outboundEmails.id, row.id));
    return;
  }
  const error = result.attempted ? result.error ?? "SMTP delivery failed" : `Delivery not attempted: ${result.reason}`;
  const exhausted = attemptCount >= row.maxAttempts;
  const policy = await getEmailDeliveryPolicy(database, row.organizationId);
  await database.update(outboundEmails).set({
    deliveryStatus: exhausted ? "failed" : "retrying",
    attemptCount,
    lastAttemptAt: attemptedAt,
    lastError: error,
    nextAttemptAt: exhausted ? attemptedAt : new Date(attemptedAt.getTime() + policy.retryDelayMinutes * 60_000),
    lockedAt: null,
    updatedAt: new Date(),
  }).where(eq(outboundEmails.id, row.id));
}

async function purgeExpiredEmailLogs(database: Database) {
  const orgRows = await database.selectDistinct({ organizationId: outboundEmails.organizationId })
    .from(outboundEmails).where(isNull(outboundEmails.deletedAt));
  for (const { organizationId } of orgRows) {
    const policy = await getEmailDeliveryPolicy(database, organizationId);
    const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000);
    await database.delete(outboundEmails).where(and(
      eq(outboundEmails.organizationId, organizationId),
      inArray(outboundEmails.deliveryStatus, ["sent", "failed"]),
      lt(outboundEmails.updatedAt, cutoff),
    ));
  }
}

let sweepRunning = false;
export async function runEmailQueueSweep(database: Database = db) {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const rows = await claimDueEmails(database);
    await Promise.allSettled(rows.map((row) => processClaimedEmail(database, row)));
    await purgeExpiredEmailLogs(database);
  } catch (error) {
    logger.error({ error }, "Email queue sweep failed");
  } finally {
    sweepRunning = false;
  }
}

export function startEmailQueueScheduler() {
  const run = () => void runEmailQueueSweep();
  const initial = setTimeout(run, 1_000);
  const interval = setInterval(run, 30_000);
  initial.unref();
  interval.unref();
  return () => { clearTimeout(initial); clearInterval(interval); };
}