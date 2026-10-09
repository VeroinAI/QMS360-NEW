import { organizationDateFormat } from "./date-format";
import { formatDate } from "@workspace/spreadsheet-dates";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  applicationAccess, db, lessonEscalationRules, lessonLearnedForms, lessonsUserWorkspaceRoles,
  lessonsWorkspaceRoles, organizationSettings, projects, users,
  lessonsEscalationOccurrences,
} from "@workspace/db";
import { enqueueEmail } from "./email-queue";
import { businessDaysElapsed } from "./escalation";

export const LESSONS_DIGEST_REPORT = "pending_lessons_approval" as const;
export type LessonsDigestJob = {
  enabled: boolean; reportKey: typeof LESSONS_DIGEST_REPORT;
  frequency: "custom" | "daily" | "weekly" | "monthly";
  time: string; weeklyDay: number; monthlyDay: number; customIntervalMinutes: number;
  lastRunAt?: string | null; nextRunAt?: string | null;
};

const defaultJob: LessonsDigestJob = {
  enabled: false, reportKey: LESSONS_DIGEST_REPORT, frequency: "daily", time: "09:00",
  weeklyDay: 1, monthlyDay: 1, customIntervalMinutes: 1440, lastRunAt: null, nextRunAt: null,
};
const safeJob = (value: unknown): LessonsDigestJob => {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const frequency = ["custom", "daily", "weekly", "monthly"].includes(String(raw.frequency))
    ? raw.frequency as LessonsDigestJob["frequency"] : defaultJob.frequency;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaultJob.enabled,
    reportKey: LESSONS_DIGEST_REPORT,
    frequency,
    time: typeof raw.time === "string" ? raw.time : defaultJob.time,
    weeklyDay: typeof raw.weeklyDay === "number" ? raw.weeklyDay : defaultJob.weeklyDay,
    monthlyDay: typeof raw.monthlyDay === "number" ? raw.monthlyDay : defaultJob.monthlyDay,
    customIntervalMinutes: typeof raw.customIntervalMinutes === "number" ? raw.customIntervalMinutes : defaultJob.customIntervalMinutes,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    nextRunAt: typeof raw.nextRunAt === "string" ? raw.nextRunAt : null,
  };
};

export function normalizeLessonsDigestJob(value: unknown) { return safeJob(value); }
export function isLessonsDigestDue(job: LessonsDigestJob, now: Date, force = false) {
  return force || (job.enabled && Boolean(job.nextRunAt) && new Date(job.nextRunAt!).getTime() <= now.getTime());
}
export function selectSubmittedForms<T extends { workflowState: string }>(forms: T[]) {
  return forms.filter((form) => form.workflowState === "submitted");
}
export function greatestReachedLessonRule<T extends { slaWorkingDays: number }>(rules: T[], workingDaysPending: number) {
  return [...rules].sort((a, b) => a.slaWorkingDays - b.slaWorkingDays).reverse().find((rule) => workingDaysPending >= rule.slaWorkingDays);
}
export function buildDigestQueueRows<T extends { email: string; name?: string | null }>(
  primary: T[], cc: T[],
) {
  const primaryByEmail = new Set(primary.map((value) => value.email.toLowerCase()));
  const cleanCc = cc.filter((value, index, values) => !primaryByEmail.has(value.email.toLowerCase())
    && values.findIndex((candidate) => candidate.email.toLowerCase() === value.email.toLowerCase()) === index);
  return primary.map((value, index) => ({ primary: value, cc: index === 0 ? cleanCc : [] }));
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}
function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])) as Record<string, number>;
}
function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  let result = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 3; i++) {
    const p = localParts(result, timezone);
    result = new Date(result.getTime() - ((p.year - year) * 31_536_000_000 + (p.month - month) * 2_592_000_000 + (p.day - day) * 86_400_000 + (p.hour - hour) * 3_600_000 + (p.minute - minute) * 60_000));
  }
  return result;
}
export function nextLessonsDigestRun(now: Date, job: LessonsDigestJob, timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { throw new Error(`Invalid IANA timezone: ${timezone}`); }
  if (job.frequency === "custom") return new Date(now.getTime() + Math.max(15, job.customIntervalMinutes) * 60_000);
  const current = localParts(now, timezone); const [hour, minute] = job.time.split(":").map(Number);
  const candidate = new Date(Date.UTC(current.year, current.month - 1, current.day, hour || 0, minute || 0));
  if (job.frequency === "weekly") {
    const delta = (job.weeklyDay - new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + delta);
  } else if (job.frequency === "monthly") {
    const requestedDay = Math.max(1, Math.min(31, job.monthlyDay));
    const localNow = new Date(Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute));
    // Construct the year/month first. Never ask Date to construct day 29-31
    // before clamping: JS would overflow into the following month.
    let year = current.year; let month = current.month;
    const build = (y: number, m: number) => {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return new Date(Date.UTC(y, m - 1, Math.min(requestedDay, last), hour || 0, minute || 0));
    };
    candidate.setTime(build(year, month).getTime());
    if (candidate <= localNow) {
      month++;
      if (month === 13) { month = 1; year++; }
      candidate.setTime(build(year, month).getTime());
    }
  }
  if (candidate <= new Date(Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute))) {
    if (job.frequency === "daily") candidate.setUTCDate(candidate.getUTCDate() + 1);
    if (job.frequency === "weekly") candidate.setUTCDate(candidate.getUTCDate() + 7);
  }
  return localToUtc(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, candidate.getUTCDate(), candidate.getUTCHours(), candidate.getUTCMinutes(), timezone);
}

async function recipientsForRoles(organizationId: string, roleNames: string[], cc: boolean) {
  const roles = await db.select({ id: lessonsWorkspaceRoles.id }).from(lessonsWorkspaceRoles).where(and(
    eq(lessonsWorkspaceRoles.organizationId, organizationId), inArray(lessonsWorkspaceRoles.name, roleNames),
    eq(lessonsWorkspaceRoles.status, "active"), isNull(lessonsWorkspaceRoles.deletedAt),
  ));
  const ids = roles.length ? await db.select({ userId: lessonsUserWorkspaceRoles.userId }).from(lessonsUserWorkspaceRoles).where(and(
    eq(lessonsUserWorkspaceRoles.organizationId, organizationId), inArray(lessonsUserWorkspaceRoles.workspaceRoleId, roles.map((r) => r.id)),
    eq(lessonsUserWorkspaceRoles.status, "active"), isNull(lessonsUserWorkspaceRoles.deletedAt),
  )) : [];
  const usersForRoles = ids.length ? await db.select({ email: users.email, name: users.fullName, id: users.id }).from(users).where(and(
    eq(users.organizationId, organizationId), inArray(users.id, [...new Set(ids.map((r) => r.userId))]),
    eq(users.accessStatus, "active"), isNull(users.deletedAt),
  )) : [];
  if (usersForRoles.length || cc) return usersForRoles;
  const adminColumn = applicationAccess.isInitialAdminLessons;
  const admins = await db.select({ id: users.id }).from(applicationAccess).innerJoin(users, and(
    eq(users.organizationId, applicationAccess.organizationId), eq(users.username, applicationAccess.username),
    eq(users.accessStatus, "active"), isNull(users.deletedAt),
  )).where(and(eq(applicationAccess.organizationId, organizationId), eq(adminColumn, true), eq(applicationAccess.status, "active"), isNull(applicationAccess.deletedAt)));
  return admins.length ? await db.select({ email: users.email, name: users.fullName, id: users.id }).from(users).where(inArray(users.id, admins.map((r) => r.id))) : [];
}

export async function runLessonsEscalationDigest(organizationId?: string, force = false) {
  const settings = await db.select().from(organizationSettings).where(and(isNull(organizationSettings.deletedAt), organizationId ? eq(organizationSettings.organizationId, organizationId) : undefined));
  let sentGroups = 0;
  for (const setting of settings) {
    const job = safeJob(setting.lessonsEscalationReportJob);
    const now = new Date();
    if (!isLessonsDigestDue(job, now, force)) continue;
    const calendar = { workingDays: setting.workingCalendar.workingDays, holidays: setting.workingCalendar.holidays };
    const [rules, forms] = await Promise.all([
      db.select().from(lessonEscalationRules).where(and(eq(lessonEscalationRules.organizationId, setting.organizationId), eq(lessonEscalationRules.triggerKey, "lesson_sla"), eq(lessonEscalationRules.status, "active"), isNull(lessonEscalationRules.deletedAt))).orderBy(asc(lessonEscalationRules.slaWorkingDays)),
      db.select({ form: lessonLearnedForms, projectName: projects.name }).from(lessonLearnedForms).innerJoin(projects, eq(projects.id, lessonLearnedForms.projectId)).where(and(
        eq(lessonLearnedForms.organizationId, setting.organizationId), eq(lessonLearnedForms.workflowState, "submitted"),
        eq(projects.organizationId, setting.organizationId), eq(projects.status, "active"), isNull(projects.deletedAt),
        isNull(lessonLearnedForms.deletedAt),
      )),
    ]);
    const groups = new Map<string, { rule: any; rows: any[] }>();
    const personIds = [...new Set(forms.flatMap((row) => [row.form.submittedById, row.form.creatorId, row.form.approverId].filter((id): id is string => Boolean(id))))];
    const people = personIds.length ? await db.select({ id: users.id, name: users.fullName }).from(users).where(and(eq(users.organizationId, setting.organizationId), inArray(users.id, personIds), isNull(users.deletedAt))) : [];
    const peopleById = new Map(people.map((person) => [person.id, person.name]));
    for (const row of forms) {
      if (!row.form.submittedAt) continue;
      const age = businessDaysElapsed(row.form.submittedAt, now, calendar, setting.timezone);
      const rule = greatestReachedLessonRule(rules, age);
      if (!rule) continue;
      const key = rule.id; const group = groups.get(key) ?? { rule, rows: [] };
      group.rows.push({ ...row, age }); groups.set(key, group);
    }
    const queuedInputs: any[] = [];
    for (const { rule, rows } of groups.values()) {
      const config = rule.configuration && typeof rule.configuration === "object" ? rule.configuration : {};
      const level = config.level ?? rule.priority ?? "P1";
      const toRoles = String(rule.recipientRole ?? "").split(",").map((v) => v.trim()).filter(Boolean);
      const ccRoles = Array.isArray(config.ccRecipientRoles) ? config.ccRecipientRoles.filter((v: unknown): v is string => typeof v === "string") : [];
      const [to, cc] = await Promise.all([recipientsForRoles(setting.organizationId, toRoles, false), recipientsForRoles(setting.organizationId, ccRoles, true)]);
      const ccRecipients = cc.filter((value) => !to.some((target) => target.email.toLowerCase() === value.email.toLowerCase())).map((value) => ({ email: value.email, name: value.name }));
      const headers = ["Reference", "Title", "Project", "Submitter", "Approver", "Submitted", "Working days", "Level", "Threshold"];
      const dateFormat = await organizationDateFormat(setting.organizationId);
      const cells = rows.map((row) => [row.form.referenceNumber, row.form.title, row.projectName, peopleById.get(row.form.submittedById ?? row.form.creatorId) ?? "Unknown", peopleById.get(row.form.approverId) ?? "Unassigned", formatDate(row.form.submittedAt, dateFormat), row.age, level, rule.slaWorkingDays]);
      const text = [headers.join(" | "), ...cells.map((row) => row.map(String).join(" | "))].join("\n");
      const html = `<p>Pending Lessons Learned forms requiring approval at <strong>${escapeHtml(level)}</strong>:</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${cells.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      queuedInputs.push({ organizationId: setting.organizationId, recipientIds: to.map((v) => v.id), ccRecipients, subject: `Pending Lessons Learned approvals — ${level}`, text, html, context: { app: "lessons", eventType: "lessons.pending_approval_digest", reportKey: LESSONS_DIGEST_REPORT, ruleId: rule.id, level } });
    }
    const next = nextLessonsDigestRun(now, job, setting.timezone);
    const occurrenceKey = force ? `manual:${randomUUID()}` : `scheduled:${job.nextRunAt}`;
    const claimed = await db.transaction(async (tx) => {
      const [lock] = await tx.select({ locked: sql<boolean>`pg_try_advisory_xact_lock(hashtextextended(${`${setting.organizationId}:${LESSONS_DIGEST_REPORT}`}, 0))` }).from(organizationSettings).limit(1);
      if (!lock?.locked) return "busy" as const;
      // Claim the exact scheduled slot at SQL level before any queue insert.
      // The row lock held by this update also serializes an admin save.
      if (!force) {
        const [slot] = await tx.update(organizationSettings).set({ updatedAt: now }).where(and(
          eq(organizationSettings.id, setting.id),
          eq(organizationSettings.lessonsEscalationReportJob, setting.lessonsEscalationReportJob),
          sql`${organizationSettings.lessonsEscalationReportJob}->>'enabled' = 'true'`,
          sql`${organizationSettings.lessonsEscalationReportJob}->>'nextRunAt' = ${job.nextRunAt}`,
        )).returning({ id: organizationSettings.id });
        if (!slot) return "stale" as const;
      }
      const [occurrence] = await tx.insert(lessonsEscalationOccurrences).values({
        organizationId: setting.organizationId, reportKey: LESSONS_DIGEST_REPORT, occurrenceKey,
      }).onConflictDoNothing().returning({ id: lessonsEscalationOccurrences.id });
      if (!occurrence) return "duplicate" as const;
      for (const input of queuedInputs) await enqueueEmail(tx as unknown as typeof db, input);
      const [current] = await tx.select({ job: organizationSettings.lessonsEscalationReportJob }).from(organizationSettings).where(eq(organizationSettings.id, setting.id)).limit(1);
      const currentJob = safeJob(current?.job);
      // A concurrent settings edit owns the new schedule; never overwrite it.
      if (!force && currentJob.nextRunAt === job.nextRunAt) {
        await tx.update(organizationSettings).set({ lessonsEscalationReportJob: { ...currentJob, lastRunAt: now.toISOString(), nextRunAt: currentJob.enabled ? next.toISOString() : null }, updatedAt: now }).where(eq(organizationSettings.id, setting.id));
      } else if (force) {
        await tx.update(organizationSettings).set({
          lessonsEscalationReportJob: sql`jsonb_set(${organizationSettings.lessonsEscalationReportJob}, '{lastRunAt}', to_jsonb(${now.toISOString()}::text), true)`,
          updatedAt: now,
        }).where(eq(organizationSettings.id, setting.id));
      }
      await tx.update(lessonsEscalationOccurrences).set({ completedAt: now, updatedAt: now }).where(eq(lessonsEscalationOccurrences.id, occurrence.id));
      return "claimed" as const;
    });
    if (claimed === "claimed") sentGroups += queuedInputs.length;
    if (claimed === "busy" && force) return { sentGroups, skipped: true };
  }
  return { sentGroups };
}