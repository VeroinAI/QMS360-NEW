import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsReportList, monthInputToPeriod, pqpStatusLabel } from './metrics-report-list';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), context: vi.fn(), read: true, edit: false, download: false,
}));
vi.mock('@workspace/api-client-react', () => ({
  useListQaqcSowReports: mocks.list,
  useGetQaqcSowContext: mocks.context,
  getListQaqcSowReportsQueryKey: (params: unknown) => ['reports', params],
  getGetQaqcSowContextQueryKey: (params: unknown) => ['context', params],
  exportQaqcSowReport: vi.fn(),
}));
vi.mock('@/lib/use-qaqc-capabilities', () => ({
  useQaqcCapabilities: () => ({
    isLoading: false, canAnyRead: () => mocks.read,
    can: (_module: string, operation: string) => operation === 'create_edit' ? mocks.edit : mocks.download,
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const render = () => renderToStaticMarkup(<Router ssrPath="/qaqc/metrics"><MetricsReportList /></Router>);

describe('Monthly metrics landing report list', () => {
  beforeEach(() => {
    mocks.list.mockReset(); mocks.context.mockReset();
    mocks.read = true; mocks.edit = false; mocks.download = false;
    mocks.context.mockReturnValue({ data: { projects: [{ id: 'project-a', name: 'Project Alpha' }] } });
    mocks.list.mockReturnValue({ data: { items: [
      { id: 'draft-report', projectId: 'project-a', projectName: 'Project Alpha', period: '2026-09-01', state: 'draft', data: { pqpStatus: 'Under Preparation' } },
      { id: 'submitted-report', projectId: 'project-a', projectName: 'Project Alpha', period: '2026-08-01', state: 'submitted', data: { pqpStatus: 'Approved A', pqpSubmittedDate: '2026-08-10' } },
      { id: 'returned-report', projectId: 'project-a', projectName: 'Project Alpha', period: '2026-07-01', state: 'sent_back', data: {} },
    ], total: 3 } });
  });
  it('uses server-side monthly RBAC listing and displays the requested metadata columns', () => {
    const html = render();
    for (const label of ['Project Name', 'Month / Year', 'PQP Status', 'PQP Submission Date', 'Status', 'Project Alpha', 'Approved A'])
      expect(html).toContain(label);
    expect(mocks.list.mock.calls[0][0]).toEqual({ reportType: 'monthly', page: 1, limit: 20 });
    expect(mocks.list.mock.calls[0][1].query.enabled).toBe(true);
    expect(html).toContain('filter-project');
    expect(html).toContain('type="month"');
  });
  it('offers only Display to read-only users, including draft rows', () => {
    const html = render();
    expect(html).toContain('/draft-report?mode=view');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('>Download<');
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
});
