import type { Express } from "express";
import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  applicationAccess, auditFindings,
  auditEscalationInstances, auditEscalationRules, auditNotifications,
  auditUserWorkspaceRoles, auditWorkspaceRoles,
  correctiveActionReports, db, escalationInstances, escalationRules,
  lessonEscalationInstances, lessonEscalationRules, lessonLearnedForms,
  lessonNotifications, lessonsUserWorkspaceRoles, lessonsWorkspaceRoles,
  notifications, organizationSettings, qaqcMetricEntries, qualityAssessmentBriefs,
  targetBenchmarks, userWorkspaceRoles, users, workspaceRoles,
} from "@workspace/db";

type TriggerType = "approval_delay" | "missing_submission" | "lesson_sla" | "performance" | "finding_priority";
type Calendar = { workingDays: Array<number | string>; holidays: string[] };
type Candidate = {
  id: string; organizationId: string; anchorAt: Date; recordType: string;
  triggerType: TriggerType; dueAt?: Date | null; slaOverride?: number;
};

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const defaultCalendar: Calendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };

function dateKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function normalizedCalendar(value?: Calendar | null): Calendar {
  if (!value) return defaultCalendar;
  const workingDays = value.workingDays.map((day) =>
    typeof day === "number" ? day : dayNames.indexOf(day)).filter((day) => day >= 0 && day <= 6);
  return { workingDays: workingDays.length ? workingDays : defaultCalendar.workingDays, holidays: value.holidays ?? [] };
}

export function isBusinessDay(value: Date, calendar: Calendar = defaultCalendar) {
  const configured = normalizedCalendar(calendar);
  return configured.workingDays.includes(value.getUTCDay()) && !configured.holidays.includes(dateKey(value));
}

export function addBusinessDays(value: Date, days: number, calendar: Calendar = defaultCalendar) {
  const result = new Date(value);
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isBusinessDay(result, calendar)) remaining--;
  }
  return result;
}

function businessDaysElapsed(from: Date, to: Date, calendar: Calendar) {
  if (to < from) return 0;
  let elapsed = 0;
  const cursor = new Date(from);
  while (dateKey(cursor) < dateKey(to)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBusinessDay(cursor, calendar)) elapsed++;
  }
  return elapsed;
}

type AppTables = {
  key: "qaqc" | "lessons" | "audit";
  label: string;
  rules: any; instances: any; notifications: any; roles: any; assignments: any;
};

const appTables: AppTables[] = [
  { key: "qaqc", label: "QA/QC", rules: escalationRules, instances: escalationInstances, notifications, roles: workspaceRoles, assignments: userWorkspaceRoles },
  { key: "lessons", label: "Lessons", rules: lessonEscalationRules, instances: lessonEscalationInstances, notifications: lessonNotifications, roles: lessonsWorkspaceRoles, assignments: lessonsUserWorkspaceRoles },
  { key: "audit", label: "Audit", rules: auditEscalationRules, instances: auditEscalationInstances, notifications: auditNotifications, roles: auditWorkspaceRoles, assignments: auditUserWorkspaceRoles },
];

function configuration(rule: any): Record<string, any> {
  return rule.configuration && typeof rule.configuration === "object" ? rule.configuration : {};
}

function progression(rule: any, trigger: TriggerType, app: AppTables["key"]) {
  const config = configuration(rule);
  if (Array.isArray(config.levels) && config.levels.every((x: unknown) => typeof x === "string")) return config.levels as string[];
  if (trigger === "lesson_sla") return ["P1", "L1", "L2"];
  if (trigger === "performance") return ["L1", "L2", "L3"];
  if (trigger === "approval_delay" && app === "qaqc") return ["P2", "P1"];
  if (trigger === "approval_delay" && app === "audit") return ["P2", "P1"];
  if (trigger === "finding_priority") return [rule.priority ?? "P1", "L1", "L2"];
  return [config.level ?? rule.priority ?? "L1"];
}

function intervalFor(rule: any, trigger: TriggerType, nextIndex: number) {
  const config = configuration(rule);
  const intervals = Array.isArray(config.levelIntervalsWorkingDays) ? config.levelIntervalsWorkingDays : [];
  const configured = Number(intervals[nextIndex - 1]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (trigger === "lesson_sla" && nextIndex <= 2) return 3;
  if (trigger === "approval_delay" && nextIndex === 1) return 3;
  return Math.max(1, rule.repeatCadenceDays ?? 2);
}

async function resolveRecipients(database: typeof db, app: AppTables, rule: any, level: string) {
  const config = configuration(rule);
  const levelTarget = config.recipientsByLevel?.[level];
  const directIds = [
    ...(Array.isArray(config.recipientUserIds) ? config.recipientUserIds : []),
    ...(typeof config.recipientUserId === "string" ? [config.recipientUserId] : []),
    ...(levelTarget && typeof levelTarget === "object" && Array.isArray(levelTarget.userIds) ? levelTarget.userIds : []),
  ].filter((id): id is string => typeof id === "string");
  if (directIds.length) {
    const rows = await database.select({ id: users.id }).from(users).where(and(
      eq(users.organizationId, rule.organizationId), inArray(users.id, directIds),
      eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
    if (rows.length) return rows.map((row) => row.id);
  }

  const levelRoles = typeof levelTarget === "string" ? [levelTarget]
    : Array.isArray(levelTarget) ? levelTarget
      : levelTarget && Array.isArray(levelTarget.roles) ? levelTarget.roles : [];
  const configuredRoles = levelRoles.length ? levelRoles
    : (config.recipientRoles ?? String(rule.recipientRole ?? "").split(",")).filter(Boolean);
  if (configuredRoles.length) {
    const roleRows = await database.select({ id: app.roles.id }).from(app.roles).where(and(
      eq(app.roles.organizationId, rule.organizationId), inArray(app.roles.name, configuredRoles),
      eq(app.roles.status, "active"), isNull(app.roles.deletedAt),
    ));
    if (roleRows.length) {
      const assignments = await database.select({ userId: app.assignments.userId }).from(app.assignments).where(and(
        eq(app.assignments.organizationId, rule.organizationId),
        inArray(app.assignments.workspaceRoleId, roleRows.map((row: any) => row.id)),
        eq(app.assignments.status, "active"), isNull(app.assignments.deletedAt),
      ));
      if (assignments.length) return [...new Set(assignments.map((row: any) => row.userId as string))];
    }
  }

  const adminColumn = app.key === "qaqc" ? applicationAccess.isInitialAdminQaqc
    : app.key === "lessons" ? applicationAccess.isInitialAdminLessons : applicationAccess.isInitialAdminAudit;
  const admins = await database.select({ id: users.id }).from(applicationAccess)
    .innerJoin(users, and(
      eq(users.organizationId, applicationAccess.organizationId),
      eq(users.username, applicationAccess.username),
      eq(users.accessStatus, "active"), isNull(users.deletedAt),
    )).where(and(
      eq(applicationAccess.organizationId, rule.organizationId), eq(adminColumn, true),
      eq(applicationAccess.status, "active"), isNull(applicationAccess.deletedAt),
    ));
  return [...new Set(admins.map((row) => row.id))];
}

function isBreached(candidate: Candidate, rule: any, calendar: Calendar, now: Date) {
  if (candidate.dueAt) return dateKey(now) > dateKey(candidate.dueAt);
  return businessDaysElapsed(candidate.anchorAt, now, calendar) >= (candidate.slaOverride ?? rule.slaWorkingDays);
}

async function reconcileApp(
  database: typeof db,
  app: AppTables,
  candidates: Candidate[],
  calendars: Map<string, Calendar>,
) {
  const rules = await database.select().from(app.rules).where(and(
    eq(app.rules.status, "active"), isNull(app.rules.deletedAt),
  ));
  let created = 0;
  const now = new Date();
  for (const rule of rules) {
    const trigger = rule.triggerKey as TriggerType;
    if (!["approval_delay", "missing_submission", "lesson_sla", "performance", "finding_priority"].includes(trigger)) continue;
    for (const candidate of candidates) {
      if (candidate.organizationId !== rule.organizationId || candidate.triggerType !== trigger) continue;
      const calendar = calendars.get(candidate.organizationId) ?? defaultCalendar;
      if (!isBreached(candidate, rule, calendar, now)) continue;
      const levels = progression(rule, trigger, app.key);
      const [existing] = await database.select().from(app.instances).where(and(
        eq(app.instances.recordId, candidate.id), eq(app.instances.ruleId, rule.id),
        eq(app.instances.status, "open"), isNull(app.instances.deletedAt),
      )).limit(1);
      if (existing) {
        if (!existing.nextEscalateAt || existing.nextEscalateAt > now) continue;
        const currentIndex = Math.max(0, levels.indexOf(existing.currentLevel ?? levels[0]!));
        const nextIndex = Math.min(currentIndex + 1, levels.length - 1);
        const level = levels[nextIndex]!;
        const recipientIds = await resolveRecipients(database, app, rule, level);
        for (const recipientId of recipientIds) {
          await database.insert(app.notifications).values({
            organizationId: candidate.organizationId, recipientId,
            title: `${app.label} ${level} escalation`,
            body: `${candidate.recordType} remains unresolved at escalation level ${level}.`,
            channel: "in_app",
          });
        }
        await database.update(app.instances).set({
          currentLevel: level,
          nextEscalateAt: addBusinessDays(now, intervalFor(rule, trigger, nextIndex + 1), calendar),
          stateNote: nextIndex === currentIndex ? `Repeated ${level} reminder` : `Advanced to ${level}`,
          updatedAt: now,
        }).where(eq(app.instances.id, existing.id));
        continue;
      }
      const level = levels[0]!;
      const breachAt = candidate.dueAt
        ? candidate.dueAt : addBusinessDays(candidate.anchorAt, candidate.slaOverride ?? rule.slaWorkingDays, calendar);
      const [inserted] = await database.insert(app.instances).values({
        organizationId: candidate.organizationId, recordType: candidate.recordType,
        recordId: candidate.id, ruleId: rule.id, breachedAt: breachAt, status: "open",
        currentLevel: level,
        nextEscalateAt: addBusinessDays(now, intervalFor(rule, trigger, 1), calendar),
        stateNote: `SLA breached at ${level}`,
      }).onConflictDoNothing().returning({ id: app.instances.id });
      if (!inserted) continue;
      const recipientIds = await resolveRecipients(database, app, rule, level);
      for (const recipientId of recipientIds) {
        await database.insert(app.notifications).values({
          organizationId: candidate.organizationId, recipientId,
          title: `${app.label} ${level} escalation`,
          body: `${candidate.recordType} breached its business-day SLA and escalated to ${level}.`,
          channel: "in_app",
        });
      }
      created++;
    }
  }
  return created;
}

async function performanceCandidates(database: typeof db): Promise<Candidate[]> {
  const [entries, benchmarks] = await Promise.all([
    database.select().from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.status, "active"), isNull(qaqcMetricEntries.deletedAt))),
    database.select().from(targetBenchmarks).where(and(eq(targetBenchmarks.status, "active"), isNull(targetBenchmarks.deletedAt))),
  ]);
  const targets = new Map(benchmarks.filter((row) => row.metricKey === "closure_rate")
    .map((row) => [row.organizationId, Number(row.targetValue)]));
  const grouped = new Map<string, typeof entries>();
  for (const row of entries) {
    const key = `${row.organizationId}:${row.projectId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const result: Candidate[] = [];
  for (const rows of grouped.values()) {
    const target = targets.get(rows[0]!.organizationId);
    if (target === undefined) continue;
    const periods = new Map<string, { issued: number; closed: number }>();
    for (const row of rows) {
      const value = periods.get(row.reportingPeriod) ?? { issued: 0, closed: 0 };
      value.issued += row.issuedCount; value.closed += row.closedCount; periods.set(row.reportingPeriod, value);
    }
    const ordered = [...periods].sort(([a], [b]) => b.localeCompare(a));
    let consecutive = 0;
    for (const [, value] of ordered) {
      const rate = value.issued === 0 ? 100 : (value.closed / value.issued) * 100;
      if (rate < target) consecutive++; else break;
    }
    if (consecutive >= 2) result.push({
      id: rows[0]!.projectId, organizationId: rows[0]!.organizationId,
      anchorAt: new Date(`${ordered[consecutive - 1]![0]}T00:00:00Z`),
      recordType: "quality_performance", triggerType: "performance", slaOverride: 0,
    });
  }
  return result;
}

async function upgradeFindingPriorities(database: typeof db, calendars: Map<string, Calendar>) {
  const rules = await database.select().from(auditEscalationRules).where(and(
    eq(auditEscalationRules.triggerKey, "finding_priority"),
    eq(auditEscalationRules.status, "active"), isNull(auditEscalationRules.deletedAt),
  ));
  const findings = await database.select().from(auditFindings).where(and(
    eq(auditFindings.status, "active"), isNull(auditFindings.deletedAt),
  ));
  const prioritySla: Record<string, number> = { P1: 2, P2: 2, P3: 2, P4: 2, P5: 3, P6: 3 };
  for (const row of findings) {
    if (!rules.some((rule) => rule.organizationId === row.organizationId) || !row.priority) continue;
    const metadata = row.evidence as Record<string, unknown>;
    const raisedAt = new Date(typeof metadata.raisedAt === "string" ? metadata.raisedAt : row.createdAt);
    const age = businessDaysElapsed(raisedAt, new Date(), calendars.get(row.organizationId) ?? defaultCalendar);
    let number = Number(row.priority.slice(1));
    let consumed = 0;
    while (number > 1 && age >= consumed + (prioritySla[`P${number}`] ?? 3)) {
      consumed += prioritySla[`P${number}`] ?? 3; number--;
    }
    const priority = `P${number}`;
    if (priority !== row.priority) {
      await database.update(auditFindings).set({ priority, updatedAt: new Date() }).where(eq(auditFindings.id, row.id));
      row.priority = priority;
    }
  }
  return findings.map((row) => {
    const metadata = row.evidence as Record<string, unknown>;
    return {
      id: row.id, organizationId: row.organizationId,
      anchorAt: new Date(typeof metadata.raisedAt === "string" ? metadata.raisedAt : row.createdAt),
      recordType: "audit_finding", triggerType: "finding_priority" as const,
    };
  });
}

export async function evaluateEscalations(database: typeof db = db) {
  const [settings, briefs, lessons, activeLessonInstances, actions, performance] = await Promise.all([
    database.select().from(organizationSettings).where(and(eq(organizationSettings.status, "active"), isNull(organizationSettings.deletedAt))),
    database.select().from(qualityAssessmentBriefs).where(and(
      eq(qualityAssessmentBriefs.workflowState, "submitted"), isNull(qualityAssessmentBriefs.deletedAt),
    )),
    database.select().from(lessonLearnedForms).where(and(
      inArray(lessonLearnedForms.workflowState, ["submitted", "sent_back", "draft"]),
      isNull(lessonLearnedForms.deletedAt),
    )),
    database.select({ recordId: lessonEscalationInstances.recordId }).from(lessonEscalationInstances).where(and(
      eq(lessonEscalationInstances.status, "open"), isNull(lessonEscalationInstances.deletedAt),
    )),
    database.select().from(correctiveActionReports).where(and(
      inArray(correctiveActionReports.workflowState, ["open", "submitted", "draft", "extension_requested"]),
      isNull(correctiveActionReports.deletedAt),
    )),
    performanceCandidates(database),
  ]);
  const calendars = new Map(settings.map((row) => [row.organizationId, normalizedCalendar(row.workingCalendar)]));
  const activeLessonIds = new Set(activeLessonInstances.map((row) => row.recordId));
  const findingCandidates = await upgradeFindingPriorities(database, calendars);
  const [qaqc, lessonCount, audit] = await Promise.all([
    reconcileApp(database, appTables[0]!, [
      ...briefs.map((row) => ({
        id: row.id, organizationId: row.organizationId, anchorAt: row.updatedAt,
        recordType: "quality_brief", triggerType: "approval_delay" as const,
      })),
      ...performance,
      // missing_submission needs a persisted deadline/expected-submission signal; skip until one exists.
    ], calendars),
    reconcileApp(database, appTables[1]!, lessons
      .filter((row) => row.workflowState !== "draft" || activeLessonIds.has(row.id))
      .map((row) => ({
      id: row.id, organizationId: row.organizationId, anchorAt: row.createdAt,
      recordType: "lesson", triggerType: "lesson_sla" as const,
      slaOverride: row.issueCategory.toLowerCase() === "major" && row.impact.toLowerCase() === "negative" ? 2 : 5,
    })), calendars),
    reconcileApp(database, appTables[2]!, [
      ...actions.map((row) => ({
      id: row.id, organizationId: row.organizationId, anchorAt: row.createdAt,
      recordType: "corrective_action", triggerType: "approval_delay" as const,
      dueAt: row.extensionDueDate || row.dueDate ? new Date((row.extensionDueDate ?? row.dueDate)!) : null,
      })),
      ...findingCandidates,
    ], calendars),
  ]);
  return { qaqc, lessons: lessonCount, audit };
}

export function startEscalationScheduler(app: Express) {
  const logger = (app as Express & { logger?: { info: (value: unknown, message?: string) => void; error: (value: unknown, message?: string) => void } }).logger;
  const run = async () => {
    try {
      const result = await evaluateEscalations();
      if (logger) logger.info(result, "Escalation reconciliation sweep completed");
      else console.info("Escalation reconciliation sweep completed", result);
    } catch (error) {
      if (logger) logger.error({ error }, "Escalation reconciliation sweep failed");
      else console.error("Escalation reconciliation sweep failed", error);
    }
  };
  const timer = setInterval(() => { void run(); }, 15 * 60 * 1000);
  timer.unref();
  void run();
  return timer;
}