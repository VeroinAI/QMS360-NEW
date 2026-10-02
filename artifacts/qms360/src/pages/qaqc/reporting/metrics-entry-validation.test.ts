import { describe, expect, it } from 'vitest';
import { normaliseMetricsEntry, validateMetricsEntry } from './metrics-entry-validation';
import { METRICS, calcMonthly, type Obj } from './reporting-types';

const valid = (): Obj => ({
  pqpStatus: 'Under Preparation',
  internalAudit: { conducted: false, lastDate: '2026-08-10', nextDate: '2026-11-10' },
  manpower: [{ department: 'Quality', count: 5, approvalRequired: false }],
  meetings: [],
  metrics: Object.fromEntries(METRICS.map(([key]) => [key, { issued: 0, closed: 0, ageing: [] }])),
  material: { issued: 0, closed: 0, osdAvailable: false },
  qtbt: { talkCount: 0 },
  documents: Object.fromEntries(['drawings', 'submittals'].map(key => [key, { approved: 0, resubmitted: 0, rejected: 0, underReview: 0, clientReviewDays: 0, internalReviewDays: 0 }])),
  narrative: 'Monthly quality assessment reviewed.',
});

describe('thirteen-section QA/QC Metrics entry', () => {
  it('accepts all entry fields without requiring submission confirmation on a draft', () => {
    expect(validateMetricsEntry(valid())).toEqual([]);
  });
  it('requires the other PQP status and approval date only when applicable', () => {
    expect(validateMetricsEntry({ ...valid(), pqpStatus: 'Others' })).toContain('Describe the other PQP status.');
    expect(validateMetricsEntry({ ...valid(), pqpStatus: 'Approved B' })).toContain('PQP Approval Date is required.');
    expect(validateMetricsEntry({ ...valid(), pqpStatus: 'Under Review with Client' })).toEqual([]);
  });
  it('removes disabled dates from the payload without changing the client form or unrelated data', () => {
    const data = { ...valid(), pqpSubmittedDate: '2026-09-01', pqpApprovedDate: '2026-09-02', metrics: { rfi: { issued: 7 } } };
    const out = normaliseMetricsEntry(data);
    expect(out.pqpSubmittedDate).toBe('');
    expect(out.pqpApprovedDate).toBe('');
    expect(data.pqpSubmittedDate).toBe('2026-09-01');
    expect(out.metrics).toEqual(data.metrics);
    expect(out.manpowerDepartmentInput).toBe('text');
  });
  it('requires both reference dates and rejects reversed or invalid dates', () => {
    expect(validateMetricsEntry({ ...valid(), reportReference: 'CLIENT-1' })).toEqual(expect.arrayContaining(['Report Date (from) is required.', 'Report Date (To) is required.']));
    expect(validateMetricsEntry({ ...valid(), reportFrom: '2026-09-20', reportTo: '2026-09-01' }).join(' ')).toContain('must not be after');
    expect(validateMetricsEntry({ ...valid(), reportFrom: '2026-02-30' }).join(' ')).toContain('must be a valid date');
  });
  it('requires meeting dates when selected but allows no meetings', () => {
    expect(validateMetricsEntry({ ...valid(), meetings: [{ type: 'Internal Meeting' }] })).toHaveLength(2);
    expect(validateMetricsEntry({ ...valid(), meetings: [{ type: 'Internal Meeting', lastDate: '2026-09-01', nextDate: '2026-09-02' }] })).toEqual([]);
  });
  it('requires both internal audit dates for either Yes or No', () => {
    expect(validateMetricsEntry({ ...valid(), internalAudit: { conducted: false } })).toHaveLength(2);
    expect(validateMetricsEntry({ ...valid(), internalAudit: { conducted: true } })).toHaveLength(2);
  });
  it('requires manpower department, positive integer Nos, and an explicit approval choice', () => {
    expect(validateMetricsEntry({ ...valid(), manpower: [] })).toHaveLength(1);
    expect(validateMetricsEntry({ ...valid(), manpower: [{ department: ' ', count: 0.5 }] })).toHaveLength(3);
  });
  it('accepts zero approval/rejection counts, rejects missing/negative or excess counts', () => {
    const row = { department: 'QC', count: 2, approvalRequired: true };
    expect(validateMetricsEntry({ ...valid(), manpower: [row] })).toHaveLength(2);
    expect(validateMetricsEntry({ ...valid(), manpower: [{ ...row, approved: 0, rejected: 0 }] })).toEqual([]);
    expect(validateMetricsEntry({ ...valid(), manpower: [{ ...row, approved: -1, rejected: 0 }] })).toHaveLength(1);
    expect(validateMetricsEntry({ ...valid(), manpower: [{ ...row, approved: 2, rejected: 1 }] })).toHaveLength(1);
  });
  it('retains the shared calculated manpower sum for multiple departments', () => {
    expect(calcMonthly({ ...valid(), manpower: [{ count: 4 }, { count: 7 }] }, {}).manpower.total).toBe(11);
  });
});

describe('QA/QC Metric Details', () => {
  it.each(METRICS)('requires both nonnegative integer counts for %s', (key, label) => {
    const data = valid();
    for (const bad of [undefined, '', -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      data.metrics[key] = { issued: bad, closed: 0 };
      expect(validateMetricsEntry(data).join(' ')).toContain(`${label}: Issued this Month`);
      data.metrics[key] = { issued: 0, closed: bad };
      expect(validateMetricsEntry(data).join(' ')).toContain(`${label}: Closed this Month`);
    }
  });
  it('accepts zero counts and calculates all three zero/zero rates as 100 percent', () => {
    const data = valid();
    expect(validateMetricsEntry(data)).toEqual([]);
    for (const [key] of METRICS) {
      expect(calcMonthly(data, {}).metrics[key]).toMatchObject({
        prevIssued: 0, prevClosed: 0, accIssued: 0, accClosed: 0, open: 0,
        monthlyRate: 100, prevRate: 100, accRate: 100, variance: 0,
      });
    }
  });
  it('carries forward submitted totals and calculates closure, open count and signed variance', () => {
    const baseline = { metrics: { external_ncr: { accumulatedIssued: 10, accumulatedClosed: 5 } } };
    const data = valid();
    data.metrics.external_ncr = {
      issued: 5, closed: 4,
      ageing: [{ department: 'Quality', bucket: '0-15', count: 2 }, { department: 'Quality', bucket: 'over45', count: 4 }],
    };
    expect(validateMetricsEntry(data, baseline)).toEqual([]);
    expect(calcMonthly(data, baseline).metrics.external_ncr).toMatchObject({
      prevIssued: 10, prevClosed: 5, accIssued: 15, accClosed: 9, open: 6,
      monthlyRate: 80, prevRate: 50, accRate: 60, variance: 10, ageSum: 6,
    });
    expect(data.metrics.external_ncr).not.toHaveProperty('accIssued');
  });
  it('retains the existing guard against closing already-closed backlog', () => {
    const data = valid();
    const baseline = { metrics: { rfi: { accumulatedIssued: 10, accumulatedClosed: 8 } } };
    data.metrics.rfi = { issued: 2, closed: 5 };
    expect(validateMetricsEntry(data, baseline).join(' ')).toContain('RFI: Closed this Month cannot exceed');
    data.metrics.rfi.closed = 4;
    expect(validateMetricsEntry(data, baseline)).toEqual([]);
  });
  it.each(['external_ncr', 'internal_ncr'])('validates %s ageing fields and matching totals', key => {
    const data = valid();
    data.metrics[key] = { issued: 3, closed: 1, ageing: [] };
    expect(validateMetricsEntry(data).join(' ')).toContain('must equal Open NCRs (2)');
    data.metrics[key].ageing = [{ department: '', bucket: 'invalid', count: 0 }];
    expect(validateMetricsEntry(data)).toHaveLength(3);
    data.metrics[key].ageing = [{ department: 'Quality', bucket: '15-45', count: 2 }];
    expect(validateMetricsEntry(data)).toEqual([]);
    data.metrics[key].ageing[0].count = 1.5;
    expect(validateMetricsEntry(data).join(' ')).toContain('integer greater than zero');
  });
  it('requires ageing only for NCR categories, not RFI or RMI', () => {
    const data = valid();
    data.metrics.rfi = { issued: 10, closed: 3 };
    data.metrics.rmi = { issued: 2, closed: 1 };
    expect(validateMetricsEntry(data)).toEqual([]);
    expect(calcMonthly(data, {}).metrics.rfi.variance).toBe(-70);
  });
  it('preserves metric inputs, ageing rows and unrelated report fields when preparing a save', () => {
    const data = { ...valid(), material: { issued: 9 }, narrative: 'Keep this report content' };
    data.metrics.external_ncr.ageing = [{ department: 'Quality', bucket: 'over45', count: 3 }];
    const cleaned = normaliseMetricsEntry(data);
    expect(cleaned.metrics).toEqual(data.metrics);
    expect(cleaned.material).toMatchObject(data.material);
    expect(cleaned.narrative).toBe(data.narrative);
  });
});