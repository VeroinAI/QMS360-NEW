export type PortfolioPqiStatus = "complete" | "pending" | "empty";

export type PortfolioPqi = {
  average: number | null;
  activeProjectCount: number;
  reportedProjectCount: number;
  pendingProjectCount: number;
  status: PortfolioPqiStatus;
  period: string;
};

type PortfolioProject = {
  id: string;
  organizationId?: string;
  status?: string | null;
  deletedAt?: unknown;
};

type PortfolioReport = {
  id?: string;
  organizationId: string;
  projectId: string;
  reportType: string;
  period: string;
  state: string;
  deletedAt?: unknown;
  computed?: unknown;
  createdAt?: string | Date | null;
};

function snapshotPqi(report: PortfolioReport): number | null {
  if (!report.computed || typeof report.computed !== "object" || Array.isArray(report.computed)) return null;
  const pqi = (report.computed as Record<string, unknown>).pqi;
  if (!pqi || typeof pqi !== "object" || Array.isArray(pqi)) return null;
  const accumulated = (pqi as Record<string, unknown>).accumulated;
  return typeof accumulated === "number" && Number.isFinite(accumulated) && accumulated >= 0 && accumulated <= 100 ? accumulated : null;
}

function timestamp(report: PortfolioReport): number {
  if (report.createdAt instanceof Date) return report.createdAt.getTime();
  if (typeof report.createdAt === "string") {
    const parsed = Date.parse(report.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function calculatePortfolioPqi(input: {
  organizationId: string;
  period: string;
  projects: readonly PortfolioProject[];
  reports: readonly PortfolioReport[];
  canReadReport?: (report: PortfolioReport) => boolean;
}): PortfolioPqi {
  const activeProjectIds = new Set(
    input.projects
      .filter((project) =>
        (!project.organizationId || project.organizationId === input.organizationId) &&
        (project.status == null || project.status === "active") && project.deletedAt == null,
      )
      .map((project) => project.id),
  );
  const newestByProject = new Map<string, PortfolioReport>();

  for (const report of input.reports) {
    if (
      report.organizationId !== input.organizationId ||
      !activeProjectIds.has(report.projectId) ||
      report.reportType !== "monthly" ||
      report.period !== input.period ||
      (report.state !== "submitted" && report.state !== "approved") ||
      report.deletedAt != null ||
      (input.canReadReport && !input.canReadReport(report))
    ) continue;

    const previous = newestByProject.get(report.projectId);
    if (
      !previous ||
      timestamp(report) > timestamp(previous) ||
      (timestamp(report) === timestamp(previous) && String(report.id ?? "") > String(previous.id ?? ""))
    ) newestByProject.set(report.projectId, report);
  }

  const reportedPqi = [...newestByProject.values()]
    .map(snapshotPqi)
    .filter((pqi): pqi is number => pqi !== null);
  const activeProjectCount = activeProjectIds.size;
  const reportedProjectCount = reportedPqi.length;
  const pendingProjectCount = activeProjectCount - reportedProjectCount;
  const average = pendingProjectCount === 0 && reportedProjectCount > 0
    ? reportedPqi.reduce((sum, pqi) => sum + pqi, 0) / reportedProjectCount
    : null;

  return {
    average,
    activeProjectCount,
    reportedProjectCount,
    pendingProjectCount,
    status: activeProjectCount === 0 ? "empty" : pendingProjectCount === 0 ? "complete" : "pending",
    period: input.period,
  };
}