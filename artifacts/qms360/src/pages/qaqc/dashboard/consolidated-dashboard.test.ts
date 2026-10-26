import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dash, filterRecords, signed, SeriesBars } from './consolidated-dashboard';
import type { DashboardRecord } from './types';

const rec = (o: Partial<DashboardRecord>): DashboardRecord => ({ id: '1', projectId: 'p1', projectName: 'P', type: 'monthly_report', period: '2025-04', title: 't', href: '/x', state: 'Approved', ...o });

describe('consolidated dashboard helpers', () => {
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
