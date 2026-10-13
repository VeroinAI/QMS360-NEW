import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings, projects, masterDataValues } from "@workspace/db";
import { HttpError } from "./workspace";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import { projectNumberContext } from "@workspace/field-controls";
import { resolveMasterDataGroupId } from "./lov";

export type PlanNumberPattern = { prefix: string; middle: string; separator: string; padding: number };
export type PlanNumberState = { pattern: PlanNumberPattern; ranges: Record<string, Record<string, number>> };
export const defaultPlanNumberPattern: PlanNumberPattern = { prefix: "AP", middle: "", separator: "-", padding: 4 };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Tx, "select">;
export const planNumberState = (map: unknown): PlanNumberState => {
  const saved = (map as Record<string, any> | undefined)?.audit_plan_numbering;
  return { pattern: { ...defaultPlanNumberPattern, ...saved?.pattern }, ranges: saved?.ranges ?? {} };
};
export function formatPlanNumber(pattern: PlanNumberPattern, source: string, year: number, number: number) {
  return [pattern.prefix, source, pattern.middle, String(year).slice(-2), String(number).padStart(pattern.padding, "0")]
    .filter(part => part !== "").join(pattern.separator);
}
export function validatePlanNumberPattern(pattern: PlanNumberPattern) {
  if (!Number.isInteger(pattern.padding) || pattern.padding < 1 || pattern.padding > 12 ||
    [pattern.prefix, pattern.middle, pattern.separator].some(text => typeof text !== "string" || text.length > 80 || /[{}\r\n]/.test(text))) {
    throw new HttpError(422, "Use literal prefix/middle text, a separator and 1–12 padding digits. The source and year are inserted automatically.");
  }
}
export async function getPlanNumberDepartments(reader: Reader, organizationId: string) {
  const groupId = await resolveMasterDataGroupId(reader, organizationId, "departments");
  if (!groupId) return [];
  return reader.select({ id: masterDataValues.id, value: masterDataValues.value, label: masterDataValues.label })
    .from(masterDataValues).where(and(
      eq(masterDataValues.organizationId, organizationId), eq(masterDataValues.groupId, groupId),
      isNull(masterDataValues.deletedAt), eq(masterDataValues.active, true), eq(masterDataValues.status, "active")));
}
export async function planNumberSource(reader: Reader, organizationId: string, projectId: string | null, department?: string) {
  if (projectId) {
    const [project] = await reader.select().from(projects).where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
    const sourceValue = projectNumberContext(project?.customFields ?? {}).costCentre;
    if (typeof sourceValue !== "string" || !sourceValue.trim()) throw new HttpError(422, "Maintain the project's Cost Center in Integration Cockpit → Project Master → Additional Data before creating this Audit Plan.");
    return { key: `project:${projectId}`, kind: "project" as const, label: project!.name, sourceValue: sourceValue.trim() };
  }
  const selected = department?.trim();
  if (!selected) throw new HttpError(422, "The linked Audit Schedule must identify a department or project.");
  const matches = (await getPlanNumberDepartments(reader, organizationId))
    .filter(value => value.value === selected || value.label === selected || value.id === selected);
  const exact = matches.find(value => value.value === selected) ?? matches.find(value => value.id === selected);
  if (!exact && matches.length > 1) throw new HttpError(422, "The department label is ambiguous. Select its Department master Value in the Audit Schedule.");
  const value = exact ?? matches[0];
  if (!value?.value.trim()) throw new HttpError(422, "The department selected in the Audit Schedule must match an active Department master Value.");
  return { key: `department:${value.id}`, kind: "department" as const, label: value.label, sourceValue: value.value };
}
export function planNumberYear(fromDate: unknown): number {
  if (typeof fromDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(fromDate)) throw new HttpError(422, "A valid From Date is required on the linked Audit Schedule for Audit Plan numbering.");
  const year = Number(fromDate.slice(0, 4));
  const date = new Date(`${fromDate.slice(0, 10)}T00:00:00Z`);
  if (year < 1900 || year > 9999 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== fromDate.slice(0, 10)) {
    throw new HttpError(422, "The Audit Schedule From Date must be a valid calendar date between years 1900 and 9999.");
  }
  return year;
}
/** Read-only calculation shared by preview and allocation. Never reserves a number. */
export function nextPlanNumber(state: PlanNumberState, source: { key: string; sourceValue: string }, year: number) {
  const last = state.ranges[source.key]?.[String(year)] ?? 0;
  if (!Number.isSafeInteger(last) || last < 0 || last >= 999_999_999_999) throw new HttpError(409, "Audit Plan number range is exhausted or invalid.");
  const sequence = last + 1;
  return { sequence, number: formatPlanNumber(state.pattern, source.sourceValue, year, sequence) };
}
export async function previewPlanNumber(organizationId: string, projectId: string | null, department: string | undefined, fromDate: unknown) {
  const source = await planNumberSource(db, organizationId, projectId, department);
  const year = planNumberYear(fromDate);
  return { planNumber: nextPlanNumber(await readPlanNumberState(organizationId), source, year).number };
}
/** Caller must lock numbering BEFORE the schedule, matching schedule creation/edit lock order. */
export async function allocatePlanNumber(tx: Tx, settings: typeof organizationSettings.$inferSelect, projectId: string | null, department: string | undefined, fromDate: unknown) {
  const source = await planNumberSource(tx, settings.organizationId, projectId, department);
  const year = planNumberYear(fromDate);
  const state = planNumberState(settings.documentNumbering);
  const { sequence, number } = nextPlanNumber(state, source, year);
  state.ranges = { ...state.ranges, [source.key]: { ...state.ranges[source.key], [String(year)]: sequence } };
  await tx.update(organizationSettings).set({
    documentNumbering: { ...settings.documentNumbering, audit_plan_numbering: state } as any, updatedAt: new Date(),
  }).where(eq(organizationSettings.id, settings.id));
  return { planNumber: number, planNumberScope: source.key, planNumberYear: year, planNumberSequence: sequence };
}
export async function readPlanNumberState(organizationId: string) {
  const [settings] = await db.select().from(organizationSettings).where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return planNumberState(settings?.documentNumbering);
}
export async function savePlanNumbering(organizationId: string, pattern?: PlanNumberPattern, range?: { scope: string; year: number; lastNumber: number }) {
  if (pattern) validatePlanNumberPattern(pattern);
  return db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, organizationId);
    const state = planNumberState(settings.documentNumbering);
    if (pattern) state.pattern = pattern;
    if (range) {
      if (!Number.isInteger(range.year) || range.year < 1900 || range.year > 9999 || !Number.isSafeInteger(range.lastNumber) ||
        range.lastNumber < 0 || range.lastNumber >= 999_999_999_999) throw new HttpError(422, "Enter a valid four-digit year and a whole last-used number from 0 to 999999999998.");
      const current = state.ranges[range.scope]?.[String(range.year)] ?? 0;
      if (range.lastNumber < current) throw new HttpError(409, `The last-used number cannot be below ${current}; allocated numbers must not be reused.`);
      state.ranges = { ...state.ranges, [range.scope]: { ...state.ranges[range.scope], [String(range.year)]: range.lastNumber } };
    }
    await tx.update(organizationSettings).set({ documentNumbering: { ...settings.documentNumbering, audit_plan_numbering: state } as any, updatedAt: new Date() })
      .where(eq(organizationSettings.id, settings.id));
    return state;
  });
}
