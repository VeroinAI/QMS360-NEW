import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import express, { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { evidenceLimits, evidenceTable } from "../lib/evidence";
import { validateEvidenceFile } from "../lib/files";
import { getObject, storeObject } from "../lib/objectStorage";
import type { AppKey } from "../lib/workspace";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const uploadDir = path.resolve(process.cwd(), "uploads");
const apps: AppKey[] = ["qaqc", "lessons", "audit"];

async function findEvidence(id: string, organizationId: string) {
  for (const app of apps) {
    const table = evidenceTable(app);
    const [row] = await db.select().from(table).where(and(
      eq(table.id, id), eq(table.organizationId, organizationId), isNull(table.deletedAt),
    )).limit(1);
    if (row) return { app, table, row };
  }
  return null;
}

router.put("/:evidenceId", requireAuth,
  // The same-artifact endpoint intentionally accepts bytes rather than multipart.
  express.raw({ type: "*/*", limit: "210mb" }),
 async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const found = await findEvidence(String(req.params.evidenceId), user.organizationId);
  if (!found) { res.status(404).json({ error: "Evidence upload intent not found" }); return; }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  try {
    validateEvidenceFile(found.row.mimeType, body.byteLength, await evidenceLimits(user.organizationId));
    if (body.byteLength !== found.row.sizeBytes) {
      res.status(422).json({ error: "Uploaded byte count does not match the declared size" }); return;
    }
    let storageKey: string;
    try {
      storageKey = `gcs:${await storeObject(`qms360/${found.app}/${found.row.id}`, body, found.row.mimeType)}`;
    } catch (storageError) {
      req.log.warn({ storageError }, "Object storage unavailable; using local upload fallback");
      await mkdir(uploadDir, { recursive: true });
      storageKey = `local:${found.app}/${found.row.id}`;
      await writeFile(path.join(uploadDir, `${found.app}-${found.row.id}`), body, { flag: "wx" });
    }
    await db.update(found.table).set({ storageKey, status: "stored", updatedAt: new Date() })
      .where(and(
        eq(found.table.id, found.row.id),
        eq(found.table.organizationId, user.organizationId),
        isNull(found.table.deletedAt),
      ));
    res.json({ id: found.row.id, status: "stored" });
  } catch (error) {
    await db.update(found.table).set({ status: "failed", updatedAt: new Date() }).where(eq(found.table.id, found.row.id));
    res.status(422).json({ error: error instanceof Error ? error.message : "Upload failed" });
  }
});

router.head("/:evidenceId", requireAuth, async (req, res): Promise<void> => {
  const found = await findEvidence(String(req.params.evidenceId), req.currentUser!.organizationId);
  if (!found || found.row.status !== "stored") { res.status(404).end(); return; }
  res.setHeader("Content-Type", found.row.mimeType);
  res.setHeader("Content-Length", found.row.sizeBytes);
  res.setHeader("Content-Disposition", `inline; filename="${found.row.fileName.replaceAll('"', "")}"`);
  if (found.row.storageKey.startsWith("gcs:")) {
    try {
      const object = await getObject(found.row.storageKey.slice(4));
      await object.body?.cancel();
      res.status(200).end();
    } catch {
      res.status(404).end();
    }
    return;
  }
  const localKey = found.row.storageKey.replace(/^local:/, "");
  try {
    await stat(path.join(uploadDir, localKey.replace("/", "-")));
    res.status(200).end();
  } catch {
    res.status(404).end();
  }
});

router.get("/:evidenceId", requireAuth, async (req, res): Promise<void> => {
  const found = await findEvidence(String(req.params.evidenceId), req.currentUser!.organizationId);
  if (!found || found.row.status !== "stored") { res.status(404).json({ error: "Evidence file not found" }); return; }
  if (found.row.storageKey.startsWith("gcs:")) {
    try {
      const object = await getObject(found.row.storageKey.slice(4));
      res.setHeader("Content-Type", object.headers.get("content-type") ?? found.row.mimeType);
      const length = object.headers.get("content-length");
      if (length) res.setHeader("Content-Length", length);
      res.setHeader("Content-Disposition", `inline; filename="${found.row.fileName.replaceAll('"', "")}"`);
      Readable.fromWeb(object.body as import("node:stream/web").ReadableStream).pipe(res);
    } catch {
      res.status(404).json({ error: "Stored evidence object is unavailable" });
    }
    return;
  }
  const localKey = found.row.storageKey.replace(/^local:/, "");
  const filePath = path.join(uploadDir, localKey.replace("/", "-"));
  try {
    const info = await stat(filePath);
    res.setHeader("Content-Type", found.row.mimeType);
    res.setHeader("Content-Length", info.size);
    res.setHeader("Content-Disposition", `inline; filename="${found.row.fileName.replaceAll('"', "")}"`);
    createReadStream(filePath).pipe(res);
  } catch {
    res.status(404).json({ error: "Stored evidence object is unavailable" });
  }
});

export default router;