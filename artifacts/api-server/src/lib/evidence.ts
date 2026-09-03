import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  auditEvidenceFiles, db, evidenceFiles, lessonsEvidenceFiles, organizationSettings,
} from "@workspace/db";
import { validateEvidenceFile } from "./files";
import type { AppKey } from "./workspace";

export function evidenceTable(app: AppKey) {
  return app === "qaqc" ? evidenceFiles : app === "lessons" ? lessonsEvidenceFiles : auditEvidenceFiles;
}

export type EvidenceIntentInput = {
  app: AppKey;
  recordType: string;
  recordId: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  clientReference?: string;
  userId: string;
  organizationId: string;
};

export async function evidenceLimits(organizationId: string) {
  const [settings] = await db.select({ evidenceLimits: organizationSettings.evidenceLimits })
    .from(organizationSettings)
    .where(and(
      eq(organizationSettings.organizationId, organizationId),
      isNull(organizationSettings.deletedAt),
    ))
    .limit(1);
  return settings?.evidenceLimits;
}

export async function createEvidenceIntent(input: EvidenceIntentInput) {
  validateEvidenceFile(input.mimeType, input.sizeBytes, await evidenceLimits(input.organizationId));
  const table = evidenceTable(input.app);
  if (input.clientReference) {
    const [existing] = await db.select({ id: table.id }).from(table).where(and(
      eq(table.organizationId, input.organizationId),
      eq(table.clientReference, input.clientReference),
      isNull(table.deletedAt),
    )).limit(1);
    if (existing) return { id: existing.id, uploadUrl: `/api/files/${existing.id}` };
  }

  const id = randomUUID();
  await db.insert(table).values({
    id,
    organizationId: input.organizationId,
    recordType: input.recordType,
    recordId: input.recordId,
    category: input.category,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageKey: "",
    uploadedById: input.userId,
    status: "uploading",
    clientReference: input.clientReference,
  });
  return { id, uploadUrl: `/api/files/${id}` };
}

export async function confirmEvidence(database: any, app: AppKey, id: string, organizationId: string) {
  const table = evidenceTable(app);
  const [row] = await database.update(table)
    .set({ status: "stored", updatedAt: new Date() })
    .where(and(eq(table.id, id), eq(table.organizationId, organizationId), isNull(table.deletedAt)))
    .returning();
  return row ?? null;
}

export async function listEvidence(database: any, app: AppKey, organizationId: string, recordType: string, recordId: string) {
  const table = evidenceTable(app);
  return database.select().from(table).where(and(
    eq(table.organizationId, organizationId), eq(table.recordType, recordType),
    eq(table.recordId, recordId), isNull(table.deletedAt),
  ));
}

export async function deleteEvidence(database: any, app: AppKey, id: string, organizationId: string) {
  const table = evidenceTable(app);
  const [row] = await database.update(table).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(table.id, id), eq(table.organizationId, organizationId), isNull(table.deletedAt))).returning();
  return row ?? null;
}