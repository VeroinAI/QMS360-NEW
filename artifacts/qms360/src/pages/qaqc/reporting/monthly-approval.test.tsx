import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MonthlyApprovalPreview, MonthlyApprovalProgress } from './monthly-approval';

const stages = [
  { level: 1, candidates: [{ id: 'one', name: 'Project Reviewer' }] },
  { level: 2, candidates: [{ id: 'two', name: 'Organization Reviewer' }] },
];
describe('monthly sequential approval UI', () => {
  it('explains configured stages and missing authorization', () => {
    const html = renderToStaticMarkup(<MonthlyApprovalPreview stages={stages} errors={['Assign another Level 2 reviewer']} />);
    expect(html).toContain('Level 1');
    expect(html).toContain('Organization Reviewer');
    expect(html).toContain('Assign another Level 2 reviewer');
    expect(html).toContain('Only the last level completes approval');
  });
  it('shows current level and retained review comments', () => {
    const html = renderToStaticMarkup(<MonthlyApprovalProgress state="submitted" approverId="two" workflow={{
      stages, currentIndex: 1, history: [{ cycle: 1, level: 1, decision: 'approve', userId: 'one', comments: 'Checked totals' }],
    }} />);
    expect(html).toContain('Awaiting Level 2 approval');
    expect(html).toContain('Organization Reviewer');
    expect(html).toContain('Checked totals');
    expect(html).toContain('Completed');
  });
  it.each(['approved', 'sent_back'])('shows %s state', state => {
    const html = renderToStaticMarkup(<MonthlyApprovalProgress state={state} workflow={{ stages, currentIndex: 1, history: [] }} />);
    expect(html).toContain(state === 'approved' ? 'All approval levels completed' : 'All levels restart on resubmission');
  });
  it('does not invent a chain for legacy or non-monthly reports', () => {
    expect(renderToStaticMarkup(<MonthlyApprovalProgress />)).toBe('');
  });
});
