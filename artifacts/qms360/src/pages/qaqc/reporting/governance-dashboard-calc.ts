import { CSAT_RATINGS, DISCIPLINES, DISC_STATUSES, METRICS, num, type Obj } from './reporting-types';

// Pure calculations over the authorized dashboard payload. null means "no records", rendered as an em dash.
const finite = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export const dash = (v: number | null, digits = 1, suffix = '') => (v === null ? '\u2014' : `${v.toFixed(digits)}${suffix}`);

export function dashboardDateParams(month: string, from: string, to: string) {
  if (from && to && from <= to) return { from, to };
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [year, m] = month.split('-').map(Number);
    const end = new Date(Date.UTC(year!, m!, 0)).toISOString().slice(0, 10);
    return { from: `${month}-01`, to: end };
  }
  return {};
}

export function scopeRows(rows: Obj[] | undefined, projectIds: Set<string> | null) {
  return (rows ?? []).filter(r => !projectIds || projectIds.has(String(r.projectId)));
}

/** Latest record per project (by period). Daily snapshots are cumulative so they must never be summed across days. */
export function latestPerProject(rows: Obj[]) {
  const m = new Map<string, Obj>();
  for (const r of rows) { const p = m.get(String(r.projectId)); if (!p || String(r.period) > String(p.period)) m.set(String(r.projectId), r); }
  return [...m.values()];
}

export function averagePqi(monthly: Obj[]) {
  const v = monthly.map(r => r.computed?.pqi?.accumulated).filter(finite).map(Number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function averageVariance(monthly: Obj[]) {
  const v = monthly.map(r => r.computed?.pqi?.variance).filter(finite).map(Number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function closure(monthly: Obj[], keys: string[] = METRICS.map(([k]) => k)) {
  let issued = 0, closed = 0, open = 0, seen = false;
  for (const r of monthly) for (const k of keys) { const m = r.computed?.metrics?.[k]; if (!m) continue; seen = true; issued += num(m.accumulatedIssued); closed += num(m.accumulatedClosed); open += num(m.open); }
  return { issued, closed, open: seen ? open : null, rate: seen && issued > 0 ? (closed / issued) * 100 : null };
}

export function categoryRows(monthly: Obj[]) {
  return METRICS.map(([k, label]) => { const c = closure(monthly, [k]); return { key: k, label, issued: c.issued, closed: c.closed, open: c.open ?? 0, rate: c.rate }; });
}

export function csatSummary(csat: Obj[]) {
  const avgs = csat.map(r => r.computed?.averageRating).filter(finite).map(Number);
  const rec = csat.map(r => String(r.data?.recommend ?? '')).filter(Boolean);
  const dims = CSAT_RATINGS.map(([k, label]) => { const v = csat.map(r => r.data?.ratings?.[k]).filter(finite).map(Number); return { key: k, label, value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; });
  const counts = { Yes: 0, No: 0, Partially: 0 } as Record<string, number>;
  for (const r of rec) if (r in counts) counts[r]! += 1;
  return { responses: csat.length, average: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null, recommendPct: rec.length ? (counts.Yes! / rec.length) * 100 : null, recommend: counts, dims };
}

export function submissionStatus(monthly: Obj[], visibleProjects: number) {
  const reporting = new Set(monthly.map(r => String(r.projectId)));
  return {
    visibleProjects, reporting: reporting.size,
    submitted: monthly.filter(r => r.state === 'submitted'), approved: monthly.filter(r => r.state === 'approved'),
  };
}

const DOC_FIELDS: [string, string][] = [['approved', 'Approved'], ['resubmitted', 'Resubmitted'], ['rejected', 'Rejected'], ['underReview', 'Under review']];
export function monthlyDocuments(monthly: Obj[]) {
  const has = monthly.some(r => r.data?.documents);
  return { has, rows: DOC_FIELDS.map(([f, label]) => ({ label, drawings: monthly.reduce((a, r) => a + num(r.data?.documents?.drawings?.[f]), 0), submittals: monthly.reduce((a, r) => a + num(r.data?.documents?.submittals?.[f]), 0) })) };
}

export function qmsStats(monthly: Obj[]) {
  const rows: Obj[] = monthly.flatMap(r => (Array.isArray(r.data?.qmsReports) ? r.data.qmsReports : []));
  const byStatus: Record<string, number> = {}; const byType: Record<string, number> = {};
  for (const r of rows) { const s = String(r.status || 'Unspecified'); const t = String(r.type || 'Unspecified'); byStatus[s] = (byStatus[s] ?? 0) + 1; byType[t] = (byType[t] ?? 0) + 1; }
  return { total: rows.length, byStatus, byType };
}

export function auditStats(monthly: Obj[]) {
  const a = monthly.map(r => ({ r, a: r.data?.internalAudit })).filter(x => x.a && typeof x.a === 'object');
  const today = new Date().toISOString().slice(0, 10);
  return {
    reported: a.length, conducted: a.filter(x => x.a.conducted === true).length,
    upcoming: a.filter(x => x.a.nextDate && String(x.a.nextDate) >= today).sort((p, q) => String(p.a.nextDate).localeCompare(String(q.a.nextDate))).map(x => ({ report: x.r, lastDate: x.a.lastDate as string | undefined, nextDate: String(x.a.nextDate) })),
    overdueNext: a.filter(x => x.a.nextDate && String(x.a.nextDate) < today).length,
  };
}

/** Sum across projects of each project's single latest daily record (snapshot, or movement when the endpoint supplies it). */
export function dailyDisciplines(daily: Obj[]) {
  const latest = latestPerProject(daily);
  const val = (r: Obj): Obj => (r.movement && !r.absoluteSnapshot ? r.movement : r.snapshot) ?? {};
  return {
    projects: latest.length, movement: latest.some(r => r.movement && !r.absoluteSnapshot),
    rows: DISCIPLINES.map(d => {
      const row: Obj = { discipline: d };
      for (const [s, l] of DISC_STATUSES) row[l] = latest.reduce((a, r) => a + num(val(r).disciplines?.drawings?.[d]?.[s]) + num(val(r).disciplines?.submittals?.[d]?.[s]), 0);
      return row;
    }),
    pending: latest.reduce((a, r) => a + Object.values(val(r).pendingTotals ?? {}).reduce<number>((x, y) => x + num(y), 0), 0),
  };
}
