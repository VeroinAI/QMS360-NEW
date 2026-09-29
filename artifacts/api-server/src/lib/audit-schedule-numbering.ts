import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings, organizations } from "@workspace/db";

export type NumberRange = { prefix: string; start: number; end: number };
export type ScheduleNumbering = { qaqcReference: NumberRange; auditNumber: NumberRange };
export const defaultScheduleNumbering: ScheduleNumbering = {
  qaqcReference: { prefix: "QAM-IA/", start: 1, end: 999 },
  auditNumber: { prefix: "AUD-", start: 1, end: 999 },
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function scheduleNumberingFromMap(map: Record<string, unknown> | null | undefined): ScheduleNumbering {
  const saved = map?.audit_schedule_fields as Partial<ScheduleNumbering> | undefined;
  return {
    qaqcReference: { ...defaultScheduleNumbering.qaqcReference, ...saved?.qaqcReference, start: 1 },
    auditNumber: { ...defaultScheduleNumbering.auditNumber, ...saved?.auditNumber },
  };
}

export async function getScheduleNumbering(organizationId: string) {
  const [settings] = await db.select({ documentNumbering: organizationSettings.documentNumbering })
    .from(organizationSettings).where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return scheduleNumberingFromMap(settings?.documentNumbering as Record<string, unknown> | undefined);
}

export async function lockScheduleNumbering(tx: Tx, organizationId: string) {
  await tx.insert(organizationSettings).values({ organizationId }).onConflictDoNothing();
  const [settings] = await tx.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt),
  )).for("update");
  if (!settings) throw new Error("Organization numbering settings are unavailable");
  return { settings, config: scheduleNumberingFromMap(settings.documentNumbering as Record<string, unknown>) };
}

export async function calendarYear(tx: Tx, organizationId: string) {
  const [org] = await tx.select({ timezone: organizations.timezone }).from(organizations)
    .where(eq(organizations.id, organizationId));
  return Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: org?.timezone ?? "UTC" }).format(new Date()));
}

export function formatScheduleNumber(range: NumberRange, year: number, sequence: number) {
  return `${range.prefix}${String(year).slice(-2)}-${String(sequence).padStart(3, "0")}`;
}