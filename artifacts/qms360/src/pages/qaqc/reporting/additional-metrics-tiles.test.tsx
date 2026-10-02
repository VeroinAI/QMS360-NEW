import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdditionalMetricsTiles } from './additional-metrics-tiles';
import { FormCtx } from './form-kit';
import { QMS_DEPARTMENTS, calcMonthly, type Obj } from './reporting-types';

const Tile = ({ index, title, children }: { index?: number; title: string; children: ReactNode }) => <section><h3>{index}. {title}</h3>{children}</section>;
const baseline: Obj = { material: { accumulatedIssued: 10, accumulatedClosed: 5 }, qtbt: { accumulatedTalkCount: 4, accumulatedManhours: 10 } };
const base: Obj = { material: { issued: 5, closed: 5, osdAvailable: true, totalItems: 3, approved: 3 }, qtbt: { talkCount: 2, attendance: 10, durationMinutes: 30 }, documents: { drawings: { approved: 1 }, submittals: {} }, qmsReports: [{ department: 'HSSE', type: 'SOP', status: 'Approved & Published' }], narrative: 'x', assessmentConfirmed: true };
function render(d: Obj = base, o: Obj = {}, ro = false) {
  const ctx = { data: d, readOnly: ro, set: () => {}, fc: () => ({ disabled: false, required: false }) };
  return renderToStaticMarkup(<FormCtx.Provider value={ctx}><AdditionalMetricsTiles Tile={Tile} calc={calcMonthly(d, baseline)} baseline={baseline} onDraftAi={() => {}} aiBusy={false} aiDraft="" onUseDraft={() => {}} {...o} /></FormCtx.Provider>);
}
const tid = (h: string, id: string) => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(h)?.[1];
const DIS = /\sdisabled=""/;
const tag = (h: string, id: string) => new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(h)?.[0] ?? '';

describe('AdditionalMetricsTiles', () => {
  const h = render();
  it('titles 9-13', () => {
    ['9. Material Inspection', '10. Quality Toolbox Talk', '11. Project Monthly Document Status – Submittals &amp; Drawings', '12. QMS Report', '13. Quality Assessment Brief'].forEach(t => expect(h).toContain(t));
  });
  it('material fields, radio, conditionals, variance', () => {
    expect(h).toContain('Acc. MIRN till Last Month'); expect(h).toContain('Closed till Last Month');
    expect(h).toContain('role="radiogroup"'); expect(h).not.toContain('data-testid="select-material');
    expect(tag(h, 'input-material-osd-mirns')).not.toMatch(DIS);
    expect(tag(h, 'input-material-approved')).not.toMatch(DIS);
    expect(tid(h, 'text-material-variance')).toBe('+16.7 pts');
    const off = render({ ...base, material: { issued: 1, closed: 1, osdAvailable: false } });
    expect(tag(off, 'input-material-osd-mirns')).toMatch(DIS);
    expect(tag(off, 'input-material-approved')).toMatch(DIS);
    expect(tag(off, 'input-material-overage')).not.toMatch(DIS);
    expect(render(base)).toContain('Status tags total 3 / Total items 3');
    expect(render({ ...base, material: { ...base.material, approved: 1 } })).toContain('tags must equal total items');
  });
  it('qtbt', () => {
    expect(tid(h, 'text-qtbt-manhours')).toBe('5.00'); expect(tid(h, 'text-qtbt-acc-talks')).toBe('6'); expect(tid(h, 'text-qtbt-acc-manhours')).toBe('15.00');
    expect(tid(h, 'text-qtbt-base-talks')).toBe('4');
    expect(tag(h, 'input-qtbt-attendance')).toContain('aria-required="true"');
    expect(tag(render({ ...base, qtbt: { talkCount: 0 } }), 'input-qtbt-attendance')).not.toContain('aria-required');
  });
  it('documents', () => {
    expect(h).toContain('>Drawings</h4>'); expect(h).toContain('>Submittals</h4>');
    expect((h.match(/Client Review Time/g) ?? []).length).toBe(2);
    expect(h).toContain('data-testid="input-documents-submittals-internal-days"');
  });
  it('qms', () => {
    QMS_DEPARTMENTS.forEach(d => expect(h).toContain(`value="${d.split("&").join("&amp;")}"`));
    expect(h).toContain('data-testid="row-qms-0"'); expect(h).toContain('button-remove-qms-0'); expect(h).toContain('button-add-qms');
  });
  it('assessment and ai', () => {
    expect(tag(h, 'input-narrative')).toContain('aria-required="true"');
    expect(h).toContain('I have reviewed and confirmed this assessment'); expect(h).toContain('Generate suggestion with VerionAI');
    const s = render(base, { aiDraft: '<b>hi</b>', aiError: 'Failed' });
    expect(s).toContain('&lt;b&gt;hi'); expect(s).toContain('Failed'); expect(s).toContain('Use suggestion'); expect(s).toContain('Update suggestion');
    expect(render(base, { aiBusy: true })).toContain('updating suggestion');
  });
  it('readOnly', () => {
    const r = render(base, { aiDraft: 'd' }, true);
    expect(r).not.toContain('button-add-qms'); expect(r).not.toContain('button-remove-qms'); expect(r).not.toContain('button-draft-ai'); expect(r).not.toContain('button-use-suggestion');
    expect(tag(r, 'input-material-issued')).toMatch(DIS); expect(tag(r, 'checkbox-assessment-confirmed')).toMatch(DIS);
  });
});
