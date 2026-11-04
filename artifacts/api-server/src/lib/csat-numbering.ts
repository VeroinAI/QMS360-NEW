import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings, projects, qaqcReportSubmissions } from "@workspace/db";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import { HttpError } from "./workspace";
import { auditProjectNumberSourceValue } from "./audit-number-source";
import { continuousLastUsed, continuousRanges, validateLastNumber } from "./audit-continuous-numbering";

export type CsatPattern = { prefix: string; middle: string; separator: string; padding: number };
export type CsatRange = { projectId: string; lastNumber: number };
export type CsatNumberState = { pattern: CsatPattern; ranges: Record<string, Record<string, number>> };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function csatReferenceYear(date: string) {
  const year = Number(date.slice(0, 4));
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || year < 1900 || year > 9999 ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpError(422, "A valid CSAT Date is required before creating a draft.");
  }
  return year;
}
export function formatCsatReference(pattern: CsatPattern, contractProjectNumber: string, date: string, number: number) {
  validateCsatPattern(pattern);
  if (!contractProjectNumber.trim()) throw new HttpError(422, "Maintain Contract / project no. in Integration Cockpit → Project Master → Additional Data before creating this CSAT draft.");
  if (!Number.isSafeInteger(number) || number < 1 || number > 999_999_999_999) throw new HttpError(409, "CSAT reference number range is exhausted or invalid.");
  csatReferenceYear(date); // Validate the survey date, but do not include it in or partition the reference.
  return [pattern.prefix, contractProjectNumber.trim(), pattern.middle, String(number).padStart(pattern.padding, "0")]
    .filter(Boolean).join(pattern.separator);
}
export function csatNumberState(map: unknown): CsatNumberState {
  const saved = (map as Record<string, any> | undefined)?.csat_reference_numbering;
  return { pattern: { prefix: "CSAT", middle: "", separator: "-", padding: 4, ...saved?.pattern }, ranges: continuousRanges(saved?.ranges, "CSAT") };
}
export function validateCsatPattern(pattern: CsatPattern) {
  if (!Number.isInteger(pattern.padding) || pattern.padding < 1 || pattern.padding > 12 ||
      [pattern.prefix, pattern.middle, pattern.separator].some(text => typeof text !== "string" || text.length > 80 || /[{}\r\n]/.test(text))) {
    throw new HttpError(422, "Use literal prefix/middle/separator text and 1–12 running number padding digits.");
  }
}
export function applyCsatNumbering(state: CsatNumberState, pattern?: CsatPattern, range?: CsatRange): CsatNumberState {
  if (pattern) validateCsatPattern(pattern);
  if (!range) return { ...state, pattern: pattern ?? state.pattern };
  if (!range.projectId) {
    throw new HttpError(422, "Select a project before maintaining its last-used number.");
  }
  const current = continuousLastUsed(state.ranges[range.projectId], "CSAT");
  validateLastNumber(range.lastNumber, current);
  return { pattern: pattern ?? state.pattern, ranges: { ...state.ranges,
    [range.projectId]: { ...state.ranges[range.projectId], continuous: range.lastNumber } } };
}
export async function readCsatNumbering(organizationId: string) {
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return csatNumberState(settings?.documentNumbering);
}
// Settings maintenance never issues a reference.
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

/** Allocate within the same transaction as draft creation: failed inserts roll back the counter. */
export async function allocateCsatReference(tx: Tx, organizationId: string, projectId: string, date: string) {
  csatReferenceYear(date);
  const { settings } = await lockScheduleNumbering(tx, organizationId);
  const [project] = await tx.select({ customFields: projects.customFields }).from(projects).where(and(
    eq(projects.organizationId, organizationId), eq(projects.id, projectId), isNull(projects.deletedAt)));
  if (!project) throw new HttpError(404, "Project is not available for CSAT numbering.");
  const state = csatNumberState(settings.documentNumbering);
  let number = continuousLastUsed(state.ranges[projectId], "CSAT") + 1;
  let reference: string;
  // Preserve historical references even if they predate these counters or the format changed.
  for (;;) {
    reference = formatCsatReference(state.pattern, auditProjectNumberSourceValue(project.customFields), date, number);
    const [existing] = await tx.select({ id: qaqcReportSubmissions.id }).from(qaqcReportSubmissions).where(and(
      eq(qaqcReportSubmissions.organizationId, organizationId), eq(qaqcReportSubmissions.reportType, "csat"),
      eq(qaqcReportSubmissions.referenceNumber, reference))).limit(1);
    if (!existing) break;
    number++;
  }
  state.ranges = { ...state.ranges, [projectId]: { ...state.ranges[projectId], continuous: number } };
  await tx.update(organizationSettings).set({
    documentNumbering: { ...settings.documentNumbering, csat_reference_numbering: state } as any, updatedAt: new Date(),
  }).where(eq(organizationSettings.id, settings.id));
  return reference;
}
