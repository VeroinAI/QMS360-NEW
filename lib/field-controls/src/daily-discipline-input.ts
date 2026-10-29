/** Unmarked historical records keep their original cumulative-entry meaning. */
export const DAILY_ADDITIONS = "daily_additions_v1";
export const DAILY_SUPPLEMENT_ADDITIONS = "daily_supplement_additions_v1";
export type DailyData = Record<string, any>;
export function usesDailyAdditions(data: DailyData) {
  return data.dailyDisciplineInputMode === DAILY_ADDITIONS;
}
export function usesDailySupplementAdditions(data: DailyData) {
  return data.dailySupplementInputMode === DAILY_SUPPLEMENT_ADDITIONS;
}

function accumulateCounts(current: DailyData = {}, previous: DailyData = {}): DailyData {
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(current)])].map(key => [
    key, typeof current[key] === "number" && Number.isFinite(current[key])
      ? current[key] + (typeof previous[key] === "number" && Number.isFinite(previous[key]) ? previous[key] : 0)
      : Object.hasOwn(current, key) ? current[key] : previous[key],
  ]));
}
const revisionName = (value: unknown) => String(value ?? "").trim().toLowerCase();

function accumulateRevisions(current: DailyData = {}, previous: DailyData = {}): DailyData {
  return Object.fromEntries(["drawings", "submittals"].map(category => {
    const rows: DailyData[] = current[category] ?? [];
    const prior: DailyData[] = previous[category] ?? [];
    const byName = new Map(prior.map(row => [revisionName(row.name), row]));
    const entered = new Set(rows.map(row => revisionName(row.name)));
    return [category, [
      ...rows.map(row => ({ ...row, ...accumulateCounts({ value: row.value }, { value: byName.get(revisionName(row.name))?.value }) })),
      ...prior.filter(row => !entered.has(revisionName(row.name))).map(row => ({ ...row })),
    ]];
  }));
}

/** Convert versioned daily inputs to an end-of-day snapshot, once.
 * Pending/ageing and unversioned sections retain snapshot semantics.
 * Always pass raw saved input plus its Yesterday baseline, never a prior result.
 */
export function dailyDisciplineSnapshot(data: DailyData, baseline: DailyData = {}): DailyData {
  if (!usesDailyAdditions(data) && !usesDailySupplementAdditions(data)) return data;
  const disciplines: DailyData = {};
  for (const category of ["drawings", "submittals"]) {
    disciplines[category] = {};
    for (const name of new Set([...Object.keys(baseline.disciplines?.[category] ?? {}), ...Object.keys(data.disciplines?.[category] ?? {})])) {
      disciplines[category][name] = {};
      for (const status of ["approved", "resubmit", "rejected", "underReview"]) {
        const current = data.disciplines?.[category]?.[name]?.[status];
        const previous = baseline.disciplines?.[category]?.[name]?.[status];
        disciplines[category][name][status] = typeof current === "number" && Number.isFinite(current)
          ? current + (typeof previous === "number" && Number.isFinite(previous) ? previous : 0)
          : current;
      }
    }
  }
  const supplement = usesDailySupplementAdditions(data) ? {
    documentTypes: accumulateCounts(data.documentTypes, baseline.documentTypes),
    correspondence: accumulateCounts(data.correspondence, baseline.correspondence),
    rejectedSubmissions: accumulateCounts(data.rejectedSubmissions, baseline.rejectedSubmissions),
    revisions: accumulateRevisions(data.revisions, baseline.revisions),
  } : {};
  const { dailyDisciplineInputMode: _inputMode, dailySupplementInputMode: _supplementMode, ...snapshot } = data;
  return { ...snapshot, ...(usesDailyAdditions(data) ? { disciplines } : {}), ...supplement };
}
