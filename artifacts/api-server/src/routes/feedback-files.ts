import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import express, { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, feedbackAttachments, feedbackEntries } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { isAdminUser } from "../lib/field-access";
import { getObject, storeObject } from "../lib/objectStorage";
import {
  findFallbackAttachment,
  forceAttachmentFallback,
  hasPostgresCode,
  updateFallbackAttachment,
  type FeedbackAttachmentMetadata,
} from "../lib/feedback-attachment-fallback";

const router: IRouter = Router();
const uploadDir = path.join(process.cwd(), ".local", "uploads", "feedback");

function mayDownload(req: Express.Request, ownerId: string) {
  const user = req.currentUser!;
  return ownerId === user.id || isAdminUser({ platformRole: user.platformRole, workspaceRoles: user.workspaceRoles });
}

function fileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function contentMatches(fileName: string, bytes: Buffer) {
  const extension = fileExtension(fileName);
  if (extension === "pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if (extension === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === "jpg" || extension === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (extension === "docx" || extension === "xlsx") return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (extension === "doc" || extension === "xls") return bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (extension === "txt" || extension === "csv") return !bytes.includes(0);
  return false;
}

async function findAttachment(id: string, organizationId: string) {
  if (!forceAttachmentFallback()) {
    try {
      const [row] = await db.select({ attachment: feedbackAttachments, ownerId: feedbackEntries.userId })
        .from(feedbackAttachments)
        .innerJoin(feedbackEntries, eq(feedbackEntries.id, feedbackAttachments.feedbackId))
        .where(and(
          eq(feedbackAttachments.id, id),
          eq(feedbackAttachments.organizationId, organizationId),
          isNull(feedbackAttachments.deletedAt),
          isNull(feedbackEntries.deletedAt),
        )).limit(1);
      if (row) return { ...row, feedbackId: row.attachment.feedbackId, fallback: false as const };
    } catch (error) {
      if (!hasPostgresCode(error, "42P01")) throw error;
    }
  }
  const fallback = await findFallbackAttachment(id, organizationId);
  return fallback ? { ...fallback, fallback: true as const } : undefined;
}

async function setAttachmentState(
  found: NonNullable<Awaited<ReturnType<typeof findAttachment>>>,
  changes: Partial<Pick<FeedbackAttachmentMetadata, "status" | "storageKey">>,
) {
  if (found.fallback) {
    await updateFallbackAttachment(found.feedbackId, found.attachment.id, changes);
    return;
  }
  await db.update(feedbackAttachments).set({ ...changes, updatedAt: new Date() })
    .where(eq(feedbackAttachments.id, found.attachment.id));
}

router.put("/:attachmentId/upload", requireAuth, express.raw({ type: "*/*", limit: "10mb" }), async (req, res): Promise<void> => {
  const found = await findAttachment(String(req.params.attachmentId), req.currentUser!.organizationId);
  if (!found || found.attachment.uploadedById !== req.currentUser!.id || found.attachment.status !== "uploading") {
    res.status(404).json({ error: "Feedback attachment upload intent not found" }); return;
  }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (body.byteLength !== found.attachment.sizeBytes) {
    await setAttachmentState(found, { status: "failed" });
    res.status(422).json({ error: "Uploaded byte count does not match the declared size" }); return;
  }
  if (!contentMatches(found.attachment.fileName, body)) {
    await setAttachmentState(found, { status: "failed" });
    res.status(422).json({ error: "The file contents do not match the selected file type" }); return;
  }
  try {
    let storageKey: string;
    try {
      const stored = await storeObject(`qms360/feedback/${req.currentUser!.organizationId}/${found.feedbackId}/${found.attachment.id}`, body, found.attachment.mimeType);
      storageKey = `gcs:${stored}`;
    } catch (storageError) {
      req.log.warn({ storageError }, "Object storage unavailable; using local feedback upload fallback");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, found.attachment.id), body, { flag: "wx" });
      storageKey = `local:${found.attachment.id}`;
    }
    await setAttachmentState(found, { storageKey, status: "stored" });
    res.json({ id: found.attachment.id, status: "stored" });
  } catch (error) {
    await setAttachmentState(found, { status: "failed" });
    res.status(422).json({ error: error instanceof Error ? error.message : "Upload failed" });
  }
});

router.get("/:attachmentId/file", requireAuth, async (req, res): Promise<void> => {
  const found = await findAttachment(String(req.params.attachmentId), req.currentUser!.organizationId);
  if (!found || !mayDownload(req, found.ownerId) || found.attachment.status !== "stored") {
    res.status(404).json({ error: "Feedback attachment not found" }); return;
  }
  const safeName = found.attachment.fileName.replaceAll('"', "");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (found.attachment.storageKey.startsWith("gcs:")) {
    try {
      const object = await getObject(found.attachment.storageKey.slice(4));
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      Readable.fromWeb(object.body as import("node:stream/web").ReadableStream).pipe(res);
    } catch {
      res.status(404).json({ error: "Stored attachment is unavailable" });
    }
    return;
  }
  try {
    const filePath = path.join(uploadDir, found.attachment.id);
    const info = await stat(filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", info.size);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    createReadStream(filePath).pipe(res);
  } catch {
    res.status(404).json({ error: "Stored attachment is unavailable" });
  }
});

export default router;