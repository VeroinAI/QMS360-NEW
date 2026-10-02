import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PqiFields, type PqiFieldsProps, type PortfolioPqi } from './pqi-fields';
import { calcMonthly, METRICS, type Obj } from './reporting-types';

const render = (props: PqiFieldsProps) => renderToStaticMarkup(<PqiFields {...props} />);
const value = (html: string, field: string) => new RegExp(`data-testid="text-pqi-${field}"[^>]*>([^<]*)<`).exec(html)?.[1];
const portfolio: PortfolioPqi = { average: 75, activeProjectCount: 2, reportedProjectCount: 2, pendingProjectCount: 0, status: 'complete', period: '2026-10-01' };
const baseline: Obj = { metrics: {
  external_ncr: { accumulatedIssued: 10, accumulatedClosed: 5 },
  internal_ncr: { accumulatedIssued: 20, accumulatedClosed: 10 },
  rfi: { accumulatedIssued: 5, accumulatedClosed: 4 },
  rmi: { accumulatedIssued: 10, accumulatedClosed: 10 },
} };
const data: Obj = { metrics: {
  external_ncr: { issued: 5, closed: 4 },
  internal_ncr: { issued: 0, closed: 4 },
  rfi: { issued: 5, closed: 1 },
  rmi: { issued: 0, closed: 0 },
} };

describe('PQI calculation fields', () => {
  it('renders all five supplied fields as read-only values', () => {
    const html = render({ pqi: calcMonthly(data, baseline).pqi, portfolio });
    ['PQI - Acc. till Last Month', 'PQI - Acc. till this Month', 'PQI - Variance', 'PQI - This Month Score', 'Average of All Projects'].forEach(label => expect(html).toContain(label));
    expect(html).not.toMatch(/<(input|select|textarea)\b/);
    expect(value(html, 'prior')).toBe('70.0%');
    expect(value(html, 'current')).toBe('70.0%');
    expect(value(html, 'variance')).toBe('+0.0 pp');
    expect(value(html, 'monthly')).toBe('50.0%');
    expect(value(html, 'average')).toBe('75.0%');
  });
  it('updates means and signed variance from category inputs without changing input data', () => {
    const changed = { ...data, metrics: { ...data.metrics, external_ncr: { issued: 5, closed: 5 } } };
    const before = JSON.stringify(changed);
    const html = render({ pqi: calcMonthly(changed, baseline).pqi });
    expect(value(html, 'current')).toBe('71.7%');
    expect(value(html, 'variance')).toBe('+1.7 pp');
    expect(html).toContain('text-emerald-700');
    expect(JSON.stringify(changed)).toBe(before);
    const worse = { ...data, metrics: { ...data.metrics, internal_ncr: { issued: 0, closed: 0 } } };
    const worseHtml = render({ pqi: calcMonthly(worse, baseline).pqi });
    expect(value(worseHtml, 'variance')).toBe('-5.0 pp');
    expect(worseHtml).toContain('text-destructive');
  });
  it('preserves zero/zero category rates and PQI of 100 percent', () => {
    const zero = { metrics: Object.fromEntries(METRICS.map(([key]) => [key, { issued: 0, closed: 0 }])) };
    const html = render({ pqi: calcMonthly(zero, {}).pqi });
    for (const field of ['prior', 'current', 'monthly']) expect(value(html, field)).toBe('100.0%');
    expect(value(html, 'variance')).toBe('+0.0 pp');
  });
  it('shows pending instead of averaging only available projects', () => {
    const html = render({ portfolio: { ...portfolio, status: 'pending', average: null, reportedProjectCount: 1, pendingProjectCount: 1 } });
    expect(value(html, 'average')).toBe('Pending reports');
    expect(html).toContain('1 of 2 active projects reported (1 pending)');
    expect(html).not.toContain('75.0%');
  });
  it('keeps a complete zero average rather than treating it as missing', () => {
    expect(value(render({ portfolio: { ...portfolio, average: 0 } }), 'average')).toBe('0.0%');
  });
  it('does not fabricate a project score or an empty-portfolio average', () => {
    const html = render({ portfolio: { ...portfolio, average: null, status: 'empty', activeProjectCount: 0, reportedProjectCount: 0 } });
    expect(value(html, 'average')).toBe('—');
    expect(value(html, 'prior')).toBe('—');
    expect(html).toContain('Select a project');
    expect(html).toContain('No active projects');
  });
  it('handles loading and failures explicitly without showing a stale average', () => {
    expect(value(render({ portfolio, portfolioLoading: true }), 'average')).toBe('Loading…');
    const failed = render({ portfolio, portfolioError: true });
    expect(value(failed, 'average')).toBe('Unavailable');
    expect(failed).toContain('Unable to load');
    expect(failed).not.toContain('75.0%');
  });
});