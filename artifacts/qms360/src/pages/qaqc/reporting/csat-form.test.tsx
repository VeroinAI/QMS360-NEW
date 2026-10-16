import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CsatForm } from './csat-form';
import { FormCtx } from './form-kit';
import { validateCsat } from './csat-validation';
import { CSAT_QUESTIONS, CSAT_SCALE, type Obj } from './reporting-types';

const answered = {
  ratings: { quality: 1, timeline: 2, communication: 3, professionalism: 4, valueForMoney: 5, issueHandling: 3 },
  expectations: 'Yes', recommend: 'Partially',
};
function render(data: Obj = {}, readOnly = false, fieldLocked = false) {
  return renderToStaticMarkup(<FormCtx.Provider value={{ data, readOnly, set: () => {}, fc: () => ({ disabled: fieldLocked, required: false }) }}>
    <CsatForm projectName="Project from master" />
  </FormCtx.Provider>);
}

describe('Customer Satisfaction (CSAT) feedback form', () => {
  it('shows the exact six questions, mandatory radios and scale labels without defaults', () => {
    const html = render();
    for (const [, question] of CSAT_QUESTIONS) expect(html).toContain(question);
    for (const option of CSAT_SCALE) expect(html).toContain(option.label);
    expect(html.match(/type="radio"/g)).toHaveLength(36);
    expect(html.match(/role="radiogroup"/g)).toHaveLength(8);
    expect(html.match(/aria-required="true"/g)).toHaveLength(8);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain('No ratings selected yet.');
  });

  it('auto-fills the read-only project name and includes all three optional text areas', () => {
    const html = render();
    expect(html).toContain('value="Project from master"');
    expect(html).toContain('readOnly=""');
    expect(html.match(/<textarea/g)).toHaveLength(3);
    for (const label of ['Most Satisfactory Aspects', 'Improvement Suggestions', 'Additional Comments / Recommendations',
      'Project Completed as per Expectations', 'Would Recommend Our Services']) expect(html).toContain(label);
    expect(html).toContain('These text fields are optional.');
  });

  it('reopens saved ratings and outcomes and calculates their average', () => {
    const html = render(answered);
    expect(html.match(/checked=""/g)).toHaveLength(8);
    expect(html).toContain('Average score: 3.00 of 5 (6 of 6 answered).');
    expect(render({ ...answered, ratings: { ...answered.ratings, quality: '1' } }).match(/checked=""/g)).toHaveLength(8);
  });

  it('keeps satisfaction ratings as colored tiles and both outcomes as visible radio buttons', () => {
    const html = render(answered);
    expect(html).toContain('Scale: 1 = Very Dissatisfied, 5 = Excellent');
    expect(html).toContain('Qualitative Feedback');
    expect(html).not.toContain('Feedback details');
    expect(html).not.toContain('Additional feedback');
    for (const color of ['red', 'orange', 'amber', 'lime', 'green']) {
      expect(html).toContain(`bg-${color}-50`);
    }
    expect(html.match(/min-h-24/g)).toHaveLength(30);
    expect(html.match(/focus-within:ring-2/g)).toHaveLength(30);
    expect(html.match(/class="size-5 shrink-0 accent-primary"/g)).toHaveLength(6);
    for (const field of ['expectations', 'recommend']) {
      for (const option of ['Yes', 'No', 'Partially']) {
        expect(html).toContain(`data-testid="radio-csat-${field}-${option}"`);
      }
    }
  });

  it('respects read-only forms and field-access locks', () => {
    for (const html of [render(answered, true), render(answered, false, true)]) {
      expect(html.match(/<input[^>]*type="radio"[^>]*disabled=""/g)).toHaveLength(36);
    }
  });

  it('requires all six integer ratings and both outcomes, but not optional comments', () => {
    expect(validateCsat({})).toHaveLength(8);
    expect(validateCsat(answered)).toEqual([]);
    for (const value of [0, 6, 2.5, '', undefined]) {
      expect(validateCsat({ ...answered, ratings: { ...answered.ratings, quality: value } })).toHaveLength(1);
    }
    expect(validateCsat({ ...answered, recommend: 'Maybe' })).toHaveLength(1);
  });
});