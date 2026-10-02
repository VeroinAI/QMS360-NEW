import { describe, expect, it } from 'vitest';
import { normaliseMetricsEntry, validateMetricsEntry } from './metrics-entry-validation';
import { calcMonthly, type Obj } from './reporting-types';

const valid = (): Obj => ({
  pqpStatus: 'Under Preparation',
  internalAudit: { conducted: false, lastDate: '2026-08-10', nextDate: '2026-11-10' },
  manpower: [{ department: 'Quality', count: 5, approvalRequired: false }],
  meetings: [],
});

describe('six-section QA/QC Metrics entry', () => {
  it('accepts exactly the six-section payload without requiring unrelated report fields', () => {
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