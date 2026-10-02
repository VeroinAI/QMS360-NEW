import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormCtx } from './form-kit';
import { MetricsEntryForm } from './metrics-entry-form';
import { calcMonthly, type Obj } from './reporting-types';

const baseline: Obj = { metrics: {
  external_ncr: { accumulatedIssued: 10, accumulatedClosed: 4 },
  internal_ncr: { accumulatedIssued: 10, accumulatedClosed: 8 },
} };
const data: Obj = { manpower: [], meetings: [], internalAudit: {}, metrics: {
  external_ncr: { issued: 5, closed: 5, ageing: [{ department: 'Quality', bucket: '0-15', count: 4 }, { department: 'Operations', bucket: 'over45', count: 2 }] },
  internal_ncr: { issued: 10, closed: 2, ageing: [] },
  rfi: { issued: 0, closed: 0 },
  rmi: { issued: 3, closed: 1 },
} };

function render(readOnly = false, d: Obj = data, b: Obj = baseline) {
  const calc = calcMonthly(d, b);
  const ctx = { data: d, readOnly, set: () => {}, fc: () => ({ disabled: false, required: false }), departments: ['Quality', 'Operations'] };
  return { calc, html: renderToStaticMarkup(<FormCtx.Provider value={ctx}><MetricsEntryForm calc={calc.metrics} pqi={calc.pqi} /></FormCtx.Provider>) };
}
const text = (html: string, id: string) => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? '';

describe('MetricsEntryForm metric details tile', () => {
  const { html, calc } = render();
  it('groups all four categories under one numbered metric-details tile', () => {
    ['2. PQP Status', '3. Report Reference', '4. Meetings Conducted', '5. QMS Internal Audit', '6. Quality Manpower', '7. QA/QC Metric Details Section (Ext NCR, Int NCR, RFI &amp; RMI)'].forEach(t => expect(html).toContain(t));
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(7);
    expect(html).toContain('8. PQI (Project Quality Index) Calculation');
    expect(html).not.toContain('8. Internal NCR');
    expect(html).not.toContain('9. RFI');
    expect(html).not.toContain('10. RMI');
    for (const [key, label] of [['external_ncr', 'External NCR'], ['internal_ncr', 'Internal NCR'], ['rfi', 'RFI'], ['rmi', 'RMI']]) {
      expect(html).toMatch(new RegExp(`<section[^>]*aria-labelledby="metric-heading-${key}"`));
      expect(html).toMatch(new RegExp(`<h3[^>]*id="metric-heading-${key}"[^>]*>${label}</h3>`));
    }
  });
  it('shows baseline-derived read-only labels', () => {
    ['Acc. till Last Month', 'Closed till Last Month', 'Acc. till this Month', 'Closed till this Month', 'Closure Rate this Month', '% Acc. till Last Month', '% Acc. till this Month', 'Variance']
      .forEach(l => expect(html).toContain(l));
    expect(calc.metrics.external_ncr).toMatchObject({ prevIssued: 10, prevClosed: 4, accIssued: 15, accClosed: 9, open: 6 });
  });
  it('renders variance sign and direction', () => {
    expect(text(html, 'text-variance-external_ncr')).toMatch(/^\+20\.0.*improvement/);
    expect(text(html, 'text-variance-internal_ncr')).toMatch(/^-30\.0.*worsening/);
  });
  it('shows open NCRs and ageing sum against open', () => {
    expect(text(html, 'text-open-external_ncr')).toBe('6');
    expect(text(html, 'text-ageing-external_ncr').replace(/<!-- -->/g, '')).toBe('6 / 6');
    expect(html).not.toContain('text-open-rfi');
    expect(html).not.toContain('text-open-rmi');
  });
  it('renders ageing rows with department dropdowns, not text', () => {
    expect(html).toContain('BU/Dept');
    expect(html).not.toMatch(/<input[^>]*value="Operations"/);
    expect((html.match(/role="combobox"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('Remove ageing row 2');
  });
  it('uses required nonnegative integer inputs for monthly counts', () => {
    const inputs: string[] = html.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    const required = inputs.filter(i => i.includes('aria-required="true"') && i.includes('min="0"') && i.includes('step="1"'));
    expect(required.length).toBeGreaterThanOrEqual(8);
  });
  it('shows 100% for zero/zero RFI', () => {
    expect(calc.metrics.rfi).toMatchObject({ monthlyRate: 100, accRate: 100 });
    expect(html).toContain('100.0%');
  });
  it('disables inputs when read-only', () => {
    const ro = render(true).html;
    const inputs: string[] = ro.match(/<input[^>]*type="number"[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach(i => expect(i).toContain('disabled'));
    expect(ro).not.toContain('Add ageing row');
  });
});
