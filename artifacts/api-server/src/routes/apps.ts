import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { GetAppOverviewParams, GetAppOverviewResponse, GetAppSettingsParams, GetAppSettingsResponse } from "@workspace/api-zod";
import {
  auditFindings,
  audits,
  db,
  documentGovernanceLogEntries,
  lessonLearnedForms,
  qaqcMetricEntries,
  qualityAssessmentBriefs,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getAuthorizedFullProjectScope, getAuthorizedProjectScope, requireAppAccess } from "../middlewares/rbac";
import { appDefinitions, userHasAppAccess } from "./platform";
import { canReadLesson } from "./lessons";

const router: IRouter = Router();

function countValue(rows: Array<{ count: number | string }>): string {
  return String(Number(rows[0]?.count ?? 0));
}

function parseAppKey(raw: string) {
  const parsed = GetAppOverviewParams.shape.appKey.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

router.get("/apps/:appKey/overview", requireAuth, async (req, res, next): Promise<void> => {
  const parsed = GetAppOverviewParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await requireAppAccess(parsed.data.appKey)(req, res, next);
}, async (req, res): Promise<void> => {
  const user = req.currentUser;
  const parsedParams = GetAppOverviewParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const app = appDefinitions.find((candidate) => candidate.key === parsedParams.data.appKey);
  if (!app) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  const scopeFor = (module: string) => getAuthorizedProjectScope(req, app.key, { module, action: "select" });
  const projectFilter = (column: any, scope: { unrestricted: boolean; projectIds: string[] }) =>
    scope.unrestricted ? undefined : inArray(column, scope.projectIds);
  const roleNames = user.workspaceRoles;
  const hasAccess = userHasAppAccess(user.platformRole, roleNames, app.key);
  const modules = hasAccess
    ? app.key === "qaqc"
      ? ["QAQC Metrics", "Material Inspection", "QTBT", "Customer Satisfaction", "Document Governance", "Quality Brief"]
      : app.key === "lessons"
        ? ["New Lesson Learned", "Lesson Learned Log", "Approver Inbox", "Escalation Summary"]
        : ["Annual Schedule", "Audit Plans", "Evidence & Findings", "Corrective Actions", "Audit Reports"]
    : [];
  let metrics: Array<{ label: string; value: string; detail: string; tone: "purple" | "turquoise" | "yellow" | "fuchsia" | "black" }> = [];
  let recentRecords: Array<{ id: string; title: string; reference: string; status: string; meta: string; updatedAt: Date | null }> = [];

  if (app.key === "qaqc") {
    const [metricScope, briefScope] = await Promise.all([scopeFor("metrics"), scopeFor("quality_briefs")]);
    const metricWhere = and(eq(qaqcMetricEntries.organizationId, user.organizationId), isNull(qaqcMetricEntries.deletedAt), projectFilter(qaqcMetricEntries.projectId, metricScope));
    const briefWhere = and(eq(qualityAssessmentBriefs.organizationId, user.organizationId), isNull(qualityAssessmentBriefs.deletedAt), projectFilter(qualityAssessmentBriefs.projectId, briefScope));
    const [metricsCount] = await db.select({ count: sql<number>`count(*)` }).from(qaqcMetricEntries).where(metricWhere);
    const [briefCount] = await db.select({ count: sql<number>`count(*)` }).from(qualityAssessmentBriefs).where(briefWhere);
    const rows = await db.select().from(qaqcMetricEntries).where(metricWhere).orderBy(desc(qaqcMetricEntries.updatedAt)).limit(4);
    const [totals] = await db.select({ issued: sql<number>`coalesce(sum(${qaqcMetricEntries.issuedCount}), 0)`, closed: sql<number>`coalesce(sum(${qaqcMetricEntries.closedCount}), 0)` }).from(qaqcMetricEntries).where(metricWhere);
    const issuedTotal = Number(totals?.issued ?? 0);
    const closedTotal = Number(totals?.closed ?? 0);
    metrics = [
      { label: "Metric entries", value: countValue([metricsCount]), detail: "Across active projects", tone: "purple" },
      { label: "Quality briefs", value: countValue([briefCount]), detail: "Monthly reporting cycle", tone: "turquoise" },
      { label: "Closure rate", value: issuedTotal === 0 ? "—" : `${((closedTotal / issuedTotal) * 100).toFixed(1)}%`, detail: `${closedTotal} closed of ${issuedTotal} issued`, tone: "yellow" },
    ];
    recentRecords = rows.map((row) => ({
      id: row.id,
      title: `${row.category} quality metrics`,
      reference: `QAQC / ${row.reportingPeriod}`,
      status: row.status,
      meta: `${row.closedCount} closed of ${row.issuedCount} issued`,
      updatedAt: row.updatedAt,
    }));
  } else if (app.key === "lessons") {
    const lessonScope = await scopeFor("lessons");
    const lessonWhere = and(
      eq(lessonLearnedForms.organizationId, user.organizationId),
      isNull(lessonLearnedForms.deletedAt),
      projectFilter(lessonLearnedForms.projectId, lessonScope),
    );
    const candidateRows = await db.select().from(lessonLearnedForms).where(lessonWhere).orderBy(desc(lessonLearnedForms.updatedAt));
    const visibleRows = (await Promise.all(candidateRows.map(async (row) => await canReadLesson(req, row) ? row : null)))
      .filter((row): row is typeof lessonLearnedForms.$inferSelect => !!row);
    const lessonCount = { count: visibleRows.length };
    const openCount = { count: visibleRows.filter((row) => row.workflowState === "submitted").length };
    const rows = visibleRows.slice(0, 4);
    metrics = [
      { label: "Lessons captured", value: countValue([lessonCount]), detail: "Searchable field insight", tone: "turquoise" },
      { label: "Awaiting approval", value: countValue([openCount]), detail: "Approver inbox", tone: "yellow" },
      { label: "Repeat issues", value: String(rows.filter((row) => row.isRepeated).length), detail: "Flagged for follow-up", tone: "fuchsia" },
    ];
    recentRecords = rows.map((row) => ({
      id: row.id,
      title: row.title,
      reference: row.referenceNumber,
      status: row.workflowState,
      meta: `${row.issueCategory} · ${row.impact} impact`,
      updatedAt: row.updatedAt,
    }));
  } else {
    const [auditScope, findingScope] = await Promise.all([scopeFor("audits"), scopeFor("findings")]);
    const auditWhere = and(eq(audits.organizationId, user.organizationId), isNull(audits.deletedAt), projectFilter(audits.projectId, auditScope));
    const [auditCount] = await db.select({ count: sql<number>`count(*)` }).from(audits).where(auditWhere);
    const [findingCount] = await db.select({ count: sql<number>`count(*)` }).from(auditFindings).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(and(
      eq(auditFindings.organizationId, user.organizationId), isNull(auditFindings.deletedAt),
      eq(audits.organizationId, user.organizationId), isNull(audits.deletedAt), projectFilter(audits.projectId, findingScope),
    ));
    const rows = await db.select().from(audits).where(auditWhere).orderBy(desc(audits.updatedAt)).limit(4);
    metrics = [
      { label: "Audit engagements", value: countValue([auditCount]), detail: "Across the annual program", tone: "purple" },
      { label: "Findings logged", value: countValue([findingCount]), detail: "Evidence-backed observations", tone: "yellow" },
      { label: "Audit readiness", value: "100%", detail: "No denominator means ready", tone: "turquoise" },
    ];
    recentRecords = rows.map((row) => ({
      id: row.id,
      title: `Audit ${row.referenceNumber}`,
      reference: row.referenceNumber,
      status: row.workflowState,
      meta: "Audit lifecycle engagement",
      updatedAt: row.updatedAt,
    }));
  }

  const response = {
    appKey: app.key,
    title: app.name,
    eyebrow: app.shortName,
    summary: app.description,
    metrics,
    recentRecords,
    modules,
    canConfigure: ["Super Admin", "Org Admin", "Quality Manager"].includes(user.platformRole),
  };
  res.json(GetAppOverviewResponse.parse(response));
});

router.get("/apps/:appKey/settings", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser;
  const parsedParams = GetAppSettingsParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const app = appDefinitions.find((candidate) => candidate.key === parsedParams.data.appKey);
  if (!app) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  const canConfigure = ["Super Admin", "Org Admin", "Quality Manager"].includes(user.platformRole);
  const sections = [
    ["workspace", "Workspace profile", "Application identity, naming, and defaults."],
    ["escalation", "Escalation matrix", "Working-day clocks, recipients, and repeat cadence."],
    ["ai", "AI settings", "Feature toggles, governance, and provider controls."],
    ["distribution", "Distribution lists", "Approval-based report delivery and cadence."],
  ].map(([key, title, description]) => ({ key, title, description, available: canConfigure }));
  res.json(GetAppSettingsResponse.parse({
    appKey: app.key,
    title: `${app.name} settings`,
    description: canConfigure
      ? "Configure this application without changing the other QMS360 workspaces."
      : "Your workspace role can view this shell. Configuration access is assigned by an Org Admin.",
    sections,
  }));
});

export default router;