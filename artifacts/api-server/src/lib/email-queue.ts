import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, organizationSettings, outboundEmails, users } from "@workspace/db";
import { deliverEmail, type EmailDeliveryInput, type EmailPdfAttachment } from "./email";
import { removeEmailPdfAttachment } from "./email-attachments";
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
  const recipientMap = new Map([...internal, ...explicit]
    .map((recipient) => [recipient.email.trim().toLowerCase(), { email: recipient.email.trim().toLowerCase(), name: recipient.name ?? null }]));
  const ccRecipients = [...new Map((input.ccRecipients ?? [])
    .filter((recipient) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email))
    .map((recipient) => [recipient.email.trim().toLowerCase(), { email: recipient.email.trim().toLowerCase(), name: recipient.name ?? null }]))
    .values()].filter((recipient) => !recipientMap.has(recipient.email));
  const recipients = [...recipientMap.values()];
  if (!recipients.length) return { queued: 0 };

  const policy = await getEmailDeliveryPolicy(database, input.organizationId);
  const context: Record<string, unknown> = { ...(input.context ?? {}) };
  delete context.emailAttachments;
  if (input.attachments?.length) context.emailAttachments = input.attachments;
  const eventType = typeof context.eventType === "string" ? context.eventType : null;
  const ruleId = context.kind === "email_event_rule" && typeof context.ruleId === "string" ? context.ruleId : null;
  const entityId = typeof context.entityId === "string" ? context.entityId : null;
  await database.insert(outboundEmails).values(recipients.map((recipient, index) => ({
    organizationId: input.organizationId,
    app: applicationFromContext(context),
    eventType,
    ruleId,
    entityId,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    ccRecipients: index === 0 ? ccRecipients : [],
    senderEmail: input.sender?.email ?? null,
    senderName: input.sender?.name ?? null,
    subject: input.subject,
    bodyText: input.text,
    bodyHtml: input.html ?? null,
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
  const retryEnvelopeRecipients = Array.isArray(row.context.retryEnvelopeRecipients)
    ? row.context.retryEnvelopeRecipients.filter((email): email is string => typeof email === "string")
    : undefined;
  const result = await deliverEmail(database, {
    organizationId: row.organizationId,
    recipientIds: [],
    recipients: [{ email: row.recipientEmail, name: row.recipientName }],
    ccRecipients: row.ccRecipients,
    envelopeRecipients: retryEnvelopeRecipients,
    sender: row.senderEmail ? { email: row.senderEmail, name: row.senderName } : undefined,
    subject: row.subject,
    text: row.bodyText,
    html: row.bodyHtml ?? undefined,
    attachments: row.context.emailAttachments === undefined
      ? undefined
      : row.context.emailAttachments as EmailPdfAttachment[],
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
    context: result.attempted && result.rejectedEnvelopeRecipients?.length
      ? { ...row.context, retryEnvelopeRecipients: result.rejectedEnvelopeRecipients }
      : row.context,
    nextAttemptAt: exhausted ? attemptedAt : new Date(attemptedAt.getTime() + policy.retryDelayMinutes * 60_000),
    lockedAt: null,
    updatedAt: new Date(),
  }).where(eq(outboundEmails.id, row.id));
}

export async function purgeExpiredEmailLogs(database: Database) {
  const orgRows = await database.selectDistinct({ organizationId: outboundEmails.organizationId })
    .from(outboundEmails).where(isNull(outboundEmails.deletedAt));
  for (const { organizationId } of orgRows) {
    const policy = await getEmailDeliveryPolicy(database, organizationId);
    const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000);
    const expiryCondition = and(
      eq(outboundEmails.organizationId, organizationId),
      inArray(outboundEmails.deliveryStatus, ["sent", "failed"]),
      lt(outboundEmails.updatedAt, cutoff),
      isNull(outboundEmails.deletedAt),
    );
    const expiredRows = await database.select({
      id: outboundEmails.id,
      context: outboundEmails.context,
    }).from(outboundEmails).where(expiryCondition);
    if (!expiredRows.length) continue;

    const referencedRows = await database.select({
      id: outboundEmails.id,
      context: outboundEmails.context,
    }).from(outboundEmails).where(and(
      eq(outboundEmails.organizationId, organizationId),
      isNull(outboundEmails.deletedAt),
      sql`${outboundEmails.context} ? 'emailAttachments'`,
    ));
    const expiredIds = new Set(expiredRows.map((row) => row.id));
    const attachmentsByRow = new Map<string, { paths: string[]; malformed: boolean }>();
    const rowsByPath = new Map<string, Set<string>>();
    for (const row of referencedRows) {
      const value = row.context.emailAttachments;
      if (value === undefined) continue;
      const paths: string[] = [];
      let malformed = !Array.isArray(value);
      if (Array.isArray(value)) {
        for (const attachment of value) {
          if (attachment && typeof attachment === "object" && typeof attachment.objectPath === "string") {
            paths.push(attachment.objectPath);
          } else {
            malformed = true;
          }
        }
      }
      attachmentsByRow.set(row.id, { paths: [...new Set(paths)], malformed });
      for (const path of paths) {
        const references = rowsByPath.get(path) ?? new Set<string>();
        references.add(row.id);
        rowsByPath.set(path, references);
      }
    }

    const removalFailedPaths = new Set<string>();
    const unknownReferencesExist = [...attachmentsByRow.values()].some((attachments) => attachments.malformed);
    if (unknownReferencesExist) {
      logger.warn("Email PDF attachment metadata is invalid; retaining queue metadata and skipping attachment cleanup");
    }
    const candidatePaths = new Set(expiredRows.flatMap((row) => attachmentsByRow.get(row.id)?.paths ?? []));
    for (const path of candidatePaths) {
      if (unknownReferencesExist) continue;
      const references = rowsByPath.get(path) ?? new Set<string>();
      // Keep objects while any non-expired, non-deleted queue row still has
      // live metadata pointing at them.
      if ([...references].some((id) => !expiredIds.has(id) || attachmentsByRow.get(id)?.malformed)) continue;
      try {
        await removeEmailPdfAttachment(organizationId, path);
      } catch {
        // Do not log object paths or provider errors; retaining queue metadata
        // lets the next sweep retry the deletion safely.
        logger.warn("Email PDF attachment cleanup failed; retaining queue metadata for retry");
        removalFailedPaths.add(path);
      }
    }

    const deletableIds = expiredRows.filter((row) => {
      const attachments = attachmentsByRow.get(row.id);
      return !attachments?.malformed
        && !(unknownReferencesExist && attachments?.paths.length)
        && !attachments?.paths.some((path) => removalFailedPaths.has(path));
    }).map((row) => row.id);
    if (deletableIds.length) {
      await database.delete(outboundEmails).where(and(
        eq(outboundEmails.organizationId, organizationId),
        inArray(outboundEmails.id, deletableIds),
        isNull(outboundEmails.deletedAt),
      ));
    }
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