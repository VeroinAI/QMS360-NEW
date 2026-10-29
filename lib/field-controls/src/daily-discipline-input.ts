/** Unmarked historical records keep their original cumulative-entry meaning. */
export const DAILY_ADDITIONS = "daily_additions_v1";
export type DailyData = Record<string, any>;
export function usesDailyAdditions(data: DailyData) {
  return data.dailyDisciplineInputMode === DAILY_ADDITIONS;
}

/** Convert daily discipline inputs to an end-of-day snapshot, once.
 * Other sections (ageing, pending, correspondence, revisions) remain snapshots.
 * Always pass raw saved input plus its Yesterday baseline, never a prior result.
 */
export function dailyDisciplineSnapshot(data: DailyData, baseline: DailyData = {}): DailyData {
  if (!usesDailyAdditions(data)) return data;
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
  const { dailyDisciplineInputMode: _inputMode, ...snapshot } = data;
  return { ...snapshot, disciplines };
}
