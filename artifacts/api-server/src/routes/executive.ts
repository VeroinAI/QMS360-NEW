import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { GetExecutiveOverviewResponse } from "@workspace/api-zod";
import { auditFindings, audits, db, lessonLearnedForms, qaqcMetricEntries } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/executive/overview", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [metricCount] = await db.select({ count: sql<number>`count(*)` }).from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, user.organizationId), sql`${qaqcMetricEntries.deletedAt} IS NULL`));
  const [lessonCount] = await db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(and(eq(lessonLearnedForms.organizationId, user.organizationId), sql`${lessonLearnedForms.deletedAt} IS NULL`));
  const [auditCount] = await db.select({ count: sql<number>`count(*)` }).from(audits).where(and(eq(audits.organizationId, user.organizationId), sql`${audits.deletedAt} IS NULL`));
  const [findingCount] = await db.select({ count: sql<number>`count(*)` }).from(auditFindings).where(eq(auditFindings.organizationId, user.organizationId));
  const lessons = await db.select().from(lessonLearnedForms).where(and(eq(lessonLearnedForms.organizationId, user.organizationId), sql`${lessonLearnedForms.deletedAt} IS NULL`)).orderBy(desc(lessonLearnedForms.updatedAt)).limit(3);
  const auditRows = await db.select().from(auditFindings).where(eq(auditFindings.organizationId, user.organizationId)).orderBy(desc(auditFindings.createdAt)).limit(3);
  const toCount = (value: number | string | null | undefined) => Number(value ?? 0);
  const response = {
    periodLabel: "August 2026 · executive view",
    kpis: [
      { label: "Quality entries", value: String(toCount(metricCount.count)), delta: "Active foundation", context: "QA/QC & document governance", tone: "purple" },
      { label: "Lessons captured", value: String(toCount(lessonCount.count)), delta: "Knowledge base", context: "Lesson Learned Management", tone: "turquoise" },
      { label: "Audit findings", value: String(toCount(findingCount.count)), delta: "Evidence-backed", context: "QMS Audit Management", tone: "yellow" },
      { label: "Audit engagements", value: String(toCount(auditCount.count)), delta: "Annual program", context: "Across active projects", tone: "fuchsia" },
    ],
    appHighlights: lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      reference: lesson.referenceNumber,
      status: lesson.workflowState,
      meta: `${lesson.issueCategory} · ${lesson.impact} impact`,
      updatedAt: lesson.updatedAt,
    })),
    activity: auditRows.map((finding) => ({
      id: finding.id,
      title: `${finding.classification} finding`,
      reference: finding.responsibleDepartment ?? "Audit finding",
      status: finding.status,
      meta: finding.description ?? "Finding captured in the audit lifecycle",
      updatedAt: finding.createdAt,
    })),
  };
  res.json(GetExecutiveOverviewResponse.parse(response));
});

export default router;