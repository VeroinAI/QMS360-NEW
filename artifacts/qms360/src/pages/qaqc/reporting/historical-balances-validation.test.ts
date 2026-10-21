import { describe, expect, it } from 'vitest';
import { historicalOps, monthToPeriod, validateBalances, reasonError } from './historical-balances-validation';

const fields = [
  { key: 'ncrIssued', label: 'NCR issued', unit: 'count' },
  { key: 'ncrClosed', label: 'NCR closed', unit: 'count' },
  { key: 'manHours', label: 'Man hours', unit: 'hours' },
];

describe('historical balance validation', () => {
  it('requires every field and never treats blank as zero', () => {
    const r = validateBalances(fields, { ncrIssued: '', ncrClosed: '0', manHours: '1.5' });
    expect(r.valid).toBe(false);
    expect(r.errors.ncrIssued).toMatch(/Required/);
    expect(r.values.ncrIssued).toBeUndefined();
  });
  it('rejects negatives, non-integer counts and closed above issued', () => {
    expect(validateBalances(fields, { ncrIssued: '-1', ncrClosed: '0', manHours: '1' }).errors.ncrIssued).toMatch(/negative/);
    expect(validateBalances(fields, { ncrIssued: '2.5', ncrClosed: '0', manHours: '1' }).errors.ncrIssued).toMatch(/whole/);
    expect(validateBalances(fields, { ncrIssued: '2', ncrClosed: '3', manHours: '1' }).errors.ncrClosed).toMatch(/exceed/);
    expect(validateBalances(fields, { ncrIssued: 'abc', ncrClosed: '0', manHours: '1' }).errors.ncrIssued).toBeTruthy();
  });
  it('accepts decimal hours and valid data', () => {
    const r = validateBalances(fields, { ncrIssued: '4', ncrClosed: '4', manHours: '12.75' });
    expect(r.valid).toBe(true);
    expect(r.values.manHours).toBe(12.75);
  });
  it('derives period and checks reason', () => {
    expect(monthToPeriod('2024-03')).toBe('2024-03-01');
    expect(monthToPeriod('2024-13')).toBeNull();
    expect(reasonError('short')).toBeTruthy();
    expect(reasonError('Go-live opening balances')).toBeNull();
  });
});

describe('historical permission gating', () => {
  const ops = (grants: string[]) => historicalOps(((m: string, op: string) => m === 'historical_balances' && grants.includes(op)) as never);
  it('denies everything without view', () => {
    expect(ops(['create_edit', 'import', 'export'])).toEqual({ view: false, edit: false, importOp: false, exportOp: false });
  });
  it('gates actions independently', () => {
    expect(ops(['view_all'])).toEqual({ view: true, edit: false, importOp: false, exportOp: false });
    expect(ops(['view_all', 'export'])).toEqual({ view: true, edit: false, importOp: false, exportOp: true });
    expect(ops(['view_all', 'import'])).toEqual({ view: true, edit: false, importOp: true, exportOp: false });
  });
});
