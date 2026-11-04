/** Read-only consolidated dashboard contract. Null means unavailable, not zero. */
export type Point = { name: string; value: number | null; [key: string]: unknown };
export type ProjectOption = { id: string; name: string; code: string; sbg: string; bu: string; projectGroup: string; costCentre: string };
export type DashboardRecord = { id: string; projectId: string; projectName: string; type: string; period: string; title: string; href: string; state: string; category?: string; impact?: string; snapshot?: boolean };
export type ProjectScore = { projectId: string; projectName: string; bu: string; costCentre: string; reportId: string | null; pqi: number | null; target: number | null; closure: number | null; openNcr: number | null; over45: number | null; csat: number | null; responses: number; negativeLessons: number | null; escalatedLessons: number | null; openNc: number | null; overdueCars: number | null; plannedAudits: number | null; conductedAudits: number | null; escalation: string; monthsBelow: number };
export type MonthlyDashboard = {
  quality: { pqi: number | null; variance: number | null; target: number | null; closure: number | null; issued: number; closed: number; openNcr: number | null; externalOpen: number; internalOpen: number; over45: number; categories: Point[]; ageing: Point[]; documents: Point[] };
  csat: { average: number | null; responses: number; recommend: number | null; yes: number; lowest: Point | null; ratings: Point[]; outcomes: Point[] };
  lessons: { available: boolean; logged: number | null; positive: number; negative: number; repeated: number | null; repeatedCount: number; escalated: number | null; levels: Point[]; trend: Point[]; severity: Point[] };
  audit: { available: boolean; planned: number | null; conducted: number | null; conductedRate: number | null; openNc: number | null; major: number; minor: number; overdue: number | null; escalated: number | null; trend: Point[]; cars: Point[] };
  scorecard: ProjectScore[];
};
export type DailyDashboard = {
  submittals: Record<string, number>; drawings: Record<string, number>; total: Record<string, number>;
  correspondence: { incoming: number; outgoing: number };
  disciplines: Point[]; documentTypes: Point[]; revisions: Point[]; pending: Point[];
  bottlenecks: Array<{ projectId: string; projectName: string; client: number; algihaz: number; supplier: number; total: number; reportId: string }>;
  trend: Point[]; selectedReports: number; snapshotReports?: number;
};
export type DashboardData = {
  view: "monthly" | "daily"; period: string; mode: "cumulative" | "movement"; from: string | null; to: string | null;
  projects: ProjectOption[]; periods: string[];
  coverage: { total: number; approved: number; pendingSubmission: number; pendingApproval: number; excluded: number };
  monthly: MonthlyDashboard; daily: DailyDashboard;
  records: DashboardRecord[]; warnings: string[];
};
