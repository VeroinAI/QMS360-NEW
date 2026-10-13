import { and, eq, isNull, sql } from "drizzle-orm";
import { audits, db, organizationSettings } from "@workspace/db";
import { HttpError } from "./workspace";
import { lockScheduleNumbering } from "./audit-schedule-numbering";
import { nextPlanNumber, planNumberSource, planNumberYear, validatePlanNumberPattern } from "./audit-plan-numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const numberedFindingTypes = ["Minor NC", "Moderate NC", "Major NC", "OFI"] as const;
export type NumberedFindingType = typeof numberedFindingTypes[number];
export type FindingNumberPattern = {
  prefix: string; separator: string; padding: number; codes: Record<string, string>;
};
type FindingNumberState = {
  pattern: FindingNumberPattern;
  ranges: Record<string, Record<string, Record<string, number>>>;
};
export const defaultFindingNumberPattern: FindingNumberPattern = {
  prefix: "AF", separator: "-", padding: 4,
  codes: { "Minor NC": "MIN", "Moderate NC": "MOD", "Major NC": "MAJ", OFI: "OFI" },
};
export function findingNumberState(map: unknown): FindingNumberState {
  const saved = (map as Record<string, any> | undefined)?.audit_finding_numbering;
  return {
    pattern: { ...defaultFindingNumberPattern, ...saved?.pattern,
      codes: { ...defaultFindingNumberPattern.codes, ...saved?.pattern?.codes } },
    ranges: saved?.ranges ?? {},
  };
}
export function validateFindingNumberPattern(pattern: FindingNumberPattern) {
  validatePlanNumberPattern({ ...pattern, middle: "" });
  const codes = pattern.codes;
  if (!codes || Object.keys(codes).length !== numberedFindingTypes.length ||
      Object.keys(codes).some(type => !numberedFindingTypes.includes(type as NumberedFindingType)) ||
      numberedFindingTypes.some(type => typeof codes[type] !== "string" || !codes[type].trim() ||
        codes[type].length > 80 || /[{}\r\n]/.test(codes[type]))) {
    throw new HttpError(422, "Maintain a nonempty middle code for Minor NC, Moderate NC, Major NC and OFI only. Use up to 80 literal characters; Not applicable cannot be numbered.");
  }
  if (new Set(numberedFindingTypes.map(type => codes[type].trim().toLowerCase())).size !== numberedFindingTypes.length) {
    throw new HttpError(422, "Each Audit Finding type must have a different middle code because its yearly sequence is separate.");
  }
}
export async function readFindingNumberState(organizationId: string) {
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)));
  return findingNumberState(settings?.documentNumbering);
}
export async function saveFindingNumbering(organizationId: string, input: FindingNumberPattern) {
  validateFindingNumberPattern(input);
  const pattern = { ...input, codes: Object.fromEntries(numberedFindingTypes.map(type => [type, input.codes[type].trim()])) };
  return db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, organizationId);
    const state = findingNumberState(settings.documentNumbering);
    state.pattern = pattern;
    await tx.update(organizationSettings).set({
      documentNumbering: { ...settings.documentNumbering, audit_finding_numbering: state } as any,
      updatedAt: new Date(),
    }).where(eq(organizationSettings.id, settings.id));
    return state;
  });
}
/** Lock organization settings before the audit; allocation and the finding save share one transaction. */
export async function allocateFindingNumber(
  tx: Tx, settings: typeof organizationSettings.$inferSelect, type: string,
  projectId: string | null, department: string | undefined, fromDate: unknown,
) {
  if (!numberedFindingTypes.includes(type as NumberedFindingType)) {
    throw new HttpError(422, "Select Minor NC, Moderate NC, Major NC or OFI to generate an Audit Finding Number.");
  }
  const source = await planNumberSource(tx, settings.organizationId, projectId, department, "Audit Finding");
  const year = planNumberYear(fromDate, "Audit Finding");
  const state = findingNumberState(settings.documentNumbering);
  validateFindingNumberPattern(state.pattern);
  const { sequence, number } = nextPlanNumber({
    pattern: { ...state.pattern, middle: state.pattern.codes[type] },
    ranges: state.ranges[type] ?? {},
  }, source, year, "Audit Finding");
  // Separate ranges can otherwise collide when Cost Centers or codes change. Retain deleted-audit history too.
  const [duplicate] = await tx.select({ id: audits.id }).from(audits).where(and(
    eq(audits.organizationId, settings.organizationId),
    sql`exists (select 1 from jsonb_array_elements(
      case when jsonb_typeof(${audits.checklistState}) = 'array' then ${audits.checklistState} else '[]'::jsonb end
    ) item where item->>'findingNumber' = ${number})`,
  )).limit(1);
  if (duplicate) throw new HttpError(409, "This Audit Finding Number already exists. Maintain distinct Cost Centers and finding codes, or correct the numbering format; existing numbers will not be overwritten.");
  state.ranges = { ...state.ranges, [type]: {
    ...state.ranges[type], [source.key]: { ...state.ranges[type]?.[source.key], [String(year)]: sequence },
  } };
  await tx.update(organizationSettings).set({
    documentNumbering: { ...settings.documentNumbering, audit_finding_numbering: state } as any,
    updatedAt: new Date(),
  }).where(eq(organizationSettings.id, settings.id));
  return { findingNumber: number, findingNumberScope: source.key, findingNumberYear: year,
    findingNumberSequence: sequence, findingNumberType: type };
}
