import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings } from "@workspace/db";
import { HttpError } from "./workspace";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import { continuousLastUsed, continuousRanges, validateLastNumber, type AuditLastNumberRange } from "./audit-continuous-numbering";
import {
  nextPlanNumber, planNumberSource, planNumberYear, validatePlanNumberPattern,
  type PlanNumberPattern, type PlanNumberState,
} from "./audit-plan-numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const defaultReportNumberPattern: PlanNumberPattern = { prefix: "AR", middle: "", separator: "-", padding: 4 };
export function reportNumberState(map: unknown): PlanNumberState {
  const saved = (map as Record<string, any> | undefined)?.audit_report_numbering;
  return { pattern: { ...defaultReportNumberPattern, ...saved?.pattern }, ranges: continuousRanges(saved?.ranges) };
}
export async function readReportNumberState(organizationId: string) {
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return reportNumberState(settings?.documentNumbering);
}
/** Caller locks organization settings before the audit. Allocation rolls back with the details save. */
export async function allocateReportNumber(
  tx: Tx, settings: typeof organizationSettings.$inferSelect,
  projectId: string | null, department: string | undefined, fromDate: unknown,
) {
  const source = await planNumberSource(tx, settings.organizationId, projectId, department, "Audit Report");
  const year = planNumberYear(fromDate, "Audit Report");
  const state = reportNumberState(settings.documentNumbering);
  const { sequence, number } = nextPlanNumber(state, source, year, "Audit Report");
  state.ranges = { ...state.ranges, [source.key]: { ...state.ranges[source.key], continuous: sequence } };
  await tx.update(organizationSettings).set({
    documentNumbering: { ...settings.documentNumbering, audit_report_numbering: state } as any, updatedAt: new Date(),
  }).where(eq(organizationSettings.id, settings.id));
  return { reportNumber: number, reportNumberScope: source.key, reportNumberYear: year, reportNumberSequence: sequence };
}
export async function saveReportNumbering(
  organizationId: string, pattern?: PlanNumberPattern,
  range?: AuditLastNumberRange,
) {
  if (pattern) validatePlanNumberPattern(pattern);
  return db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, organizationId);
    const state = reportNumberState(settings.documentNumbering);
    if (pattern) state.pattern = pattern;
    if (range) {
      validateLastNumber(range.lastNumber, continuousLastUsed(state.ranges[range.scope]));
      state.ranges = { ...state.ranges, [range.scope]: { ...state.ranges[range.scope], continuous: range.lastNumber } };
    }
    await tx.update(organizationSettings).set({
      documentNumbering: { ...settings.documentNumbering, audit_report_numbering: state } as any, updatedAt: new Date(),
    }).where(eq(organizationSettings.id, settings.id));
    return state;
  });
}
