import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';

const state = vi.hoisted(() => ({
  projectId: 'alpha-project', serverToday: '2026-10-22' as string | undefined,
  error: null as Error | null,
  requests: [] as Array<{ params: any; enabled: boolean }>,
}));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => initial === ''
    ? [state.projectId, vi.fn()] : actual.useState(initial) };
});
vi.mock('@workspace/api-client-react', () => ({
  getGetQaqcSowContextQueryKey: (params: unknown) => ['/api/qaqc/reporting/context', params],
  useGetQaqcSowContext: (params: any, options: any) => {
    state.requests.push({ params, enabled: options.query.enabled });
    return {
      data: params?.projectId
        ? { targets: { external_ncr: 85, internal_ncr: 0, rfi: 97.5, rmi: 90, pqi: 95 } }
        : { serverToday: state.serverToday, projects: [{ id: 'alpha-project', name: 'Alpha District Development' }] },
      error: params?.projectId ? state.error : null,
      isLoading: false, refetch: vi.fn(),
    };
  },
}));
// Render closed-menu options too, so project-list availability can be asserted
// without relying on Radix's client-only portal lifecycle.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/lib/field-controls', () => ({ useIsAdmin: () => true }));
vi.mock('@/lib/use-qaqc-capabilities', () => ({
  useQaqcCapabilities: () => ({ canTask: () => true, can: () => true }),
}));
vi.mock('./shell', () => ({
  PageFrame: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main>,
  Loading: () => <div>Loading</div>,
  ErrorBox: ({ error }: any) => <div role="alert">{error.message}</div>,
}));
import { SettingsPage } from './settings-page';

function render() {
  return renderToStaticMarkup(<Router ssrPath="/qaqc/settings"><SettingsPage /></Router>);
}
beforeEach(() => {
  state.projectId = 'alpha-project'; state.serverToday = '2026-10-22';
  state.error = null; state.requests = [];
});
describe('Reporting Settings project lookup period', () => {
  it('pins selected-project requests to the server current month instead of report-entry defaults', () => {
    const html = render();
    const request = state.requests.find(request => request.params?.projectId === 'alpha-project');
    expect(request).toEqual({ params: { projectId: 'alpha-project', reportType: 'monthly', period: '2026-10-01' }, enabled: true });
    expect(html).toContain('85%');
    expect(html).toContain('0%');
    expect(html).toContain('97.5%');
    expect(html).toContain('Read-only');
    expect(html).not.toContain('Reporting period cannot be in the future');
  });
  it('uses the server month across a year boundary, never the browser clock', () => {
    state.serverToday = '2027-01-01'; render();
    expect(state.requests.find(request => request.params?.projectId)?.params.period).toBe('2027-01-01');
  });
  it('waits for the server date before fetching selected-project context', () => {
    state.serverToday = undefined; render();
    expect(state.requests.find(request => request.params?.projectId)?.enabled).toBe(false);
  });
  it('does not fetch project context until a project is selected', () => {
    state.projectId = ''; render();
    expect(state.requests.filter(request => request.enabled)).toEqual([{ params: undefined, enabled: true }]);
  });
  it('preserves project choices on project-context failure so the user can retry or select another project', () => {
    state.error = new Error('Temporary request error');
    const html = render();
    expect(html).toContain('Alpha District Development');
    expect(html).toContain('Temporary request error');
    expect(html).not.toContain('tile-closure-target-readonly');
  });
});
