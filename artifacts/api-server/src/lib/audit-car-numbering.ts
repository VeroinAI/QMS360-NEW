import { and, eq, isNull } from "drizzle-orm";
import { auditFindings, auditPlans, auditSchedules, audits, correctiveActionReports, db, organizationSettings } from "@workspace/db";
import { HttpError } from "./workspace";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import { nextPlanNumber, planNumberSource, planNumberYear, validatePlanNumberPattern, type PlanNumberPattern, type PlanNumberState } from "./audit-plan-numbering";
import { actionableFinding, carJson } from "./car-register";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type CarNumberRange = { scope: string; year: number; nextNumber: number };
export function carNumberState(map: unknown): PlanNumberState {
  const saved = (map as Record<string, any> | undefined)?.audit_car_numbering;
  return { pattern: { prefix: "CAR", middle: "", separator: "-", padding: 4, ...saved?.pattern }, ranges: saved?.ranges ?? {} };
}
export async function readCarNumberState(organizationId: string) {
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return carNumberState(settings?.documentNumbering);
}
export async function saveCarNumbering(organizationId: string, pattern?: PlanNumberPattern, range?: CarNumberRange) {
  if (pattern) validatePlanNumberPattern(pattern);
  return db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, organizationId);
    const state = carNumberState(settings.documentNumbering);
    if (pattern) state.pattern = pattern;
    if (range) {
      if (!Number.isInteger(range.year) || range.year < 1900 || range.year > 9999 ||
          !Number.isSafeInteger(range.nextNumber) || range.nextNumber < 1 || range.nextNumber > 999_999_999_999) {
        throw new HttpError(422, "Enter a valid four-digit year and a whole next CAR number from 1 to 999999999999.");
      }
      const current = state.ranges[range.scope]?.[String(range.year)] ?? 0;
      if (range.nextNumber <= current) throw new HttpError(409, `The next CAR number must be at least ${current + 1}; the counter cannot move backwards.`);
      state.ranges = { ...state.ranges, [range.scope]: { ...state.ranges[range.scope], [String(range.year)]: range.nextNumber - 1 } };
    }
    await tx.update(organizationSettings).set({
      documentNumbering: { ...settings.documentNumbering, audit_car_numbering: state } as any, updatedAt: new Date(),
    }).where(eq(organizationSettings.id, settings.id));
    return state;
  });
}

/** Caller holds the organization numbering lock. Lock audit before CAR, consistent with finding/start flows. */
export async function lockNumberedCarResponse(tx: Tx, settings: typeof organizationSettings.$inferSelect, carId: string, userId: string) {
  const org = settings.organizationId;
  const [parent] = await tx.select({ auditId: auditFindings.auditId }).from(correctiveActionReports)
    .innerJoin(auditFindings, eq(auditFindings.id, correctiveActionReports.auditFindingId))
    .where(and(eq(correctiveActionReports.organizationId, org), eq(correctiveActionReports.id, carId),
      eq(auditFindings.organizationId, org), isNull(auditFindings.deletedAt), isNull(correctiveActionReports.deletedAt)));
  if (!parent) throw new HttpError(404, "CAR finding not found");
  const [audit] = await tx.select().from(audits).where(and(eq(audits.id, parent.auditId),
    eq(audits.organizationId, org), isNull(audits.deletedAt))).for("update");
  const [car] = await tx.select().from(correctiveActionReports).where(and(eq(correctiveActionReports.id, carId),
    eq(correctiveActionReports.organizationId, org), isNull(correctiveActionReports.deletedAt))).for("update");
  if (!audit || !car) throw new HttpError(404, "CAR or Audit not found");
  const [finding] = await tx.select().from(auditFindings).where(eq(auditFindings.id, car.auditFindingId));
  const sourceId = (finding?.evidence as any)?.sourceChecklistItemId;
  const item = Array.isArray(audit.checklistState) ? audit.checklistState.find((entry: any) => entry.id === sourceId) as any : undefined;
  if (sourceId && (!item || !actionableFinding(item))) throw new HttpError(409, "The linked finding changed. Reload the CAR register before saving.");
  if ((item?.actionTakerId || car.ownerId) !== userId) throw new HttpError(403, "Only the assigned action taker may save this response");
  const meta = carJson(car.effectivenessNotes);
  if (car.effectivenessNotes?.trim() && !Object.keys(meta).length && car.effectivenessNotes.trim() !== "{}") {
    meta.legacyEffectivenessNotes = car.effectivenessNotes;
  }
  if (typeof meta.carNumber === "string" && meta.carNumber.trim()) return { car, meta };
  const [plan] = audit.auditPlanId ? await tx.select().from(auditPlans).where(and(eq(auditPlans.id, audit.auditPlanId),
    eq(auditPlans.organizationId, org), isNull(auditPlans.deletedAt))) : [];
  const [schedule] = plan?.auditScheduleId ? await tx.select().from(auditSchedules).where(and(eq(auditSchedules.id, plan.auditScheduleId),
    eq(auditSchedules.organizationId, org), isNull(auditSchedules.deletedAt))) : [];
  if (!plan || !schedule) throw new HttpError(422, "Link this Audit to an Audit Plan and its child Audit Schedule before saving the CAR response.");
  const sm = carJson(schedule.status);
  if (sm.programme) throw new HttpError(422, "CAR numbering requires an individual child Audit Schedule, not a programme.");
  const process = Array.isArray(sm.auditTypes) && sm.auditTypes.includes("Quality Internal Process Audit");
  const source = await planNumberSource(tx, org, process ? null : plan.projectId, sm.departmentProject, "Audit CAR");
  const year = planNumberYear(sm.plannedStartDate, "Audit CAR");
  const state = carNumberState(settings.documentNumbering);
  const { number, sequence } = nextPlanNumber(state, source, year, "Audit CAR");
  state.ranges = { ...state.ranges, [source.key]: { ...state.ranges[source.key], [String(year)]: sequence } };
  await tx.update(organizationSettings).set({
    documentNumbering: { ...settings.documentNumbering, audit_car_numbering: state } as any, updatedAt: new Date(),
  }).where(eq(organizationSettings.id, settings.id));
  return { car, meta: { ...meta, carNumber: number, carNumberScope: source.key, carNumberYear: year, carNumberSequence: sequence } };
}
