import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings } from "@workspace/db";
import { HttpError } from "./workspace";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import {
  nextPlanNumber, planNumberSource, planNumberYear, validatePlanNumberPattern,
  type PlanNumberPattern, type PlanNumberState,
} from "./audit-plan-numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const defaultReportNumberPattern: PlanNumberPattern = { prefix: "AR", middle: "", separator: "-", padding: 4 };
export function reportNumberState(map: unknown): PlanNumberState {
  const saved = (map as Record<string, any> | undefined)?.audit_report_numbering;
  return { pattern: { ...defaultReportNumberPattern, ...saved?.pattern }, ranges: saved?.ranges ?? {} };
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
  state.ranges = { ...state.ranges, [source.key]: { ...state.ranges[source.key], [String(year)]: sequence } };
  await tx.update(organizationSettings).set({
    documentNumbering: { ...settings.documentNumbering, audit_report_numbering: state } as any, updatedAt: new Date(),
  }).where(eq(organizationSettings.id, settings.id));
  return { reportNumber: number, reportNumberScope: source.key, reportNumberYear: year, reportNumberSequence: sequence };
}
export async function saveReportNumbering(
  organizationId: string, pattern?: PlanNumberPattern,
  range?: { scope: string; year: number; lastNumber: number },
) {
  if (pattern) validatePlanNumberPattern(pattern);
  return db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, organizationId);
    const state = reportNumberState(settings.documentNumbering);
    if (pattern) state.pattern = pattern;
    if (range) {
      if (!Number.isInteger(range.year) || range.year < 1900 || range.year > 9999 || !Number.isSafeInteger(range.lastNumber) ||
          range.lastNumber < 0 || range.lastNumber >= 999_999_999_999) {
        throw new HttpError(422, "Enter a valid four-digit year and a whole last-used number from 0 to 999999999998.");
      }
      const current = state.ranges[range.scope]?.[String(range.year)] ?? 0;
      if (range.lastNumber < current) throw new HttpError(409, `The last-used number cannot be below ${current}; allocated report numbers must not be reused.`);
      state.ranges = { ...state.ranges, [range.scope]: { ...state.ranges[range.scope], [String(range.year)]: range.lastNumber } };
    }
    await tx.update(organizationSettings).set({
      documentNumbering: { ...settings.documentNumbering, audit_report_numbering: state } as any, updatedAt: new Date(),
    }).where(eq(organizationSettings.id, settings.id));
    return state;
  });
}
