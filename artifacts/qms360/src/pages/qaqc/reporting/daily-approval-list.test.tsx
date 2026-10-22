import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { describe, expect, it, vi } from 'vitest';
import { ReportList } from './report-list';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useGetQaqcSowContext: () => ({ data: { projects: [] } }),
  useListQaqcSowReports: mocks.list,
  getListQaqcSowReportsQueryKey: (params: unknown) => ['reports', params],
}));
vi.mock('@/lib/use-qaqc-capabilities', () => ({
  useQaqcCapabilities: () => ({ can: () => false }),
}));
vi.mock('./csat-download-button', () => ({ CsatDownloadButton: () => null }));
vi.mock('./daily-download-button', () => ({ DailyDownloadButton: () => null }));
vi.mock('./shell', () => ({
  REPORT_MODULE: { daily: 'daily_reports', csat: 'csat_reports', monthly: 'monthly_reports' },
  PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Loading: () => null, ErrorBox: () => null, Empty: () => null,
  StateBadge: ({ state }: { state: string }) => <span>{state}</span>,
}));

describe('daily submission approval list', () => {
  it('shows the active daily approval level and assigned reviewer, with a freshness path', () => {
    mocks.list.mockReturnValue({ data: { total: 1, items: [{
      id: 'daily', state: 'submitted', period: '2026-10-22', projectId: 'project',
      approverId: 'senior', approverName: 'Daily Senior',
      approvalWorkflow: { currentIndex: 1, stages: [{ level: 1 }, { level: 2, candidates: [{ id: 'senior', name: 'Daily Senior' }] }] },
    }] } });
    const html = renderToStaticMarkup(<Router ssrPath="/qaqc/daily"><ReportList reportType="daily" /></Router>);
    expect(html).toContain('Pending Approval Level');
    expect(html).toContain('Pending Approver');
    expect(html).toContain('Level 2');
    expect(html).toContain('Daily Senior');
    expect(mocks.list.mock.calls.at(-1)?.[1].query.refetchInterval).toBe(30_000);
  });
  it('does not add sequential approval columns to CSAT', () => {
    mocks.list.mockReturnValue({ data: { total: 1, items: [{ id: 'csat', state: 'submitted', period: '2026-10-22', projectId: 'project' }] } });
    const html = renderToStaticMarkup(<Router ssrPath="/qaqc/csat"><ReportList reportType="csat" /></Router>);
    expect(html).not.toContain('Pending Approval Level');
  });
});
