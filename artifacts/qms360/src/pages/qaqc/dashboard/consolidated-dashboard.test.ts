import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dash, filterRecords, signed, SeriesBars, MonthlyQualityEmptyState } from './consolidated-dashboard';
import type { DashboardRecord } from './types';

const rec = (o: Partial<DashboardRecord>): DashboardRecord => ({ id: '1', projectId: 'p1', projectName: 'P', type: 'monthly_report', period: '2025-04', title: 't', href: '/x', state: 'Approved', ...o });

describe('consolidated dashboard helpers', () => {
  it('explains approval-only empty quality figures without claiming the module is unavailable', () => {
    const html = renderToStaticMarkup(createElement(MonthlyQualityEmptyState, {
      period: '2026-10', pendingApproval: 1, pendingSubmission: 8, onReports: () => {}, onPending: () => {},
    }));
    expect(html).toContain('No approved monthly reports for 2026-10');
    expect(html).toContain('Values appear after final approval');
    expect(html).toContain('View pending approval');
    expect(html).toContain('View monthly reports');
    expect(html).not.toContain('module unavailable');
  });
  it('does not offer a pending-approval action when no visible report is awaiting approval', () => {
    const html = renderToStaticMarkup(createElement(MonthlyQualityEmptyState, {
      period: '2026-10', pendingApproval: 0, pendingSubmission: 2, onReports: () => {}, onPending: () => {},
    }));
    expect(html).not.toContain('View pending approval');
    expect(html).toContain('View monthly reports');
  });
  it('limits the empty-state pending approval drilldown to submitted monthly reports in the selected month', () => {
    const records = [rec({ id: 'approved' }), rec({ id: 'draft', state: 'draft' }), rec({ id: 'pending', state: 'submitted' }),
      rec({ id: 'otherMonth', state: 'submitted', period: '2025-03' }), rec({ id: 'daily', type: 'daily', state: 'submitted' })];
    expect(filterRecords(records, { title: '', module: 'monthly', state: 'submitted', period: '2025-04' }).map(r => r.id)).toEqual(['pending']);
  });
  it('forwards measured responsive dimensions through the reusable chart wrapper', () => {
    const html = renderToStaticMarkup(createElement(SeriesBars, {
      width: 320, height: 180, data: [{ name: 'Civil', value: 12 }],
      series: [{ key: 'value', name: 'Documents', color: '#06AEBB' }],
    }));
    expect(html).toContain('recharts-surface');
    expect(html).toContain('width="320"');
    expect(html).toContain('height="180"');
    expect(html).toContain('recharts-cartesian-axis');
    expect(html).toContain('Civil');
  });
  it('renders categorical vertical axes and finite bars for multiple document types', () => {
    const html = renderToStaticMarkup(createElement(SeriesBars, {
      width: 420, height: 260, layout: 'vertical', data: [{ name: 'Drawings', value: 42 }, { name: 'RFIs', value: 9 }],
      series: [{ key: 'value', name: 'Documents', color: '#06AEBB' }],
    }));
    expect(html).toContain('Drawings');
    expect(html).toContain('RFIs');
    expect(html).not.toContain('NaN');
    expect((html.match(/class="recharts-rectangle"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('renders nulls as em dash, never zero', () => {
    expect(dash(null)).toBe('—'); expect(dash(0)).toBe('0'); expect(dash(61.25, '%', 1)).toBe('61.3%');
  });
  it('keeps negative movement visible', () => { expect(signed(-3)).toBe('-3'); expect(signed(4)).toBe('+4'); expect(signed(null)).toBe('—'); });
  it('scopes drilldown records by module, project, state and impact', () => {
    const rs = [rec({ id: 'a' }), rec({ id: 'b', type: 'lesson', impact: 'Negative' }), rec({ id: 'c', projectId: 'p2', state: 'Submitted' })];
    expect(filterRecords(rs, { title: '', module: 'monthly', state: 'approved' }).map(r => r.id)).toEqual(['a']);
    expect(filterRecords(rs, { title: '', module: 'lesson', impact: 'Negative' }).map(r => r.id)).toEqual(['b']);
    expect(filterRecords(rs, { title: '', projectId: 'p2' }).map(r => r.id)).toEqual(['c']);
  });
});
