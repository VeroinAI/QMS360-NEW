import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { readAuditPlanSignature } from "./audit-plan-signatures";
import { getObject, storeObject } from "./objectStorage";
import { toStorageKey } from "./storage-config";
import { actionableFinding, carJson } from "./car-register";

type Row = Record<string, any>;
export interface CarSignatureEvidence {
  organizationId: string;
  recordId: string;
  userId: string;
  capturedAt: string;
  path: string | null;
  sha256: string | null;
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const missingObject = (error: unknown) => /404|NoSuchKey|not found|Missing object/i.test(String(error));

/** Capture at finding creation or response submission, never during a download.
 * Missing profiles/objects are explicit gaps; failed durable writes abort the event.
 */
export async function captureCarSignature(database: typeof db, organizationId: string, recordId: string, userId: string): Promise<CarSignatureEvidence> {
  const evidence: CarSignatureEvidence = {
    organizationId, recordId, userId, capturedAt: new Date().toISOString(), path: null, sha256: null,
  };
  const [person] = await database.select({ signaturePath: users.signaturePath }).from(users).where(and(
    eq(users.organizationId, organizationId), eq(users.id, userId),
  ));
  if (!person?.signaturePath) return evidence;
  let bytes: Uint8Array | undefined;
  try { bytes = await readAuditPlanSignature(person.signaturePath); }
  catch (error) { if (!missingObject(error)) throw error; }
  if (!bytes) return evidence;
  evidence.path = toStorageKey(await storeObject(
    `qms360/car-signature-evidence/${organizationId}/${recordId}/${randomUUID()}.png`, Buffer.from(bytes), "image/png",
  ));
  evidence.sha256 = digest(bytes);
  return evidence;
}

/** The audit row must already be locked; client metadata never supplies evidence. */
export async function checklistSignatureStatus(database: typeof db, organizationId: string, audit: Row, checklist: Row[], userId: string): Promise<string> {
  const meta = carJson(audit.status);
  const prior: Row[] = Array.isArray(audit.checklistState) ? audit.checklistState : [];
  const created = checklist.filter(item => actionableFinding(item) && !prior.some(old => old.id === item.id && actionableFinding(old))
    && !meta.carOriginatorSignatures?.[item.id]);
  if (created.length) {
    const signatures = { ...meta.carOriginatorSignatures };
    for (const item of created) signatures[item.id] = await captureCarSignature(database, organizationId, item.id, userId);
    meta.carOriginatorSignatures = signatures;
  }
  return JSON.stringify(meta);
}

/** Only immutable evidence from this tenant/record can be rendered. No profile fallback. */
export async function readCarSignature(evidence: CarSignatureEvidence | undefined, organizationId: string, recordId: string): Promise<Uint8Array | undefined> {
  if (!evidence?.path || evidence.organizationId !== organizationId || evidence.recordId !== recordId
    || !evidence.path.includes(`/car-signature-evidence/${organizationId}/${recordId}/`)) return undefined;
  const object = await getObject(evidence.path.replace(/^gcs:/, ""));
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (digest(bytes) !== evidence.sha256) throw new Error("CAR signature evidence integrity check failed");
  return bytes;
}
