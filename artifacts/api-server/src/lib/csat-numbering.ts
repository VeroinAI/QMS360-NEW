import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings } from "@workspace/db";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import { HttpError } from "./workspace";

export type CsatPattern = { prefix: string; separator: string; padding: number };
export type CsatRange = { projectId: string; year: number; lastNumber: number };
export type CsatNumberState = { pattern: CsatPattern; ranges: Record<string, Record<string, number>> };
export function csatNumberState(map: unknown): CsatNumberState {
  const saved = (map as Record<string, any> | undefined)?.csat_reference_numbering;
  return { pattern: { prefix: "CSAT", separator: "-", padding: 4, ...saved?.pattern }, ranges: saved?.ranges ?? {} };
}
export function validateCsatPattern(pattern: CsatPattern) {
  if (!Number.isInteger(pattern.padding) || pattern.padding < 1 || pattern.padding > 12 ||
      [pattern.prefix, pattern.separator].some(text => typeof text !== "string" || text.length > 80 || /[{}\r\n]/.test(text))) {
    throw new HttpError(422, "Use literal prefix/separator text and 1–12 running number padding digits.");
  }
}
export function applyCsatNumbering(state: CsatNumberState, pattern?: CsatPattern, range?: CsatRange): CsatNumberState {
  if (pattern) validateCsatPattern(pattern);
  if (!range) return { ...state, pattern: pattern ?? state.pattern };
  if (!range.projectId || !Number.isInteger(range.year) || range.year < 1900 || range.year > 9999 ||
      !Number.isSafeInteger(range.lastNumber) || range.lastNumber < 0 || range.lastNumber >= 999_999_999_999) {
    throw new HttpError(422, "Enter a project, four-digit year and whole last-used number from 0 to 999999999998.");
  }
  const current = state.ranges[range.projectId]?.[String(range.year)] ?? 0;
  if (range.lastNumber < current) throw new HttpError(409, `The last-used number cannot be below ${current}; numbers must not be reused.`);
  return { pattern: pattern ?? state.pattern, ranges: { ...state.ranges,
    [range.projectId]: { ...state.ranges[range.projectId], [String(range.year)]: range.lastNumber } } };
}
export async function readCsatNumbering(organizationId: string) {
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return csatNumberState(settings?.documentNumbering);
}
// Configuration only. No CSAT record is read, changed or assigned a reference here.
export async function saveCsatNumbering(organizationId: string, pattern?: CsatPattern, range?: CsatRange) {
  return db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, organizationId);
    const state = applyCsatNumbering(csatNumberState(settings.documentNumbering), pattern, range);
    await tx.update(organizationSettings).set({
      documentNumbering: { ...settings.documentNumbering, csat_reference_numbering: state } as any, updatedAt: new Date(),
    }).where(eq(organizationSettings.id, settings.id));
    return state;
  });
}
