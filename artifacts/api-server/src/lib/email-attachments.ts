import { randomUUID } from "node:crypto";
import { getObject, removeObject, storeObject } from "./objectStorage";
import { privateObjectPath } from "./storage-config";

export type EmailReportAttachment = {
  filename: string;
  contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  objectPath: string;
};
export type EmailPdfAttachment = EmailReportAttachment & { contentType: "application/pdf" };

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
  return { ...await storeEmailReportAttachment(organizationId, recordId, bytes, "pdf"), contentType: "application/pdf" };
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
function reportKind(mime: string) {
  if (mime === "application/pdf") return "pdf";
  if (mime === PPTX_MIME) return "pptx";
  throw new Error("Email attachment metadata is invalid");
}
function validateReportBytes(bytes: Buffer, kind: "pdf" | "pptx") {
  if (kind === "pdf" ? !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    : !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error(`Email attachment must contain a ${kind.toUpperCase()} report`);
  }
}

export async function storeEmailReportAttachment(
  organizationId: string, recordId: string, bytes: Buffer, kind: "pdf" | "pptx",
): Promise<EmailReportAttachment> {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_EMAIL_PDF_BYTES) {
    throw new Error("Email PDF attachment must be 10 MB or smaller");
  }
  validateReportBytes(bytes, kind);
  const organizationPart = sanitizeObjectPathPart(organizationId);
  const recordPart = sanitizeObjectPathPart(recordId);
  const filename = `${recordPart}.${kind}`;
  const relativePath = `email-attachments/${organizationPart}/${recordPart}/${randomUUID()}.${kind}`;
  const contentType = kind === "pdf" ? "application/pdf" : PPTX_MIME;
  const objectPath = await storeObject(relativePath, bytes, contentType);
  return { filename, contentType, objectPath };
}

function validateEmailPdfPath(organizationId: string, objectPath: string) {
  const prefix = `${privateObjectPath(`email-attachments/${sanitizeObjectPathPart(organizationId)}`)}/`;
  if (!prefix || !objectPath.startsWith(prefix) || objectPath.includes("\\") || /[?#]/.test(objectPath)) {
    throw new Error("Email PDF attachment has an invalid private object path");
  }
  const parts = objectPath.slice(prefix.length).split("/");
  if (parts.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(parts[0]!)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|pptx)$/i.test(parts[1]!)) {
    throw new Error("Email PDF attachment has an invalid private object path");
  }
}

export async function removeEmailPdfAttachment(organizationId: string, objectPath: string) {
  validateEmailPdfPath(organizationId, objectPath);
  await removeObject(objectPath);
}

export async function loadEmailPdfAttachments(organizationId: string, attachments: EmailReportAttachment[]) {
  return Promise.all(attachments.map(async (attachment) => {
    if (!attachment || !["application/pdf", PPTX_MIME].includes(attachment.contentType)
      || typeof attachment.filename !== "string" || typeof attachment.objectPath !== "string") {
      throw new Error("Email attachment metadata is invalid");
    }
    validateEmailPdfPath(organizationId, attachment.objectPath);
    const kind = reportKind(attachment.contentType);
    if (!attachment.objectPath.endsWith(`.${kind}`)) throw new Error("Email attachment format does not match its private object path");
    const response = await getObject(attachment.objectPath);
    if ((response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== attachment.contentType) {
      throw new Error(kind === "pdf" ? "Email attachment object is not a PDF" : "Email attachment object is not a PowerPoint report");
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
    validateReportBytes(content, kind);
    const safeFilename = attachment.filename.replaceAll("\\", "_").replaceAll("/", "_").replace(/[\r\n\0]/g, "_");
    return {
      filename: safeFilename.toLowerCase().endsWith(`.${kind}`) ? safeFilename : `${safeFilename}.${kind}`,
      contentType: attachment.contentType,
      content,
    };
  }));
}