import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
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
import { appDefinitions, userHasAppAccess } from "./platform";

const router: IRouter = Router();

function countValue(rows: Array<{ count: number | string }>): string {
  return String(Number(rows[0]?.count ?? 0));
}

function parseAppKey(raw: string) {
  const parsed = GetAppOverviewParams.shape.appKey.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

router.get("/apps/:appKey/overview", requireAuth, async (req, res): Promise<void> => {
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
    const [metricsCount] = await db.select({ count: sql<number>`count(*)` }).from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, user.organizationId), sql`${qaqcMetricEntries.deletedAt} IS NULL`));
    const [briefCount] = await db.select({ count: sql<number>`count(*)` }).from(qualityAssessmentBriefs).where(and(eq(qualityAssessmentBriefs.organizationId, user.organizationId), sql`${qualityAssessmentBriefs.deletedAt} IS NULL`));
    const rows = await db.select().from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.organizationId, user.organizationId), sql`${qaqcMetricEntries.deletedAt} IS NULL`)).orderBy(desc(qaqcMetricEntries.updatedAt)).limit(4);
    metrics = [
      { label: "Metric entries", value: countValue([metricsCount]), detail: "Across active projects", tone: "purple" },
      { label: "Quality briefs", value: countValue([briefCount]), detail: "Monthly reporting cycle", tone: "turquoise" },
      { label: "Closure rate", value: "100%", detail: "0 / 0 baseline is healthy", tone: "yellow" },
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
    const [lessonCount] = await db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(and(eq(lessonLearnedForms.organizationId, user.organizationId), sql`${lessonLearnedForms.deletedAt} IS NULL`));
    const [openCount] = await db.select({ count: sql<number>`count(*)` }).from(lessonLearnedForms).where(and(eq(lessonLearnedForms.organizationId, user.organizationId), eq(lessonLearnedForms.workflowState, "submitted"), sql`${lessonLearnedForms.deletedAt} IS NULL`));
    const rows = await db.select().from(lessonLearnedForms).where(and(eq(lessonLearnedForms.organizationId, user.organizationId), sql`${lessonLearnedForms.deletedAt} IS NULL`)).orderBy(desc(lessonLearnedForms.updatedAt)).limit(4);
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
    const [auditCount] = await db.select({ count: sql<number>`count(*)` }).from(audits).where(and(eq(audits.organizationId, user.organizationId), sql`${audits.deletedAt} IS NULL`));
    const [findingCount] = await db.select({ count: sql<number>`count(*)` }).from(auditFindings).where(eq(auditFindings.organizationId, user.organizationId));
    const rows = await db.select().from(audits).where(and(eq(audits.organizationId, user.organizationId), sql`${audits.deletedAt} IS NULL`)).orderBy(desc(audits.updatedAt)).limit(4);
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