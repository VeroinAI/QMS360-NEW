type MonthlySnapshot = {
  projectId: string;
  computed: Record<string, unknown>;
};

/** Call only with same-month, submitted/approved, authorized report snapshots. */
export function monthlyDownloadAverage(reports: readonly MonthlySnapshot[]) {
  const projects = new Map(reports.map(report => [report.projectId, report]));
  const projectCount = projects.size;
  let sum = 0;
  for (const report of projects.values()) {
    const pqi = report.computed.pqi;
    const value = pqi && typeof pqi === "object" && !Array.isArray(pqi)
      ? (pqi as Record<string, unknown>).accumulated : undefined;
    // Do not invent a score, or silently exclude a reported project, for legacy gaps.
    if (typeof value !== "number" || !Number.isFinite(value)) return { average: null, projectCount };
    sum += value;
  }
  return { average: projectCount ? sum / projectCount : null, projectCount };
}
