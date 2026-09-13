import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import express, { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  applicationAccess, auditFindings, auditSchedules, audits, correctiveActionReports, customerSatisfactionEntries,
  db, documentGovernanceLogEntries, lessonLearnedForms, materialInspectionEntries, qaqcMetricEntries,
  qualityAssessmentBriefs, qtbtEntries,
} from "@workspace/db";
import { evidenceLimits, evidenceTable } from "../lib/evidence";
import { validateEvidenceFile } from "../lib/files";
import { getObject, storeObject } from "../lib/objectStorage";
import type { AppKey } from "../lib/workspace";
import { requireAuth } from "../middlewares/auth";
import { getAuthorizedProjectScope, type AppKey as RbacAppKey, type PermissionAction } from "../middlewares/rbac";
import { canReadLesson } from "./lessons";

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

const appAccessColumns = {
  qaqc: applicationAccess.canOpenQaqc,
  lessons: applicationAccess.canOpenLessons,
  audit: applicationAccess.canOpenAudit,
};
type EvidenceParent = {
  projectId: string;
  projectIds?: string[];
  module: string;
  creatorId?: string;
  approverId?: string | null;
};
function scheduleProjectIds(status: string | null, projectId: string | null) {
  try {
    const parsed = JSON.parse(status ?? "{}") as { projectIds?: unknown };
    const projectIds = Array.isArray(parsed.projectIds)
      ? parsed.projectIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (projectIds.length) return projectIds;
  } catch {
    // Legacy schedules may have a non-JSON status value; use their primary project instead.
  }
  return projectId ? [projectId] : [];
}
async function evidenceProject(found: Awaited<ReturnType<typeof findEvidence>>, organizationId: string): Promise<EvidenceParent | null> {
  if (!found) return null;
  const { app, row } = found;
  if (app === "lessons") {
    const [lesson] = await db.select({
      projectId: lessonLearnedForms.projectId, creatorId: lessonLearnedForms.creatorId, approverId: lessonLearnedForms.approverId,
    }).from(lessonLearnedForms).where(and(
      eq(lessonLearnedForms.id, row.recordId), eq(lessonLearnedForms.organizationId, organizationId), isNull(lessonLearnedForms.deletedAt),
    ));
    return lesson ? { projectId: lesson.projectId, module: "lessons", creatorId: lesson.creatorId, approverId: lesson.approverId } : null;
  }
  if (app === "audit") {
    if (row.recordType === "audit_schedule") {
      const [parent] = await db.select({ projectId: auditSchedules.projectId, status: auditSchedules.status }).from(auditSchedules).where(and(
        eq(auditSchedules.id, row.recordId), eq(auditSchedules.organizationId, organizationId), isNull(auditSchedules.deletedAt),
      ));
      const projectIds = parent ? scheduleProjectIds(parent.status, parent.projectId) : [];
      return projectIds.length ? { projectId: projectIds[0]!, projectIds, module: "schedules" } : null;
    }
    if (["audit", "audit_execution"].includes(row.recordType)) {
      const [parent] = await db.select({ projectId: audits.projectId }).from(audits).where(and(eq(audits.id, row.recordId), eq(audits.organizationId, organizationId), isNull(audits.deletedAt)));
      return parent?.projectId ? { projectId: parent.projectId, module: "audits" } : null;
    }
    if (["audit_finding", "finding"].includes(row.recordType)) {
      const [parent] = await db.select({ projectId: audits.projectId }).from(auditFindings).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(and(eq(auditFindings.id, row.recordId), eq(auditFindings.organizationId, organizationId), isNull(auditFindings.deletedAt), isNull(audits.deletedAt)));
      return parent?.projectId ? { projectId: parent.projectId, module: "findings" } : null;
    }
    const [parent] = await db.select({ projectId: audits.projectId }).from(correctiveActionReports)
      .innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id))
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(correctiveActionReports.id, row.recordId), eq(correctiveActionReports.organizationId, organizationId), isNull(correctiveActionReports.deletedAt), isNull(auditFindings.deletedAt), isNull(audits.deletedAt)));
    return parent?.projectId ? { projectId: parent.projectId, module: "cars" } : null;
  }
  const qaqcParents: Record<string, { table: any; module: string }> = {
    metric: { table: qaqcMetricEntries, module: "metrics" }, qaqc_metric: { table: qaqcMetricEntries, module: "metrics" },
    material_inspection: { table: materialInspectionEntries, module: "material_inspections" },
    qtbt: { table: qtbtEntries, module: "qtbt" },
    customer_satisfaction: { table: customerSatisfactionEntries, module: "customer_satisfaction" },
    document_governance: { table: documentGovernanceLogEntries, module: "document_governance" },
    quality_brief: { table: qualityAssessmentBriefs, module: "quality_briefs" },
  };
  const target = qaqcParents[row.recordType];
  if (!target) return null;
  const [parent] = await db.select({ projectId: target.table.projectId }).from(target.table).where(and(
    eq(target.table.id, row.recordId), eq(target.table.organizationId, organizationId), isNull(target.table.deletedAt),
  ));
  return parent?.projectId ? { projectId: parent.projectId, module: target.module } : null;
}

async function authorizeEvidence(req: express.Request, found: NonNullable<Awaited<ReturnType<typeof findEvidence>>>, action: PermissionAction) {
  const user = req.currentUser!;
  if (!["Super Admin", "Org Admin"].includes(user.platformRole)) {
    const column = appAccessColumns[found.app];
    const [access] = await db.select({ allowed: column }).from(applicationAccess).where(and(
      eq(applicationAccess.organizationId, user.organizationId), eq(applicationAccess.username, user.username),
      eq(column, true), isNull(applicationAccess.deletedAt),
    )).limit(1);
    if (!access) return false;
  }
  const parent = await evidenceProject(found, user.organizationId);
  if (!parent) return false;
  const scope = await getAuthorizedProjectScope(req, found.app as RbacAppKey, { module: parent.module, action });
  if (!scope.unrestricted && (parent.projectIds ?? [parent.projectId]).some((projectId) => !scope.projectIds.includes(projectId))) return false;
  if (found.app === "lessons" && action === "select") {
    const [lesson] = await db.select().from(lessonLearnedForms).where(and(
      eq(lessonLearnedForms.id, found.row.recordId),
      eq(lessonLearnedForms.organizationId, user.organizationId),
      isNull(lessonLearnedForms.deletedAt),
    )).limit(1);
    return !!lesson && await canReadLesson(req, lesson);
  }
  return true;
}

router.put("/:evidenceId", requireAuth,
  // The same-artifact endpoint intentionally accepts bytes rather than multipart.
  express.raw({ type: "*/*", limit: "210mb" }),
 async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const found = await findEvidence(String(req.params.evidenceId), user.organizationId);
  const uploadAction: PermissionAction = found?.app === "lessons" && found.row.uploadedById === user.id ? "own" : "full";
   if (!found || !await authorizeEvidence(req, found, uploadAction)) { res.status(404).json({ error: "Evidence upload intent not found" }); return; }
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
  if (!found || found.row.status !== "stored" || !await authorizeEvidence(req, found, "select")) { res.status(404).end(); return; }
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
  if (!found || found.row.status !== "stored" || !await authorizeEvidence(req, found, "select")) { res.status(404).json({ error: "Evidence file not found" }); return; }
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