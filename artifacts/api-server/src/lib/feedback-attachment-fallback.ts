import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, feedbackEntries } from "@workspace/db";

export type FeedbackAttachmentMetadata = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "stored" | "failed";
  storageKey: string;
  uploadedById: string;
  createdAt: string;
};

export function hasPostgresCode(error: unknown, expectedCode: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if ((current as { code?: unknown }).code === expectedCode) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function forceAttachmentFallback() {
  return process.env.FEEDBACK_ATTACHMENTS_FORCE_FALLBACK === "true";
}

export function fallbackAttachmentsFromTriage(value: unknown): FeedbackAttachmentMetadata[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const attachments = (value as Record<string, unknown>)._attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((item): item is FeedbackAttachmentMetadata => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return typeof row.id === "string"
      && typeof row.fileName === "string"
      && typeof row.mimeType === "string"
      && typeof row.sizeBytes === "number"
      && ["uploading", "stored", "failed"].includes(String(row.status))
      && typeof row.storageKey === "string"
      && typeof row.uploadedById === "string";
  });
}

export function publicTriage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const { _attachments: _privateAttachments, ...triage } = value as Record<string, unknown>;
  return Object.keys(triage).length ? triage : null;
}

export async function appendFallbackAttachment(feedbackId: string, attachment: FeedbackAttachmentMetadata) {
  await db.update(feedbackEntries).set({
    triage: sql`jsonb_set(
      coalesce(${feedbackEntries.triage}, '{}'::jsonb),
      '{_attachments}',
      coalesce(${feedbackEntries.triage} -> '_attachments', '[]'::jsonb) || ${JSON.stringify([attachment])}::jsonb,
      true
    )`,
    updatedAt: new Date(),
  }).where(eq(feedbackEntries.id, feedbackId));
}

export async function updateFallbackAttachment(
  feedbackId: string,
  attachmentId: string,
  changes: Partial<Pick<FeedbackAttachmentMetadata, "status" | "storageKey">>,
) {
  const [entry] = await db.select({ triage: feedbackEntries.triage }).from(feedbackEntries)
    .where(eq(feedbackEntries.id, feedbackId)).limit(1);
  if (!entry) return false;
  const attachments = fallbackAttachmentsFromTriage(entry.triage);
  const index = attachments.findIndex((attachment) => attachment.id === attachmentId);
  if (index < 0) return false;
  attachments[index] = { ...attachments[index]!, ...changes };
  await db.update(feedbackEntries).set({
    triage: sql`jsonb_set(
      coalesce(${feedbackEntries.triage}, '{}'::jsonb),
      '{_attachments}',
      ${JSON.stringify(attachments)}::jsonb,
      true
    )`,
    updatedAt: new Date(),
  }).where(eq(feedbackEntries.id, feedbackId));
  return true;
}

export async function findFallbackAttachment(attachmentId: string, organizationId: string) {
  const [entry] = await db.select({
    id: feedbackEntries.id,
    ownerId: feedbackEntries.userId,
    triage: feedbackEntries.triage,
  }).from(feedbackEntries).where(and(
    eq(feedbackEntries.organizationId, organizationId),
    isNull(feedbackEntries.deletedAt),
    sql`${feedbackEntries.triage} -> '_attachments' @> ${JSON.stringify([{ id: attachmentId }])}::jsonb`,
  )).limit(1);
  if (!entry) return undefined;
  const attachment = fallbackAttachmentsFromTriage(entry.triage)
    .find((candidate) => candidate.id === attachmentId);
  return attachment ? { attachment, feedbackId: entry.id, ownerId: entry.ownerId } : undefined;
}

export async function fallbackAttachmentsByFeedback(ids: string[]) {
  const grouped = new Map<string, FeedbackAttachmentMetadata[]>();
  if (!ids.length) return grouped;
  const rows = await db.select({ id: feedbackEntries.id, triage: feedbackEntries.triage })
    .from(feedbackEntries).where(inArray(feedbackEntries.id, ids));
  for (const row of rows) {
    const stored = fallbackAttachmentsFromTriage(row.triage)
      .filter((attachment) => attachment.status === "stored");
    if (stored.length) grouped.set(row.id, stored);
  }
  return grouped;
}