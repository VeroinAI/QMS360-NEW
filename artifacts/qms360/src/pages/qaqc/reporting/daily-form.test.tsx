import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DailyForm } from './daily-form';
import { FormCtx } from './form-kit';
import { calcDaily, DISCIPLINES, DISC_STATUSES, ENTITIES, PEND_BUCKETS, PEND_STATUSES, zeroFill, type Obj } from './reporting-types';
import { moveRevision } from './approved-revisions';

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
    expect(html.match(/Yesterday \(auto\)/g)).toHaveLength(13);
    expect(html.match(/Total \(auto\)/g)).toHaveLength(10);
    for (const title of ['Approved status by Rivision', 'Document Types', 'Correspondence', 'Submission Review — Pending Days']) expect(html).toContain(title);
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
    expect(html).toContain('Document Types');
    expect(html).not.toContain('6.3.2a Document Types');
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

  it('places the combined revision tile after document types with type choices and calculated percentages', () => {
    const html = render({
      disciplines: { drawings: { Civil: { approved: 60 } }, submittals: { Civil: { approved: 40 } } },
      revisions: { drawings: [{ name: '0', value: 20 }], submittals: [{ name: 'A', value: 15 }] },
    }, { revisions: { drawings: [{ name: '0', value: 12 }], submittals: [{ name: 'A', value: 10 }] } });
    expect(html.indexOf('Approved status by Rivision')).toBeGreaterThan(html.indexOf('Document Types'));
    for (const label of ['Document Type', 'Revision No.', 'Yesterday Approved (auto)', 'Current Approved', '% of Overall Cum', 'Add Revision']) expect(html).toContain(label);
    expect(html.match(/<select /g)).toHaveLength(2);
    expect(html.match(/<option[^>]*value="drawings"/g)).toHaveLength(2);
    expect(html.match(/<option[^>]*value="submittals"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-label="Drawing revision 1 yesterday approved"[^>]*readOnly=""[^>]*value="12"/);
    expect(html).toMatch(/aria-label="Submittal revision 1 yesterday approved"[^>]*readOnly=""[^>]*value="10"/);
    expect(html).toContain('33.3%');
    expect(html).toContain('37.5%');
    expect(html).toContain('Drawing revision percentages use total cumulative Drawings');
    expect(html).not.toContain('Drawings + Submittals Total');
  });

  it('keeps revision denominators independent when the other category changes or its own total is zero', () => {
    const revisions = { drawings: [{ name: 'A', value: 25 }], submittals: [{ name: 'A', value: 15 }] };
    const data = { disciplines: { drawings: { Civil: { approved: 100 } }, submittals: { Civil: { approved: 60 } } }, revisions };
    const html = render(data);
    expect(html.match(/>25\.0%<\/td>/g)).toHaveLength(2);
    const changed = render({ ...data, disciplines: { ...data.disciplines, submittals: { Civil: { approved: 30 } } } });
    expect(changed).toContain('25.0%');
    expect(changed).toContain('50.0%');
    const zero = render({ ...data, disciplines: { submittals: data.disciplines.submittals } });
    expect(zero).toContain('0.0%');
    expect(zero).toContain('25.0%');
    expect(zero).not.toMatch(/NaN|Infinity/);
  });

  it('preserves prior-only revisions, handles zero totals, and respects revision field locks', () => {
    const data = { revisions: { drawings: [{ name: 'B', value: 2 }] } };
    const baseline = { revisions: { submittals: [{ name: 'A', value: 7 }] } };
    const html = render(data, baseline);
    expect(html).toContain('Enter current');
    expect(html).toContain('0.0%');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).toMatch(/aria-label="Submittal revision A previous log approved"[^>]*value="7"/);
    for (const lockedHtml of [render(data, baseline, true), render(data, baseline, false, true)]) {
      expect(lockedHtml).not.toContain('Add Revision');
      expect(lockedHtml).not.toContain('Remove Drawing revision');
      expect(lockedHtml).not.toContain('Enter current');
      expect(lockedHtml).toMatch(/aria-label="Drawing revision 1 document type"[^>]*disabled=""/);
      expect(lockedHtml).toMatch(/aria-label="Drawing revision 1 current approved"[^>]*disabled=""/);
    }
  });

  it('moves a revision between document types without losing its values or other rows', () => {
    const original = { drawings: [{ name: 'A', value: 12 }, { name: 'B', value: 4 }], submittals: [{ name: '0', value: 3 }] };
    const moved = moveRevision(original, 'drawings', 0, 'submittals');
    expect(moved.drawings).toEqual([{ name: 'B', value: 4 }]);
    expect(moved.submittals).toEqual([{ name: '0', value: 3 }, { name: 'A', value: 12 }]);
    expect(original.drawings).toHaveLength(2);
    expect(moveRevision(original, 'drawings', 0, 'drawings')).toBe(original);
    expect(calcDaily({ revisions: { drawings: [{ name: '0', value: 1 }, { name: '0', value: 2 }] } }).issues)
      .toContain('Duplicate drawings revision name: 0.');
  });

  it('places correspondence and rejected submissions immediately after revisions in the requested order', () => {
    const html = render({
      correspondence: { outgoing: 12, incoming: 8 },
      rejectedSubmissions: { drawing: 4, materials: 3, calculation: 2, general: 1 },
    }, { correspondence: { outgoing: 10, incoming: 7 }, rejectedSubmissions: { drawing: 2, materials: 1, calculation: 1, general: 0 } });
    const headings = ['Approved status by Rivision', 'Correspondence', 'Rejected Submissions', 'Submission Review — Pending Days'].map(title => html.indexOf(title));
    expect(headings).toEqual([...headings].sort((a, b) => a - b));
    expect(html.match(/aria-label="Correspondence"/g)).toHaveLength(1);
    expect(html.indexOf('aria-label="Correspondence Outgoing yesterday"')).toBeLessThan(html.indexOf('aria-label="Correspondence Incoming yesterday"'));
    const rows = ['Drawing', 'Materials', 'Calculation', 'General'].map(label => html.indexOf(`aria-label="Rejected Submissions ${label} yesterday"`));
    expect(rows.every(index => index >= 0)).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(html).toMatch(/aria-label="Correspondence Outgoing yesterday"[^>]*readOnly=""[^>]*value="10"/);
    expect(html).toMatch(/aria-label="Correspondence Outgoing current"[^>]*value="12"/);
    expect(html).toMatch(/aria-label="Rejected Submissions Drawing yesterday"[^>]*readOnly=""[^>]*value="2"/);
    expect(html).toMatch(/aria-label="Rejected Submissions Drawing current"[^>]*value="4"/);
  });

  it('zero-fills all rejected submission counts and respects field locks', () => {
    expect(zeroFill('daily', {}).rejectedSubmissions).toEqual({ drawing: 0, materials: 0, calculation: 0, general: 0 });
    for (const html of [render({}, {}, true), render({}, {}, false, true)]) {
      for (const label of ['Drawing', 'Materials', 'Calculation', 'General']) {
        expect(html).toMatch(new RegExp(`aria-label="Rejected Submissions ${label} current"[^>]*disabled=""`));
      }
      expect(html).toMatch(/aria-label="Correspondence Outgoing current"[^>]*disabled=""/);
    }
  });

  it('numbers the daily business tiles consecutively and combines every pending entity in one table', () => {
    const html = render();
    const titles = [
      '2. Daily Submission - Drawings and Submittals by Discipline',
      '3. Document Types', '4. Approved status by Rivision', '5. Correspondence',
      '6. Rejected Submissions', '7. Submission Review — Pending Days',
    ];
    const positions = titles.map(title => html.indexOf(title));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).not.toContain('6.3.6');
    expect(html).not.toContain('Pending with ');
    expect(html.match(/aria-label="Submission Review — Pending Days"/g)).toHaveLength(1);
    for (const label of ['≤7 days', '8–30 days', '≥31 days', 'UNDER REVIEW', 'STATUS A', 'STATUS E']) expect(html).toContain(label);
    expect(html.match(/scope="rowgroup"/g)).toHaveLength(3);
    for (const entity of ENTITIES) for (const [, status] of PEND_STATUSES) for (const [, bucket] of PEND_BUCKETS) {
      expect(html).toContain(`aria-label="${entity} ${status} ${bucket} current"`);
    }
  });

  it('preserves pending counts and row totals with role-based read-only inputs', () => {
    const data = { pending: {
      Client: { A: { upTo7: 2, days8To30: 3, over30: 4 } },
      Algihaz: { underReview: { upTo7: 5 } }, Supplier: { E: { over30: 6 } },
    } };
    const html = render(data);
    expect(html).toMatch(/aria-label="Client A Up to 7 days current"[^>]*value="2"/);
    expect(html).toMatch(/aria-label="Client A total"[^>]*>9</);
    expect(html).toMatch(/aria-label="Algihaz Under review total"[^>]*>5</);
    expect(html).toMatch(/aria-label="Supplier E total"[^>]*>6</);
    for (const lockedHtml of [render(data, {}, true), render(data, {}, false, true)]) {
      const pendingInputs = lockedHtml.match(/<input[^>]*aria-label="(?:Client|Algihaz|Supplier) [^"]+ current"[^>]*>/g) ?? [];
      expect(pendingInputs).toHaveLength(54);
      for (const input of pendingInputs) expect(input).toContain('disabled=""');
    }
  });
});
