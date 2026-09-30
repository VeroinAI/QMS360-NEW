import { randomUUID } from "node:crypto";
import { getObject, removeObject, storeObject } from "./objectStorage";

export type EmailPdfAttachment = {
  filename: string;
  contentType: "application/pdf";
  objectPath: string;
};

const MAX_EMAIL_PDF_BYTES = 10 * 1024 * 1024;

function sanitizeObjectPathPart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "record";
}

/**
 * Stores one private PDF under a unique per-delivery path and returns the
 * durable metadata to include in an outbound email queue entry.
 */
export async function storeEmailPdfAttachment(
  organizationId: string,
  recordId: string,
  bytes: Buffer,
): Promise<EmailPdfAttachment> {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_EMAIL_PDF_BYTES) {
    throw new Error("Email PDF attachment must be 10 MB or smaller");
  }
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Email attachment must contain a PDF");
  }
  const organizationPart = sanitizeObjectPathPart(organizationId);
  const recordPart = sanitizeObjectPathPart(recordId);
  const filename = `${recordPart}.pdf`;
  const relativePath = `email-attachments/${organizationPart}/${recordPart}/${randomUUID()}.pdf`;
  const objectPath = await storeObject(relativePath, bytes, "application/pdf");
  return { filename, contentType: "application/pdf", objectPath };
}

function validateEmailPdfPath(organizationId: string, objectPath: string) {
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  const prefix = root ? `${root}/email-attachments/${sanitizeObjectPathPart(organizationId)}/` : "";
  if (!prefix || !objectPath.startsWith(prefix) || objectPath.includes("\\") || /[?#]/.test(objectPath)) {
    throw new Error("Email PDF attachment has an invalid private object path");
  }
  const parts = objectPath.slice(prefix.length).split("/");
  if (parts.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(parts[0]!)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(parts[1]!)) {
    throw new Error("Email PDF attachment has an invalid private object path");
  }
}

export async function removeEmailPdfAttachment(organizationId: string, objectPath: string) {
  validateEmailPdfPath(organizationId, objectPath);
  await removeObject(objectPath);
}

export async function loadEmailPdfAttachments(organizationId: string, attachments: EmailPdfAttachment[]) {
  return Promise.all(attachments.map(async (attachment) => {
    if (!attachment || attachment.contentType !== "application/pdf"
      || typeof attachment.filename !== "string" || typeof attachment.objectPath !== "string") {
      throw new Error("Email attachment metadata is invalid");
    }
    validateEmailPdfPath(organizationId, attachment.objectPath);
    const response = await getObject(attachment.objectPath);
    if ((response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== "application/pdf") {
      throw new Error("Email attachment object is not a PDF");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_EMAIL_PDF_BYTES) {
      throw new Error("Email PDF attachment exceeds the 10 MB limit");
    }
    if (!response.body) throw new Error("Email PDF attachment could not be read");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_EMAIL_PDF_BYTES) {
          await reader.cancel();
          throw new Error("Email PDF attachment exceeds the 10 MB limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    const content = Buffer.concat(chunks, length);
    if (!content.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("Email attachment object is not a PDF");
    }
    const safeFilename = attachment.filename.replaceAll("\\", "_").replaceAll("/", "_").replace(/[\r\n\0]/g, "_");
    return {
      filename: safeFilename.toLowerCase().endsWith(".pdf") ? safeFilename : `${safeFilename}.pdf`,
      contentType: "application/pdf" as const,
      content,
    };
  }));
}