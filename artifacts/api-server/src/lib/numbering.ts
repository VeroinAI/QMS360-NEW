import { and, eq, isNull, sql } from "drizzle-orm";
import { db, organizationSettings, lessonLearnedForms } from "@workspace/db";
import { resolveReferencePrefix, type LessonNumberContext } from "@workspace/field-controls";

/**
 * Per-module reference numbering. Lessons share a pattern but use independent
 * projectCounters; legacy Lessons nextNumber is retained but no longer allocated.
 * QA/QC and Audit retain organization-level counters. Patterns live in
 * shared.organization_settings.document_numbering keyed by module ("qaqc",
 * "lessons", "audit"). Allocation is serialized by a SELECT ... FOR UPDATE on
 * the org's settings row inside a transaction, so concurrent creators can never
 * receive the same running number; call sites additionally retry on the
 * applicable unique index to stay safe against legacy/manual duplicates.
 *
 * Stored entries carry a `custom` flag distinguishing an admin-configured
 * pattern from one the allocator persisted only to keep the counter running.
 * The `nextNumber` counter is monotonic: editing a pattern keeps the counter
 * once numbers have been issued (`startingNumber` only seeds an unused
 * pattern), and reset rewrites the entry to the module default while carrying
 * the counter over — deleting the entry would restart numbering and reissue
 * references that already exist.
 */

export type NumberingModule = "qaqc" | "lessons" | "audit";
export type NumberingPosition = "after_prefix" | "after_suffix" | "before_prefix";

export interface NumberingPattern {
  prefix: string;
  suffix: string;
  separator: string;
  position: NumberingPosition;
  padding: number;
  startingNumber: number;
  nextNumber: number;
}

export type NumberingPatternInput = Omit<NumberingPattern, "nextNumber">;
export type LessonProjectCounter = { startingNumber: number; nextNumber: number; lastIssued: number | null; configured: boolean };
type StoredNumbering = NumberingPattern & { custom?: boolean; projectCounters?: Record<string, LessonProjectCounter> };
export type NumberingMap = Record<string, StoredNumbering>;

export const NUMBERING_MODULES: NumberingModule[] = ["qaqc", "lessons", "audit"];

export const DEFAULT_PATTERNS: Record<NumberingModule, NumberingPatternInput> = {
  qaqc: { prefix: "QC", suffix: "", separator: "-", position: "after_prefix", padding: 4, startingNumber: 1 },
  lessons: { prefix: "LL", suffix: "", separator: "-", position: "after_prefix", padding: 4, startingNumber: 1 },
  audit: { prefix: "AUD", suffix: "", separator: "-", position: "after_prefix", padding: 4, startingNumber: 1 },
};

export function formatReferenceNumber(pattern: NumberingPatternInput, n: number): string {
  const running = String(n).padStart(pattern.padding, "0");
  const parts = pattern.position === "before_prefix"
    ? [running, pattern.prefix, pattern.suffix]
    : pattern.position === "after_suffix"
      ? [pattern.prefix, pattern.suffix, running]
      : [pattern.prefix, running, pattern.suffix];
  return parts.filter((part) => part !== "").join(pattern.separator);
}

/** The stored pattern for a module, or the module default when unconfigured. */
export function effectivePattern(map: NumberingMap, module: NumberingModule): NumberingPattern {
  const stored = map[module];
  if (stored) {
    const { prefix, suffix, separator, position, padding, startingNumber, nextNumber } = stored;
    return { prefix, suffix, separator, position, padding, startingNumber, nextNumber };
  }
  const fallback = DEFAULT_PATTERNS[module];
  return { ...fallback, nextNumber: fallback.startingNumber };
}

/** True only when an admin explicitly saved a pattern — not when the allocator merely persisted a counter for the default. */
export function isConfigured(map: NumberingMap, module: NumberingModule): boolean {
  return map[module]?.custom === true;
}

export async function getNumberingMap(organizationId: string): Promise<NumberingMap> {
  const [row] = await db.select({ documentNumbering: organizationSettings.documentNumbering })
    .from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)))
    .limit(1);
  return (row?.documentNumbering ?? {}) as NumberingMap;
}

/** True when an admin has explicitly configured a pattern for this module. */
export async function hasNumberingPattern(organizationId: string, module: NumberingModule): Promise<boolean> {
  return isConfigured(await getNumberingMap(organizationId), module);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Inserts the org settings row when missing, then returns it under FOR UPDATE.
 * INSERT ... ON CONFLICT DO NOTHING is used because a caught unique violation
 * would abort the surrounding transaction in PostgreSQL, breaking the lock.
 */
async function ensureSettingsRow(tx: Tx, organizationId: string) {
  await tx.insert(organizationSettings).values({ organizationId }).onConflictDoNothing();
  const [row] = await tx.select().from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)))
    .for("update").limit(1);
  if (!row) throw new Error("Unable to initialize organization settings for numbering");
  return row;
}

/**
 * Atomically allocates and returns the next reference number for the module,
 * advancing the stored counter. Creates the org settings row when missing.
 */
export async function allocateReferenceNumber(organizationId: string, module: NumberingModule, context?: LessonNumberContext, projectId?: string): Promise<string> {
  if (module === "lessons" && !projectId) throw new LessonProjectNumberingError("A project is required for Lessons Learned numbering.");
  return db.transaction(async (tx) => {
    const row = await ensureSettingsRow(tx, organizationId);
    const map = { ...((row.documentNumbering ?? {}) as NumberingMap) };
    const existing = map[module];
    const pattern = effectivePattern(map, module);
    // Resolve before incrementing: missing master values never consume a number.
    const resolved = module === "lessons" ? { ...pattern, prefix: resolveReferencePrefix(pattern.prefix, context) } : pattern;
    const counter = module === "lessons" ? lessonProjectCounter(map, projectId!) : undefined;
    const issued = counter
      ? await availableLessonNumber(tx, organizationId, projectId!, resolved, counter.nextNumber)
      : pattern.nextNumber;
    if (counter && (!Number.isSafeInteger(issued + 1) || issued >= MAX_LESSON_NUMBER)) throw new LessonProjectNumberingError("The project number range is exhausted.");
    map[module] = counter
      ? { ...pattern, custom: existing?.custom, projectCounters: {
        ...existing?.projectCounters, [projectId!]: { ...counter, nextNumber: issued + 1, lastIssued: issued },
      } }
      : { ...pattern, custom: existing?.custom, nextNumber: issued + 1 };
    await tx.update(organizationSettings)
      .set({ documentNumbering: map, updatedAt: new Date() })
      .where(eq(organizationSettings.id, row.id));
    return formatReferenceNumber(resolved, issued);
  });
}

export const MAX_LESSON_NUMBER = 1_000_000_000_000;
export class LessonProjectNumberingError extends Error {}

export function lessonProjectCounter(map: NumberingMap, projectId: string): LessonProjectCounter {
  return map.lessons?.projectCounters?.[projectId] ?? { startingNumber: 1, nextNumber: 1, lastIssued: null, configured: false };
}

/** Read-only collision protection preserves historical references, including deleted forms. */
export async function availableLessonNumber(query: Pick<Tx, "select" | "execute">, organizationId: string, projectId: string, pattern: NumberingPatternInput, next: number): Promise<number> {
  const [collision] = await query.select({ id: lessonLearnedForms.id }).from(lessonLearnedForms).where(and(
    eq(lessonLearnedForms.organizationId, organizationId), eq(lessonLearnedForms.projectId, projectId),
    eq(lessonLearnedForms.referenceNumber, formatReferenceNumber(pattern, next)),
  )).limit(1);
  if (!collision) return next;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const running = "([0-9]+)";
  const parts = pattern.position === "before_prefix" ? [running, escape(pattern.prefix), escape(pattern.suffix)]
    : pattern.position === "after_suffix" ? [escape(pattern.prefix), escape(pattern.suffix), running]
    : [escape(pattern.prefix), running, escape(pattern.suffix)];
  const regex = `^${parts.filter(Boolean).join(escape(pattern.separator))}$`;
  const result = await query.execute(sql`SELECT MAX((substring(reference_number FROM ${regex}))::numeric) AS highest
    FROM app2_lessons.lesson_learned_forms WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectId}::uuid
    AND reference_number ~ ${regex}`);
  const highest = Number(result.rows[0]?.highest ?? 0);
  if (!Number.isSafeInteger(highest) || highest >= MAX_LESSON_NUMBER) throw new LessonProjectNumberingError("The project number range is exhausted.");
  return Math.max(next, highest + 1);
}

export async function saveLessonProjectCounter(organizationId: string, projectId: string, nextNumber: number): Promise<LessonProjectCounter> {
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber >= MAX_LESSON_NUMBER) {
    throw new LessonProjectNumberingError("Enter a whole next number between 1 and 999999999999.");
  }
  return db.transaction(async tx => {
    const row = await ensureSettingsRow(tx, organizationId);
    const map = { ...((row.documentNumbering ?? {}) as NumberingMap) };
    const current = lessonProjectCounter(map, projectId);
    if (current.lastIssued !== null && nextNumber <= current.lastIssued) {
      throw new LessonProjectNumberingError(`The next number must be greater than the last issued number (${current.lastIssued}). Existing references cannot be reused.`);
    }
    const counter = { ...current, startingNumber: current.lastIssued === null ? nextNumber : current.startingNumber, nextNumber, configured: true };
    map.lessons = { ...effectivePattern(map, "lessons"), custom: map.lessons?.custom,
      projectCounters: { ...map.lessons?.projectCounters, [projectId]: counter } };
    await tx.update(organizationSettings).set({ documentNumbering: map, updatedAt: new Date() }).where(eq(organizationSettings.id, row.id));
    return counter;
  });
}

/** Persists an admin-edited pattern, preserving the counter once numbers were issued. */
export async function saveNumberingPattern(
  organizationId: string, module: NumberingModule, input: NumberingPatternInput,
): Promise<NumberingPattern> {
  return db.transaction(async (tx) => {
    const row = await ensureSettingsRow(tx, organizationId);
    const map = { ...((row.documentNumbering ?? {}) as NumberingMap) };
    const existing = map[module];
    // Once numbers have been issued the counter keeps running untouched;
    // startingNumber only seeds a pattern that has never been used.
    const issuedBefore = existing && existing.nextNumber > existing.startingNumber;
    const nextNumber = issuedBefore ? existing.nextNumber : input.startingNumber;
    // Keep the original seed after issuance, otherwise increasing startingNumber
    // can make a used counter look unused on a later edit.
    const pattern: NumberingPattern = { ...input, startingNumber: issuedBefore ? existing.startingNumber : input.startingNumber, nextNumber };
    map[module] = { ...pattern, custom: true, ...(module === "lessons" ? { projectCounters: existing?.projectCounters } : {}) };
    await tx.update(organizationSettings)
      .set({ documentNumbering: map, updatedAt: new Date() })
      .where(eq(organizationSettings.id, row.id));
    return pattern;
  });
}

/**
 * Restores the module default under the same row lock as allocation. The
 * counter carries over so a reset can never reissue an existing reference.
 */
export async function resetNumberingPattern(organizationId: string, module: NumberingModule): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(organizationSettings)
      .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt)))
      .for("update").limit(1);
    if (!row) return;
    const map = { ...((row.documentNumbering ?? {}) as NumberingMap) };
    const existing = map[module];
    if (!existing?.custom) return;
    const fallback = DEFAULT_PATTERNS[module];
    map[module] = { ...fallback, custom: false, nextNumber: Math.max(existing.nextNumber, fallback.startingNumber),
      ...(module === "lessons" ? { projectCounters: existing.projectCounters } : {}) };
    await tx.update(organizationSettings)
      .set({ documentNumbering: map, updatedAt: new Date() })
      .where(eq(organizationSettings.id, row.id));
  });
}
