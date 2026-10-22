import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsReportList, monthInputToPeriod, pqpStatusLabel, pendingMonthlyApproval } from './metrics-report-list';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), context: vi.fn(), read: true, edit: false, download: false, submit: false,
}));
vi.mock('@workspace/api-client-react', () => ({
  useListQaqcSowReports: mocks.list,
  useGetQaqcSowContext: mocks.context,
  useGetCurrentUser: () => ({ data: { id: 'creator' } }),
  getGetCurrentUserQueryKey: () => ['current-user'],
  getListQaqcSowReportsQueryKey: (params: unknown) => ['reports', params],
  getGetQaqcSowContextQueryKey: (params: unknown) => ['context', params],
  exportQaqcSowReport: vi.fn(),
}));
vi.mock('@/lib/use-qaqc-capabilities', () => ({
  useQaqcCapabilities: () => ({
    isLoading: false, canAnyRead: () => mocks.read,
    can: (_module: string, operation: string) => operation === 'create_edit' ? mocks.edit : operation === 'submit' ? mocks.submit : mocks.download,
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const render = () => renderToStaticMarkup(<Router ssrPath="/qaqc/metrics"><MetricsReportList /></Router>);

describe('Monthly metrics landing report list', () => {
  beforeEach(() => {
    mocks.list.mockReset(); mocks.context.mockReset();
    mocks.read = true; mocks.edit = false; mocks.download = false; mocks.submit = false;
    mocks.context.mockReturnValue({ data: { projects: [{ id: 'project-a', name: 'Project Alpha' }] } });
    mocks.list.mockReturnValue({ data: { items: [
      { id: 'draft-report', createdById: 'creator', projectId: 'project-a', projectName: 'Project Alpha', period: '2026-09-01', state: 'draft', data: { pqpStatus: 'Under Preparation' } },
      { id: 'submitted-report', projectId: 'project-a', projectName: 'Project Alpha', period: '2026-08-01', state: 'submitted', data: { pqpStatus: 'Approved A', pqpSubmittedDate: '2026-08-10' } },
      { id: 'returned-report', projectId: 'project-a', projectName: 'Project Alpha', period: '2026-07-01', state: 'sent_back', data: {} },
    ], total: 3 } });
  });
  it('uses server-side monthly RBAC listing and displays the requested metadata columns', () => {
    const html = render();
    for (const label of ['Project Name', 'Month / Year', 'PQP Status', 'PQP Submission Date', 'Status', 'Pending Approval Level', 'Pending Approver', 'Project Alpha', 'Approved A'])
      expect(html).toContain(label);
    expect(mocks.list.mock.calls[0][0]).toEqual({ reportType: 'monthly', page: 1, limit: 20 });
    expect(mocks.list.mock.calls[0][1].query.enabled).toBe(true);
    expect(html).toContain('filter-project');
    expect(html).toContain('type="month"');
    expect(mocks.list.mock.calls[0][1].query.refetchInterval).toBe(30_000);
  });
  it('offers only Display to read-only users, including draft rows', () => {
    const html = render();
    expect(html).toContain('/draft-report?mode=view');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('>Download<');
    expect(html).not.toContain('Submit for approval');
  });
  it('offers submission only for the authorized creator of a draft', () => {
    mocks.submit = true;
    const html = render();
    expect(html).toContain('button-submit-report-draft-report');
    expect(html).not.toContain('button-submit-report-submitted-report');
    expect(html).not.toContain('button-submit-report-returned-report');
    mocks.list.mock.results[0].value.data.items[0].createdById = 'another-user';
    expect(render()).not.toContain('button-submit-report-draft-report');
  });
  it('offers Edit only on drafts and keeps submitted and returned reports in Display', () => {
    mocks.edit = true; mocks.download = true;
    const html = render();
    expect(html).toContain('href="/qaqc/metrics/reports/draft-report"');
    expect(html).toContain('/submitted-report?mode=view');
    expect(html).toContain('/returned-report?mode=view');
    expect(html).toContain('>Download<');
  });
  it('fails closed when monthly read permission is absent', () => {
    mocks.read = false;
    const html = render();
    expect(html).toContain('You do not have permission');
    expect(html).not.toContain('Project Alpha');
    expect(mocks.list.mock.calls[0][1].query.enabled).toBe(false);
    expect(mocks.context.mock.calls[0][1].query.enabled).toBe(false);
  });
  it('uses first-of-month API periods and actual PQP data without fabricated defaults', () => {
    expect(monthInputToPeriod('2026-09')).toBe('2026-09-01');
    expect(monthInputToPeriod('')).toBeUndefined();
    expect(pqpStatusLabel(undefined)).toBe('-');
    expect(pqpStatusLabel({ pqpStatus: 'Others', pqpOther: 'Special review' })).toBe('Others: Special review');
  });
  it('shows the current saved approval level and only the assigned reviewer in each row', () => {
    const value = mocks.list.getMockImplementation()!();
    value.data.items[1] = {
      ...value.data.items[1], approverId: 'reviewer-2', approverName: 'Assigned Reviewer',
      approvalWorkflow: { currentIndex: 1, stages: [
        { level: 1, candidates: [{ id: 'reviewer-1', name: 'Previous Reviewer' }] },
        { level: 3, candidates: [{ id: 'reviewer-2', name: 'Snapshot Reviewer' }, { id: 'other', name: 'Unselected Reviewer' }] },
      ] },
    };
    mocks.list.mockReturnValue(value);
    const html = render();
    expect(html).toContain('Level 3');
    expect(html).toContain('Assigned Reviewer');
    expect(html).not.toContain('Previous Reviewer');
    expect(html).not.toContain('Unselected Reviewer');
  });
  it.each(['draft', 'approved', 'sent_back'] as const)('shows no pending approval for %s reports', state => {
    expect(pendingMonthlyApproval({
      state, approverId: 'reviewer', approverName: 'Old Reviewer',
      approvalWorkflow: { currentIndex: 0, stages: [{ level: 1 }] },
    })).toEqual({ level: '—', approver: '—' });
  });
  it('preserves legacy assigned reviewer names without inventing a numeric level', () => {
    expect(pendingMonthlyApproval({ state: 'submitted', approverId: 'legacy', approverName: 'Legacy Reviewer' }))
      .toEqual({ level: 'Single-stage (legacy)', approver: 'Legacy Reviewer' });
  });
  it('uses saved reviewer names as a fallback and labels missing assignments honestly', () => {
    const approvalWorkflow = { currentIndex: 0, stages: [{ level: 2, candidates: [{ id: 'reviewer', name: 'Saved Reviewer' }] }] };
    expect(pendingMonthlyApproval({ state: 'submitted', approverId: 'reviewer', approvalWorkflow }))
      .toEqual({ level: 'Level 2', approver: 'Saved Reviewer' });
    expect(pendingMonthlyApproval({ state: 'submitted', approverId: 'unknown', approvalWorkflow }).approver).toBe('Not available');
  });
});
