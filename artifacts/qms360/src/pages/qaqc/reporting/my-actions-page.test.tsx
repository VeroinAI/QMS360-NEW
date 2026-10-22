import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { MyActionsPage } from './my-actions-page';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useGetCurrentUser: () => ({ data: { id: 'caller' } }),
  getListQaqcSowReportsQueryKey: (params: unknown) => ['/api/qaqc/reporting/reports', params],
  useListQaqcSowReports: mocks.list,
}));
vi.mock('./shell', () => ({
  PageFrame: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main>,
  Empty: ({ text }: any) => <p>{text}</p>,
  ErrorBox: () => <p>Unable to load actions</p>,
  Loading: () => <p>Loading actions</p>,
  StateBadge: ({ state }: any) => <span>{state}</span>,
}));
const render = () => renderToStaticMarkup(<Router ssrPath="/qaqc/my-actions"><MyActionsPage /></Router>);
describe('QA/QC For my action', () => {
  beforeEach(() => mocks.list.mockReset());
  it('requests a caller-specific, paginated action list with freshness', () => {
    mocks.list.mockReturnValue({ data: { total: 1, items: [{ id: 'monthly', projectName: 'My Project', reportType: 'monthly', state: 'submitted', period: '2026-10-01', approvalWorkflow: { currentIndex: 0, stages: [{ level: 2 }] } }] } });
    const html = render();
    expect(html).toContain('For my action');
    expect(html).toContain('/qaqc/metrics/reports/monthly');
    expect(html).toContain('Review / approve');
    expect(html).toContain('Level 2');
    expect(mocks.list.mock.calls[0][0]).toEqual({ myActions: true, page: 1, limit: 20 });
    expect(mocks.list.mock.calls[0][1].query.refetchInterval).toBe(30_000);
    expect(mocks.list.mock.calls[0][1].query.queryKey.at(-1)).toBe('caller');
  });
  it('links draft CSAT and sent-back Daily records to the correct forms', () => {
    mocks.list.mockReturnValue({ data: { total: 2, items: [
      { id: 'survey', reportType: 'csat', state: 'draft', period: '2026-10-22' },
      { id: 'daily', reportType: 'daily', state: 'sent_back', period: '2026-10-22' },
    ] } });
    const html = render();
    expect(html).toContain('/qaqc/csat/survey');
    expect(html).toContain('/qaqc/daily/daily');
    expect(html).toContain('Complete draft');
    expect(html).toContain('Correct and resubmit');
  });
  it('distinguishes an empty queue from an unavailable queue', () => {
    mocks.list.mockReturnValue({ data: { total: 0, items: [] } });
    expect(render()).toContain('No QA/QC items require your action');
    mocks.list.mockReturnValue({ error: new Error('offline') });
    expect(render()).toContain('Unable to load actions');
    expect(render()).not.toContain('No QA/QC items');
  });
});
