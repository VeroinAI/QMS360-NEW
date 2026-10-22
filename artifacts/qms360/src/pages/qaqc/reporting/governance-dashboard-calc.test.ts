import { describe, expect, it } from 'vitest';
import { averagePqi, closure, csatSummary, dailyDisciplines, dash, dashboardDateParams, latestPerProject, qmsStats, scopeRows, submissionStatus } from './governance-dashboard-calc';

const m = (projectId: string, period: string, state: string, pqi?: number) => ({ projectId, period, state, computed: { pqi: pqi === undefined ? undefined : { accumulated: pqi }, metrics: { external_ncr: { accumulatedIssued: 10, accumulatedClosed: 7, open: 3 }, internal_ncr: { accumulatedIssued: 2, accumulatedClosed: 2, open: 0 } } } });

describe('governance dashboard calculations', () => {
  it('bounds the selected reporting month without excluding dated CSAT reports or including older monthly reports', () => {
    expect(dashboardDateParams('2026-10', '', '')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(dashboardDateParams('2028-02', '', '')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(dashboardDateParams('', '2026-10-02', '2026-10-18')).toEqual({ from: '2026-10-02', to: '2026-10-18' });
    expect(dashboardDateParams('', '', '')).toEqual({});
  });
  it('returns null (em dash) for missing data instead of 100%', () => {
    expect(averagePqi([])).toBeNull();
    expect(closure([]).rate).toBeNull();
    expect(closure([]).open).toBeNull();
    expect(csatSummary([]).average).toBeNull();
    expect(dash(null)).toBe('\u2014');
  });
  it('computes closure and open from saved computed fields', () => {
    const c = closure([m('a', '2025-01-01', 'approved', 80)]);
    expect(c.rate).toBeCloseTo(75); expect(c.open).toBe(3);
    expect(closure([m('a', '2025-01-01', 'approved')], ['external_ncr', 'internal_ncr']).open).toBe(3);
  });
  it('averages only finite PQI values', () => {
    expect(averagePqi([m('a', 'x', 's', 80), m('b', 'x', 's'), m('c', 'x', 's', 60)])).toBe(70);
  });
  it('counts monthly submission states', () => {
    const s = submissionStatus([m('a', 'x', 'submitted'), m('b', 'x', 'approved'), m('b', 'y', 'approved')], 5);
    expect(s.reporting).toBe(2); expect(s.submitted).toHaveLength(1); expect(s.approved).toHaveLength(2);
  });
  it('scopes to selected projects', () => {
    expect(scopeRows([m('a', 'x', 's'), m('b', 'x', 's')], new Set(['b']))).toHaveLength(1);
    expect(scopeRows(undefined, null)).toEqual([]);
  });
  it('never sums daily snapshots across days', () => {
    const d = [
      { projectId: 'a', period: '2025-01-01', snapshot: { disciplines: { drawings: { Civil: { approved: 5 } } } } },
      { projectId: 'a', period: '2025-01-02', snapshot: { disciplines: { drawings: { Civil: { approved: 8 } } } } },
      { projectId: 'b', period: '2025-01-01', snapshot: { disciplines: { drawings: { Civil: { approved: 1 } } } } },
    ];
    expect(latestPerProject(d)).toHaveLength(2);
    expect(dailyDisciplines(d).rows[0]!.Approved).toBe(9);
  });
  it('summarizes csat recommendation and qms', () => {
    const c = csatSummary([{ computed: { averageRating: 4 }, data: { recommend: 'Yes', ratings: { quality: 5 } } }, { computed: { averageRating: 3 }, data: { recommend: 'No' } }]);
    expect(c.average).toBe(3.5); expect(c.recommendPct).toBe(50); expect(c.dims[0]!.value).toBe(5); expect(c.dims[1]!.value).toBeNull();
    expect(qmsStats([{ data: { qmsReports: [{ status: 'Approved & Published', type: 'SOP' }] } }]).byStatus['Approved & Published']).toBe(1);
  });
});
