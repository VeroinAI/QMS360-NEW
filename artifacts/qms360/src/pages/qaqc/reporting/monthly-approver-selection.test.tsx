import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveMonthlyApprover, useMonthlyApproverSelection } from './monthly-approver-selection';

describe('monthly submission approver selection', () => {
  it('automatically selects the sole eligible approver', () => {
    expect(resolveMonthlyApprover(['only-reviewer'])).toBe('only-reviewer');
  });

  it('requires a manual choice when multiple approvers are eligible', () => {
    expect(resolveMonthlyApprover(['one', 'two'])).toBe('');
    expect(resolveMonthlyApprover(['one', 'two'], 'two')).toBe('two');
  });

  it('never retains an ineligible selection or invents an approver', () => {
    expect(resolveMonthlyApprover([], 'old-reviewer')).toBe('');
    expect(resolveMonthlyApprover(['one', 'two'], 'old-reviewer')).toBe('');
    expect(resolveMonthlyApprover(['replacement'], 'old-reviewer')).toBe('replacement');
  });

  it.each([
    { ids: ['only-reviewer'], expected: 'only-reviewer' },
    { ids: ['one', 'two'], expected: '' },
    { ids: [], expected: '' },
  ])('initializes the dialog selection for $ids', ({ ids, expected }) => {
    function Selection() {
      const [id] = useMonthlyApproverSelection(ids, 'report');
      return <input value={id} readOnly />;
    }
    expect(renderToStaticMarkup(<Selection />)).toContain(`value="${expected}"`);
  });
});
