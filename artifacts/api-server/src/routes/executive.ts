import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { GetExecutiveOverviewResponse, ListPublishedExecutiveSummariesResponse } from "@workspace/api-zod";
import { auditFindings, audits, db, executiveSummarySnapshots, lessonLearnedForms, qaqcMetricEntries } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { paginated, pagination } from "../lib/workspace";

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
  const [latestPeriod] = await db.select({ period: qaqcMetricEntries.reportingPeriod }).from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, user.organizationId), sql`${qaqcMetricEntries.deletedAt} IS NULL`)).orderBy(desc(qaqcMetricEntries.reportingPeriod)).limit(1);
  const periodDate = latestPeriod?.period ? new Date(latestPeriod.period) : new Date();
  const response = {
    periodLabel: `${periodDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} · executive view`,
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

router.get("/executive/published-summaries", requireAuth, async (req, res) => {
  const { page, limit } = pagination(req);
  const rows = await db.select().from(executiveSummarySnapshots).where(and(
    eq(executiveSummarySnapshots.organizationId, req.currentUser!.organizationId),
    sql`${executiveSummarySnapshots.deletedAt} IS NULL`,
  )).orderBy(desc(executiveSummarySnapshots.publishedAt));
  const latest = rows.filter((row, index, all) => all.findIndex((other) => other.appKey === row.appKey) === index);
  const sliced = latest.slice((page - 1) * limit, page * limit).map((row) => {
    const metricsValue = row.payload.metrics;
    const metrics = metricsValue && typeof metricsValue === "object" && !Array.isArray(metricsValue)
      ? Object.fromEntries(Object.entries(metricsValue).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
      : {};
    return {
      id: row.id, appKey: row.appKey, period: row.periodLabel, publishedAt: row.publishedAt,
      metrics, narrative: typeof row.payload.narrative === "string" ? row.payload.narrative : null,
    };
  });
  res.json(ListPublishedExecutiveSummariesResponse.parse(paginated(sliced, latest.length, page, limit)));
});

export default router;