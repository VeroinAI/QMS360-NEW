import { describe, expect, it } from 'vitest';
import { metricsReportPeriod } from './metrics-report-period';

describe('Metrics Display/Edit Month / Year', () => {
  it.each([
    ['2026-09-01', 'September, 2026'],
    ['2026-10-01', 'October, 2026'],
    ['2026-01', 'January, 2026'],
    ['2026-12-01', 'December, 2026'],
  ])('displays %s as %s without changing its saved value', (period, expected) => {
    expect(metricsReportPeriod(period)).toBe(expected);
    expect(period).toMatch(/^2026-/);
  });
  it('does not invent a month for empty or malformed periods', () => {
    expect(metricsReportPeriod('')).toBe('—');
    expect(metricsReportPeriod('2026-13-01')).toBe('2026-13-01');
  });
});
