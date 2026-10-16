import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DailyForm } from './daily-form';
import { FormCtx } from './form-kit';
import { calcDaily, DISCIPLINES, DISC_STATUSES, type Obj } from './reporting-types';

function render(data: Obj = {}, baseline: Obj = {}, readOnly = false, fieldLocked = false) {
  return renderToStaticMarkup(<FormCtx.Provider value={{ data, readOnly, set: () => {}, fc: () => ({ disabled: fieldLocked, required: false }) }}>
    <DailyForm calc={calcDaily(data)} baseline={baseline} />
  </FormCtx.Provider>);
}

describe('Daily discipline submission layout', () => {
  it('orders disciplines consistently in drawings and submittals', () => {
    const html = render();
    for (const category of ['Drawings', 'Submittals']) {
      const positions = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Instrumentation']
        .map(d => html.indexOf(`aria-label="${d} ${category}"`));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
  it('combines both categories under one heading with individual discipline tables', () => {
    const html = render();
    expect(html).toContain('Daily Submission - Drawings and Submittals by Discipline');
    expect(html).toContain('Enter the cumulative figures as on the Current Date for each discipline.');
    expect(html).not.toContain('Disciplines - drawings');
    expect(html).not.toContain('Disciplines - submittals');
    for (const cat of ['drawings', 'submittals']) for (const d of DISCIPLINES) {
      expect(html).toContain(`aria-label="${d} ${cat === 'drawings' ? 'Drawings' : 'Submittals'}"`);
      for (const [, label] of DISC_STATUSES) expect(html).toContain(`aria-label="${d} ${cat} ${label} current"`);
    }
    expect(html.match(/Yesterday \(auto\)/g)).toHaveLength(11);
    expect(html.match(/Total \(auto\)/g)).toHaveLength(10);
    for (const title of ['Revisions', 'Document Types', 'Correspondence', 'Pending with Client']) expect(html).toContain(title);
  });

  it('shows prior cumulative values and calculates totals independently by category', () => {
    const data = { disciplines: { drawings: { Civil: { approved: 3, resubmit: 4, rejected: 2, underReview: 1 } }, submittals: { Civil: { approved: 20 } } } };
    const baseline = { disciplines: { drawings: { Civil: { approved: 2, resubmit: 1 } }, submittals: { Civil: { approved: 15 } } } };
    const html = render(data, baseline);
    expect(html).toContain('Drawings overall total — Yesterday 3 · Current 10');
    expect(html).toContain('Submittals overall total — Yesterday 15 · Current 20');
    expect(html).toMatch(/aria-label="Civil drawings Approved yesterday"[^>]*readOnly=""[^>]*value="2"/);
    expect(html).toMatch(/aria-label="Civil drawings total current"[^>]*readOnly=""[^>]*value="10"/);
  });

  it('preserves read-only and field-locked inputs', () => {
    for (const html of [render({}, {}, true), render({}, {}, false, true)]) {
      const fields = html.match(/<input[^>]*aria-label="[^"]+ (?:drawings|submittals) (?:Approved|Resubmit|Rejected|Under review) current"[^>]*>/g) ?? [];
      expect(fields).toHaveLength(40);
      for (const field of fields) expect(field).toContain('disabled=""');
    }
  });

  it('shows the requested Document Types tile in order with separate yesterday and current inputs', () => {
    const html = render({ documentTypes: { ITPs: 12, RFIs: 6, Procedures: 3, Calculations: 2, Vendors: 8 } },
      { documentTypes: { ITPs: 10, RFIs: 4, Vendors: 7 } });
    expect(html).toContain('6.3.2a Document Types');
    expect(html).toContain('Documents by Type (cumulative)');
    const labels = ['Drawings', 'Material Submittals', 'Method Statements', 'ITP', 'RFIs', 'Procedures', 'Calculations', 'Vendor Documents'];
    const positions = labels.map(label => html.indexOf(`aria-label="${label} yesterday"`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const label of labels) expect(html).toContain(`aria-label="${label} current"`);
    expect(html).toMatch(/aria-label="ITP yesterday"[^>]*readOnly=""[^>]*value="10"/);
    expect(html).toMatch(/aria-label="ITP current"[^>]*value="12"/);
    expect(html).toMatch(/aria-label="RFIs yesterday"[^>]*readOnly=""[^>]*value="4"/);
    expect(html).not.toContain('(previously saved)');
    expect(html).toContain('Discipline progress on the dashboard is derived automatically from the discipline blocks above.');
  });

  it('retains legacy document counts without treating IFR as RFIs', () => {
    const html = render({ documentTypes: { CVs: 5, PQP: 2, IFR: 9 } }, { documentTypes: { IFR: 8 } });
    expect(html.match(/\(previously saved\)/g)).toHaveLength(3);
    expect(html).toMatch(/aria-label="IFR yesterday"[^>]*value="8"/);
    expect(html).toMatch(/aria-label="IFR current"[^>]*value="9"/);
    expect(html).toMatch(/aria-label="RFIs yesterday"[^>]*value="0"/);
    for (const lockedHtml of [render({}, {}, true), render({}, {}, false, true)]) {
      expect(lockedHtml).toMatch(/aria-label="Procedures current"[^>]*disabled=""/);
      expect(lockedHtml).toMatch(/aria-label="Vendor Documents current"[^>]*disabled=""/);
    }
  });
});
