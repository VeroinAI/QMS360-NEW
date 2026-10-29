import { DAILY_DOCUMENT_TYPES, DAILY_STATUSES, DISCIPLINES, ENTITIES, PENDING_STATUSES, subtractReportSnapshot } from "./qaqc-reporting-model";
import { dailyDisciplineSnapshot } from "@workspace/field-controls";

type Bag = Record<string, any>;
export type DashboardReport = { id: string; projectId: string; reportType: string; period: string; state: string; data: Bag; computed: Bag; baseline: Bag };
export const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
export const sum = (rows: any[], select: (row: any) => unknown) => rows.reduce((total, row) => total + number(select(row)), 0);
export const percent = (a: number, b: number, empty: number | null = null) => b ? Math.round(a / b * 10000) / 100 : empty;
export const average = (values: unknown[]): number | null => {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 100) / 100 : null;
};
export function dayBefore(date: string, days = 1) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

/** Convert versioned daily additions before aggregating end-of-day snapshots. */
export function dailyDashboard(reports: DashboardReport[], projects: Bag[], end: string, from: string | null, mode: string) {
  const approved = reports.filter(row => row.reportType === "daily" && row.state === "approved");
  const snapshots: Bag[] = [], pendingSnapshots: Bag[] = [], chosen: DashboardReport[] = [], sources: DashboardReport[] = [];
  const warnings: string[] = [];
  for (const project of projects) {
    const history = approved.filter(row => row.projectId === project.id).sort((a, b) => a.period.localeCompare(b.period));
    const last = history.filter(row => row.period <= end).at(-1);
    if (!last) continue;
    chosen.push(last);
    sources.push(last);
    pendingSnapshots.push({ ...last.data, projectId: project.id, projectName: project.name, reportId: last.id });
    const lastSnapshot = dailyDisciplineSnapshot(last.data, last.baseline);
    if (mode !== "movement") { snapshots.push(lastSnapshot); continue; }
    const start = history.filter(row => row.period <= (from ?? dayBefore(end))).at(-1);
    if (start && start.id !== last.id) sources.push(start);
    // For a single-day movement, the form's saved Yesterday baseline is authoritative.
    const baseline = start ? dailyDisciplineSnapshot(start.data, start.baseline) : (!from && last.period === end ? last.baseline : undefined);
    if (!baseline || !baseline.disciplines) {
      warnings.push(`${project.name}: no approved start snapshot or saved Yesterday baseline; excluded from movement totals.`);
      continue;
    }
    snapshots.push(subtractReportSnapshot(lastSnapshot, baseline));
  }
  const statusBlock = (section: string) => {
    const entries = Object.fromEntries(DAILY_STATUSES.map(status => [
      status, sum(snapshots, data => sum([...DISCIPLINES], discipline => data.disciplines?.[section]?.[discipline]?.[status])),
    ]));
    return { ...entries, total: Object.values(entries).reduce((a, b) => a + b, 0) };
  };
  const drawings = statusBlock("drawings"), submittals = statusBlock("submittals");
  const total = Object.fromEntries([...DAILY_STATUSES, "total"].map(key => [key, drawings[key as keyof typeof drawings] + submittals[key as keyof typeof submittals]]));
  const disciplines = DISCIPLINES.map(name => {
    const values = Object.fromEntries(DAILY_STATUSES.map(status => [status,
      sum(snapshots, row => number(row.disciplines?.drawings?.[name]?.[status]) + number(row.disciplines?.submittals?.[name]?.[status])),
    ]));
    const count = Object.values(values).reduce((a, b) => a + b, 0);
    return { name, ...values, value: mode === "movement" ? count : percent(values.approved, count), total: count };
  });
  const documentNames = [...new Set([...DAILY_DOCUMENT_TYPES, ...snapshots.flatMap(row => Object.keys(row.documentTypes ?? {}))])];
  const documentTotal = sum(snapshots, row => sum(Object.values(row.documentTypes ?? {}), value => value));
  const documentTypes = documentNames.map(name => ({
    name: name === "ITPs" ? "ITP" : name === "Vendors" ? "Vendor Documents" : name,
    value: sum(snapshots, row => row.documentTypes?.[name]),
    share: percent(sum(snapshots, row => row.documentTypes?.[name]), documentTotal),
  })).sort((a, b) => b.value - a.value);
  const revisionNames = [...new Set(snapshots.flatMap(row => ["drawings", "submittals"]
    .flatMap(key => (row.revisions?.[key] ?? []).map((rev: Bag) => String(rev.name).trim().toLowerCase()))))].sort();
  const revisions = revisionNames.map(name => {
    const value = (key: string) => sum(snapshots, row => sum((row.revisions?.[key] ?? [])
      .filter((rev: Bag) => String(rev.name).trim().toLowerCase() === name), rev => rev.value));
    const d = value("drawings"), s = value("submittals");
    return { name, value: d + s, drawings: mode === "movement" ? d : percent(d, total.total),
      submittals: mode === "movement" ? s : percent(s, total.total), drawingCount: d, submittalCount: s };
  });
  const pending = ENTITIES.map(name => {
    const values = Object.fromEntries(["upTo7", "days8To30", "over30"].map(bucket => [bucket,
      sum(pendingSnapshots, row => sum([...PENDING_STATUSES], status => row.pending?.[name]?.[status]?.[bucket])),
    ])) as Record<"upTo7" | "days8To30" | "over30", number>;
    return { name, ...values, value: Object.values(values).reduce((a, b) => a + b, 0) };
  });
  const bottlenecks = pendingSnapshots.map(row => {
    const value = (entity: string) => sum([...PENDING_STATUSES], status => row.pending?.[entity]?.[status]?.over30);
    const client = value("Client"), algihaz = value("Algihaz"), supplier = value("Supplier");
    return { projectId: row.projectId, projectName: row.projectName, reportId: row.reportId,
      client, algihaz, supplier, total: client + algihaz + supplier };
  }).sort((a, b) => b.total - a.total);
  const trend = Array.from({ length: 14 }, (_, i) => {
    const date = dayBefore(end, 13 - i), rows = approved.filter(row => row.period === date);
    const movement = (section: string) => rows.length ? sum(rows, row => sum([...DISCIPLINES], discipline =>
      sum([...DAILY_STATUSES], status => number(dailyDisciplineSnapshot(row.data, row.baseline).disciplines?.[section]?.[discipline]?.[status])
        - number(row.baseline.disciplines?.[section]?.[discipline]?.[status])))) : null;
    return { name: date, value: movement("submittals"), drawings: movement("drawings"), submittals: movement("submittals") };
  });
  return { data: { drawings, submittals, total, disciplines, documentTypes, revisions, pending, bottlenecks, trend,
    correspondence: { incoming: sum(snapshots, row => row.correspondence?.incoming), outgoing: sum(snapshots, row => row.correspondence?.outgoing) },
    selectedReports: snapshots.length, snapshotReports: chosen.length }, chosen, sources, warnings };
}
