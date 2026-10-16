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
    expect(html.match(/Yesterday \(auto\)/g)).toHaveLength(10);
    expect(html.match(/Total \(auto\)/g)).toHaveLength(10);
    for (const title of ['Revisions', 'Document types', 'Correspondence', 'Pending with Client']) expect(html).toContain(title);
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
});
