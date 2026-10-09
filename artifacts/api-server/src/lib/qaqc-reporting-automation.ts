import { withOrganizationDateFormat } from "./date-format";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { EmailPdfAttachment } from "./email-attachments";
import {
  db, organizationSettings, outboundEmails, projects, qaqcReportDeliveryRuns, qaqcReportSubmissions,
  reportTemplates, targetBenchmarks, users,
} from "@workspace/db";
import { enqueueEmail } from "./email-queue";
import { removeEmailPdfAttachment, storeEmailPdfAttachment } from "./email-attachments";
import {
  exportQaqcDashboardPdf, exportQaqcReportPdf, type QaqcDashboardExport, type QaqcReportExport,
} from "./qaqc-reporting-export";
import { logger } from "./logger";
import { notify, writeAuditLog } from "./workspace";
import { safeTemplateMetadata } from "./qaqc-pdf-templates";

type ReportType = "monthly" | "daily" | "csat";
type Settings = Record<string, unknown>;
type AutomationResult = { organizations: number; evaluated: number; queued: number; skipped: number; errors: number };

function asObject(value: unknown): Settings {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {};
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<string, number>;
}

function localDate(date: Date, timezone: string) {
  const value = localParts(date, timezone);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function calendarDaysBetween(from: Date, to: Date, timezone: string) {
  const start = new Date(`${localDate(from, timezone)}T00:00:00.000Z`);
  const end = new Date(`${localDate(to, timezone)}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function shiftDate(isoDate: string, delta: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function monthStart(isoDate: string) { return `${isoDate.slice(0, 7)}-01`; }
function shiftMonth(isoMonth: string, delta: number) {
  const date = new Date(`${isoMonth.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7) + "-01";
}

function activeRecipient(settings: Settings, key: string) {
  const value = settings[key];
  return typeof value === "string" && value ? value : null;
}

export function reportingAlertDue(
  kind: "missing_daily" | "missing_monthly", period: string, currentDate: string, currentHour: number, currentMinute: number,
) {
  const parsedPeriod = new Date(`${period}T00:00:00.000Z`);
  const parsedToday = new Date(`${currentDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedPeriod.getTime()) || Number.isNaN(parsedToday.getTime())
    || parsedPeriod.toISOString().slice(0, 10) !== period
    || parsedToday.toISOString().slice(0, 10) !== currentDate) return null;
  if (kind === "missing_daily") {
    const deadline = shiftDate(period, 1);
    if (currentDate < deadline || (currentDate === deadline && (currentHour < 11 || (currentHour === 11 && currentMinute < 1)))) return null;
    return { period, director: currentDate > deadline };
  }
  const nextMonthFirst = shiftMonth(`${period.slice(0, 7)}-01`, 1);
  const deadline = shiftDate(nextMonthFirst, 7);
  if (currentDate < deadline || (currentDate === deadline && currentHour < 11)) return null;
  const escalateAt = shiftDate(deadline, 2);
  const director = currentDate > escalateAt
    || (currentDate === escalateAt && (currentHour > 11 || (currentHour === 11 && currentMinute >= 1)));
  return { period, director };
}

export function reportingPeriodsSince(start: string | null, today: string, kind: "missing_daily" | "missing_monthly") {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!start || !valid(start) || !valid(today)) return [];
  let cursor = kind === "missing_monthly" ? monthStart(start) : start;
  const end = kind === "missing_monthly" ? shiftMonth(monthStart(today), -1) : shiftDate(today, -1);
  if (cursor > end) return [];
  const result: string[] = [];
  while (cursor <= end) {
    result.push(cursor);
    cursor = kind === "missing_monthly" ? shiftMonth(cursor, 1) : shiftDate(cursor, 1);
  }
  return result;
}

export function lowMetricEscalationLevel(consecutiveBelowTarget: number) {
  if (consecutiveBelowTarget >= 4) return 3;
  if (consecutiveBelowTarget >= 3) return 2;
  if (consecutiveBelowTarget >= 2) return 1;
  return 0;
}

export function approvalDelayPriority(calendarDays: number): "P2" | "P1" | null {
  if (calendarDays >= 5) return "P1";
  if (calendarDays >= 2) return "P2";
  return null;
}

export function reportingDistributionDue(kind: "monthly" | "daily", date: string, scheduleDays: unknown) {
  const day = Number(date.slice(8, 10));
  if (kind === "monthly") return Number.isInteger(day) && Number(scheduleDays) === day;
  const days = Array.isArray(scheduleDays) ? scheduleDays.map(Number) : [];
  return Number.isInteger(day) && days.includes(day);
}

function reportDashboard(report: QaqcReportExport, projectName: string): QaqcDashboardExport {
  const computed = asObject(report.computed);
  const row = {
    projectId: report.projectId, projectName, projectCode: report.projectCode, reportType: report.reportType,
    period: report.period, state: report.state, referenceNumber: report.referenceNumber ?? "",
    computed, data: report.data, ...computed,
  };
  let summary: Record<string, unknown>;
  if (report.reportType === "daily") {
    summary = { daily: [{
      projectId: report.projectId, projectName, period: report.period, snapshot: computed,
      movement: null, absoluteSnapshot: true, globalPeriod: report.period, baselinePeriod: null,
    }] };
  } else if (report.reportType === "csat") {
    summary = { csat: [row], csatAverage: Number(computed.averageRating ?? 0) };
  } else {
    const metrics = asObject(computed.metrics);
    summary = {
      monthly: [row],
      aggregates: [{
        period: report.period, projects: 1, averagePqi: Number(asObject(computed.pqi).accumulated ?? 0),
        metrics: Object.fromEntries(Object.entries(metrics).map(([key, metric]) =>
          [key, Number(asObject(metric).accumulatedRate ?? 0)])),
      }],
    };
  }
  const filters = { projectId: report.projectId, projectGroup: null, from: null, to: null,
    period: report.period, reportType: report.reportType, category: "all" };
  const dashboardData = {
    filters,
    monthly: [], aggregates: [], csat: [], csatAverage: 0, daily: [],
    ...summary,
  };
  const rows = report.reportType === "daily" ? dashboardData.daily : [row];
  return {
    organizationId: report.organizationId,
    reportType: report.reportType,
    title: "QA/QC Reporting Dashboard",
    filters,
    summary: dashboardData, dashboardData, rows: rows as Array<Record<string, unknown>>, trends: report.reportType === "daily" ? summary.daily as Array<Record<string, unknown>>
      : report.reportType === "monthly" ? summary.aggregates as Array<Record<string, unknown>> : [row],
    reports: [report],
  };
}

async function claimRun(organizationId: string, projectId: string | null, runKey: string, kind: string, payload: Settings, now: Date) {
  const [inserted] = await db.insert(qaqcReportDeliveryRuns).values({
    organizationId, projectId, runKey, kind, payload, status: "processing", createdAt: now, updatedAt: now,
  }).onConflictDoNothing().returning({ id: qaqcReportDeliveryRuns.id });
  if (inserted) return true;
  const staleAt = new Date(now.getTime() - 10 * 60_000);
  const rows = await db.update(qaqcReportDeliveryRuns).set({ status: "processing", payload, updatedAt: now })
    .where(and(
      eq(qaqcReportDeliveryRuns.organizationId, organizationId),
      eq(qaqcReportDeliveryRuns.runKey, runKey),
      isNull(qaqcReportDeliveryRuns.deletedAt),
      or(
        eq(qaqcReportDeliveryRuns.status, "failed"),
        and(eq(qaqcReportDeliveryRuns.status, "processing"), lt(qaqcReportDeliveryRuns.updatedAt, staleAt)),
        and(eq(qaqcReportDeliveryRuns.status, "queued"), sql`EXISTS (
          SELECT 1 FROM shared.outbound_emails email
          WHERE email.organization_id = ${organizationId}
            AND email.context->>'runKey' = ${runKey}
            AND email.delivery_status = 'failed'
            AND email.deleted_at IS NULL
        )`),
      ),
    )).returning({ id: qaqcReportDeliveryRuns.id });
  return rows.length > 0;
}

async function finishRun(organizationId: string, runKey: string, status: "queued" | "failed", now: Date, error?: string) {
  await db.update(qaqcReportDeliveryRuns).set({
    status, updatedAt: now, payload: error ? { error: error.slice(0, 500) } : {},
  }).where(and(eq(qaqcReportDeliveryRuns.organizationId, organizationId), eq(qaqcReportDeliveryRuns.runKey, runKey)));
}

async function emailAlreadyQueued(organizationId: string, runKey: string) {
  const [email] = await db.select({ id: outboundEmails.id }).from(outboundEmails).where(and(
    eq(outboundEmails.organizationId, organizationId),
    isNull(outboundEmails.deletedAt),
    inArray(outboundEmails.deliveryStatus, ["queued", "retrying", "sending", "sent"]),
    sql`${outboundEmails.context}->>'runKey' = ${runKey}`,
  )).limit(1);
  return Boolean(email);
}

async function activeUser(organizationId: string, userId: string | null) {
  if (!userId) return null;
  const [user] = await db.select({ id: users.id, email: users.email, name: users.fullName }).from(users).where(and(
    eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt),
  )).limit(1);
  return user ?? null;
}

async function dispatchAlert(input: {
  organizationId: string; projectId: string; projectName: string; period: string; recipientId: string | null;
  kind: string; runKey: string; title: string; body: string; now: Date; reportId?: string;
}) {
  if (!input.recipientId) return "unconfigured";
  const user = await activeUser(input.organizationId, input.recipientId);
  if (!user) return "unconfigured";
  if (!await claimRun(input.organizationId, input.projectId, input.runKey, input.kind, { recipientId: user.id, period: input.period }, input.now)) return "duplicate";
  try {
    if (await emailAlreadyQueued(input.organizationId, input.runKey)) {
      await finishRun(input.organizationId, input.runKey, "queued", input.now);
      return "queued";
    }
    await notify(db, "qaqc", {
      organizationId: input.organizationId, userId: user.id, type: input.kind, title: input.title,
      body: input.body, entityType: "qaqc_report_submission", entityId: input.reportId ?? input.projectId,
    });
    const delivery = await enqueueEmail(db, {
      organizationId: input.organizationId, recipientIds: [user.id], subject: input.title, text: input.body,
      context: { app: "qaqc", eventType: `qaqc.${input.kind}`, entityId: input.reportId ?? input.projectId, runKey: input.runKey },
    });
    if (delivery.queued === 0) throw new Error("No outbound email was queued for the active reporting recipient");
    await writeAuditLog(db, "qaqc", {
      organizationId: input.organizationId, actorId: null, action: "automation_alert_queued",
      entityType: "qaqc_reporting_automation", entityId: input.reportId ?? input.projectId,
      after: { kind: input.kind, period: input.period, runKey: input.runKey, emailQueued: delivery.queued > 0 },
    }, { dispatch: false });
    await finishRun(input.organizationId, input.runKey, "queued", input.now);
    return "queued";
  } catch (error) {
    await finishRun(input.organizationId, input.runKey, "failed", input.now, error instanceof Error ? error.message : "Delivery failed");
    logger.error({ organizationId: input.organizationId, projectId: input.projectId, kind: input.kind }, "QA/QC reporting alert could not be queued");
    return "failed";
  }
}

export type ApprovedDistributionDependencies = {
  claim(): Promise<boolean>;
  hasQueuedEmail(): Promise<boolean>;
  renderReport(): Promise<Buffer>;
  renderDashboard(): Promise<Buffer>;
  storeAttachment(layout: "report" | "dashboard", bytes: Buffer): Promise<EmailPdfAttachment>;
  enqueue(attachments: EmailPdfAttachment[]): Promise<{ queued: number }>;
  audit(recipientCount: number): Promise<void>;
  finish(status: "queued" | "failed", error?: string): Promise<void>;
  removeAttachment(objectPath: string): Promise<void>;
};

export async function queueApprovedReportBundle(dependencies: ApprovedDistributionDependencies): Promise<"queued" | "failed" | "duplicate"> {
  if (!await dependencies.claim()) return "duplicate";
  if (await dependencies.hasQueuedEmail()) {
    await dependencies.finish("queued");
    return "queued";
  }
  const attachments: EmailPdfAttachment[] = [];
  try {
    attachments.push(await dependencies.storeAttachment("report", await dependencies.renderReport()));
    attachments.push(await dependencies.storeAttachment("dashboard", await dependencies.renderDashboard()));
    const result = await dependencies.enqueue(attachments);
    if (result.queued === 0) throw new Error("No outbound email was queued for the active distribution members");
    await dependencies.audit(result.queued);
    await dependencies.finish("queued");
    return "queued";
  } catch (error) {
    if (await dependencies.hasQueuedEmail()) {
      await dependencies.finish("queued");
      return "queued";
    }
    await dependencies.finish("failed", error instanceof Error ? error.message : "Distribution failed");
    for (const attachment of attachments) {
      try { await dependencies.removeAttachment(attachment.objectPath); } catch { /* cleanup errors are reported by production adapter */ }
    }
    return "failed";
  }
}

async function dispatchApprovedPdf(input: {
  organizationId: string; projectId: string; projectName: string; report: QaqcReportExport;
  recipients: string[]; kind: string; runKey: string; now: Date;
}) {
  const recipients = [...new Set(input.recipients)].filter(Boolean);
  const activeUsers = recipients.length ? await db.select({ id: users.id, email: users.email })
    .from(users).where(and(eq(users.organizationId, input.organizationId), inArray(users.id, recipients),
      eq(users.accessStatus, "active"), isNull(users.deletedAt))) : [];
  if (!activeUsers.length) return "unconfigured";
  const templates = await db.select({ name: reportTemplates.name, template: reportTemplates.template })
    .from(reportTemplates).where(and(
      eq(reportTemplates.organizationId, input.organizationId), isNull(reportTemplates.deletedAt),
    )).orderBy(reportTemplates.name);
  const report = {
    ...input.report,
    reportTemplates: templates.map((template) => ({ name: template.name, template: safeTemplateMetadata(asObject(template.template)) })),
  };
  const statuses = await Promise.all(activeUsers.map(async (user) => {
    const runKey = `${input.runKey}:${user.id}`;
    return queueApprovedReportBundle({
      claim: () => claimRun(input.organizationId, input.projectId, runKey, input.kind,
        { reportId: input.report.id, recipientId: user.id }, input.now),
      hasQueuedEmail: () => emailAlreadyQueued(input.organizationId, runKey),
      renderReport: () => withOrganizationDateFormat(input.organizationId, () => exportQaqcReportPdf(report)),
      renderDashboard: () => withOrganizationDateFormat(input.organizationId, () => exportQaqcDashboardPdf(reportDashboard(report, input.projectName))),
      storeAttachment: async (layout, bytes) => {
        const attachment = await storeEmailPdfAttachment(input.organizationId, `${input.report.id}-${layout}`, bytes);
        return { ...attachment, filename: `qaqc-${layout}-${input.report.reportType}-${input.report.period}.pdf` };
      },
      enqueue: (attachments) => enqueueEmail(db, {
        organizationId: input.organizationId,
        recipientIds: [user.id],
        subject: `Approved QA/QC ${input.report.reportType} report - ${input.projectName} - ${input.report.period}`,
        text: `The approved QA/QC ${input.report.reportType} report and dashboard for ${input.projectName} (${input.report.period}) are attached.`,
        attachments,
        context: { app: "qaqc", eventType: `qaqc.${input.kind}`, entityId: input.report.id, runKey },
      }),
      audit: (recipientCount) => writeAuditLog(db, "qaqc", {
        organizationId: input.organizationId, actorId: null, action: "approved_report_distribution_queued",
        entityType: "qaqc_report_submission", entityId: input.report.id,
        after: { kind: input.kind, period: input.report.period, recipientId: user.id, recipientCount, runKey },
      }, { dispatch: false }),
      finish: (runStatus, error) => finishRun(input.organizationId, runKey, runStatus, input.now, error),
      removeAttachment: async (objectPath) => {
        try { await removeEmailPdfAttachment(input.organizationId, objectPath); } catch {
          logger.warn({ organizationId: input.organizationId, reportId: input.report.id }, "Unreferenced QA/QC report PDF cleanup failed");
        }
      },
    });
  }));
  if (statuses.includes("failed")) {
    logger.error({ organizationId: input.organizationId, projectId: input.projectId, kind: input.kind }, "QA/QC approved report distribution could not be queued for every recipient");
    return "failed";
  }
  return statuses.includes("queued") ? "queued" : "duplicate";
}

function reportEnvelope(row: any, project: any): QaqcReportExport {
  return {
    ...row, projectName: project.name, projectCode: project.code,
    data: asObject(row.data), computed: asObject(row.computed), baseline: asObject(row.baseline),
  } as QaqcReportExport;
}

function roleRecipient(settings: Settings, field: string) { return activeRecipient(settings, field); }

export async function runQaqcReportingAutomation(now = new Date()): Promise<AutomationResult> {
  const result: AutomationResult = { organizations: 0, evaluated: 0, queued: 0, skipped: 0, errors: 0 };
  const orgSettings = await db.select({
    organizationId: organizationSettings.organizationId, timezone: organizationSettings.timezone,
  }).from(organizationSettings).where(isNull(organizationSettings.deletedAt));
  result.organizations = orgSettings.length;
  for (const org of orgSettings) {
    let timezone = org.timezone || "Asia/Riyadh";
    try { localParts(now, timezone); } catch {
      logger.warn({ organizationId: org.organizationId, timezone }, "QA/QC reporting automation skipped organization with invalid timezone");
      result.errors++;
      continue;
    }
    const today = localDate(now, timezone);
    const projectsForOrg = await db.select({
      id: projects.id, name: projects.name, code: projects.code, customFields: projects.customFields,
    }).from(projects).where(and(
      eq(projects.organizationId, org.organizationId), eq(projects.status, "active"), isNull(projects.deletedAt),
    ));
    const centralTargetsRows = await db.select({
      metricKey: targetBenchmarks.metricKey, targetValue: targetBenchmarks.targetValue,
    }).from(targetBenchmarks).where(and(
      eq(targetBenchmarks.organizationId, org.organizationId), isNull(targetBenchmarks.deletedAt),
    ));
    const centralTargets = Object.fromEntries(centralTargetsRows.map((row) => [row.metricKey, Number(row.targetValue)]));
    for (const project of projectsForOrg) {
      const projectFields = asObject(project.customFields);
      const qaqcSettings = asObject(projectFields.qaqcReporting);
      const projectTargets = projectFields.targets && typeof projectFields.targets === "object" && !Array.isArray(projectFields.targets)
        ? asObject(projectFields.targets) : asObject(qaqcSettings.targets);
      const targets = { ...centralTargets, ...projectTargets };
      const reports = await db.select().from(qaqcReportSubmissions).where(and(
        eq(qaqcReportSubmissions.organizationId, org.organizationId),
        eq(qaqcReportSubmissions.projectId, project.id),
        isNull(qaqcReportSubmissions.deletedAt),
      )).orderBy(desc(qaqcReportSubmissions.period));
      const activeStates = reports.filter((report) => report.state === "submitted" || report.state === "approved");
      const allActive = reports.filter((report) => report.state !== "deleted");

      for (const report of allActive.filter((item) => item.state === "submitted" && item.submittedAt)) {
        const age = calendarDaysBetween(new Date(report.submittedAt!), now, timezone);
        const priority = approvalDelayPriority(age);
        if (!priority) continue;
        const recipientId = priority === "P1" ? roleRecipient(qaqcSettings, "directorId") : report.approverId;
        result.evaluated++;
        const status = await dispatchAlert({
          organizationId: org.organizationId, projectId: project.id, projectName: project.name, period: report.period,
          recipientId, kind: `approval_delay_${priority.toLowerCase()}`,
          runKey: `approval:${report.id}:${today}:${recipientId ?? "unconfigured"}`,
          title: `${priority}: QA/QC report approval overdue`,
          body: `${priority}: ${report.reportType} report for ${project.name} (${report.period}) has been awaiting approval for ${age} calendar days.`,
          reportId: report.id, now,
        });
        if (status === "queued") result.queued++; else if (status === "failed") result.errors++; else result.skipped++;
      }

      const time = localParts(now, timezone);
      for (const kind of ["missing_daily", "missing_monthly"] as const) {
        const type: ReportType = kind === "missing_daily" ? "daily" : "monthly";
        const configuredStart = typeof qaqcSettings.reportingStartDate === "string" ? qaqcSettings.reportingStartDate : null;
        const firstExisting = reports.filter((report) => report.reportType === type)
          .map((report) => report.period).sort()[0] ?? null;
        const start = configuredStart ?? firstExisting;
        const normalizedStart = kind === "missing_monthly" && start
          ? /^\d{4}-\d{2}$/.test(start) ? `${start}-01` : `${start.slice(0, 7)}-01`
          : start;
        const periods = reportingPeriodsSince(normalizedStart, today, kind);
        for (const period of periods) {
          if (activeStates.some((report) => report.reportType === type && report.period === period)) continue;
          const due = reportingAlertDue(kind, period, today, time.hour, time.minute);
          if (!due) continue;
          const recipientId = due.director
            ? roleRecipient(qaqcSettings, "directorId")
            : roleRecipient(qaqcSettings, kind === "missing_daily" ? "dataGovernanceManagerId" : "corporateQualityManagerId");
          result.evaluated++;
          const priority = due.director ? "P1" : "P2";
          const status = await dispatchAlert({
            organizationId: org.organizationId, projectId: project.id, projectName: project.name,
            period, recipientId, kind, runKey: `missing:${type}:${project.id}:${period}:${today}:${recipientId ?? "unconfigured"}`,
            title: `${priority}: Missing QA/QC ${type} report`,
            body: `The ${type} report for ${project.name} (${period}) has not been submitted.`,
            now,
          });
          if (status === "queued") result.queued++; else if (status === "failed") result.errors++; else result.skipped++;
        }
      }

      const monthlyByPeriod = new Map(activeStates.filter((report) => report.reportType === "monthly").map((report) => [report.period, report]));
      const latestMonth = [...monthlyByPeriod.keys()].sort().at(-1);
      if (latestMonth) {
        const categories = ["external_ncr", "internal_ncr", "rfi", "rmi"];
        for (const category of categories) {
          const targetValue = Number(targets[category] ?? 100);
          let consecutive = 0;
          let period = latestMonth;
          let triggeringReport: (typeof activeStates)[number] | undefined;
          for (let count = 0; count < 4; count++) {
            const report = monthlyByPeriod.get(period);
            if (!report) break;
            const metrics = asObject(asObject(report.computed).metrics);
            const metric = asObject(metrics[category]);
            const rate = Number(metric.accumulatedRate);
            if (!Number.isFinite(rate) || rate >= targetValue) break;
            consecutive++;
            triggeringReport = triggeringReport ?? report;
            period = shiftMonth(period, -1);
          }
          const level = lowMetricEscalationLevel(consecutive);
          if (!level || !triggeringReport) continue;
          for (let levelIndex = 1; levelIndex <= level; levelIndex++) {
            const recipientId = roleRecipient(qaqcSettings, ["qualityRepresentativeId", "projectHeadId", "buHeadId"][levelIndex - 1]!);
            result.evaluated++;
            const status = await dispatchAlert({
              organizationId: org.organizationId, projectId: project.id, projectName: project.name,
              period: latestMonth, recipientId, kind: `metric_below_target_l${levelIndex}`,
              runKey: `metric:${category}:${levelIndex}:${project.id}:${latestMonth}:${recipientId ?? "unconfigured"}`,
              title: `L${levelIndex}: ${category} closure metric below target`,
              body: `${category} accumulated closure has remained below its ${targetValue}% target for ${consecutive} consecutive submitted months (${project.name}).`,
              reportId: triggeringReport.id, now,
            });
            if (status === "queued") result.queued++; else if (status === "failed") result.errors++; else result.skipped++;
          }
        }
      }

      const distributions = Array.isArray(qaqcSettings.distributionMemberIds)
        ? qaqcSettings.distributionMemberIds.filter((id): id is string => typeof id === "string") : [];
      const local = localParts(now, timezone);
      const monthlyDay = Number(qaqcSettings.monthlyDistributionDay);
      if (reportingDistributionDue("monthly", today, monthlyDay)) {
        const targetPeriod = shiftMonth(`${local.year}-${String(local.month).padStart(2, "0")}-01`, -1);
        const approved = activeStates.find((report) => report.reportType === "monthly" && report.period === targetPeriod && report.state === "approved");
        if (approved) {
          result.evaluated++;
          const status = await dispatchApprovedPdf({
            organizationId: org.organizationId, projectId: project.id, projectName: project.name,
            report: reportEnvelope(approved, project), recipients: distributions, kind: "monthly_report_distribution",
            runKey: `distribution:monthly:${project.id}:${targetPeriod}:${localDate(now, timezone)}`, now,
          });
          if (status === "queued") result.queued++; else if (status === "failed") result.errors++; else result.skipped++;
        }
      }
      if (reportingDistributionDue("daily", today, qaqcSettings.dailyDistributionDays)) {
        const targetPeriod = shiftDate(today, -1);
        const approved = activeStates.find((report) => report.reportType === "daily" && report.period === targetPeriod && report.state === "approved");
        if (approved) {
          result.evaluated++;
          const status = await dispatchApprovedPdf({
            organizationId: org.organizationId, projectId: project.id, projectName: project.name,
            report: reportEnvelope(approved, project), recipients: distributions, kind: "daily_snapshot_distribution",
            runKey: `distribution:daily:${project.id}:${targetPeriod}:${localDate(now, timezone)}`, now,
          });
          if (status === "queued") result.queued++; else if (status === "failed") result.errors++; else result.skipped++;
        }
      }
    }
  }
  return result;
}
