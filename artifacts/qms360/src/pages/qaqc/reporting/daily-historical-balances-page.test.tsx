// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyHistoricalBalancesPage, type DailyHistProject } from './daily-historical-balances-page';

const state = vi.hoisted(() => ({ projects: [] as DailyHistProject[], canView: true }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { items: state.projects }, refetch: vi.fn(), isLoading: false }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('@/lib/use-qaqc-capabilities', () => ({
  useQaqcCapabilities: () => ({ isLoading: false, can: () => state.canView }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./shell', () => ({
  PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ErrorBox: () => null, useInvalidate: () => vi.fn(), errMsg: String, saveFile: vi.fn(),
}));
// The shared searchable Select has separate interaction tests; exercise its
// value/onValueChange contract here without depending on popover geometry.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) =>
    <select aria-label="Project" value={value} onChange={e => onValueChange(e.target.value)}><option value="">Select project</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

beforeEach(() => {
  state.canView = true;
  state.projects = [
    { id: 'alpha', name: 'Alpha', code: 'A', label: 'A - Alpha', loaded: false, goLiveDate: null },
    { id: 'beta', name: 'Beta', code: 'B', loaded: true, goLiveDate: '2026-10-01' },
    { id: 'gamma', name: 'Gamma', loaded: false, blocked: true, reason: 'Existing Daily Submission', goLiveDate: null },
  ];
});
afterEach(cleanup);
const rows = () => within(screen.getByRole('table')).getAllByRole('row');

describe('Daily historical balance project selection', () => {
  it('lists authorized projects with the same code/name labels as Monthly', () => {
    render(<DailyHistoricalBalancesPage />);
    expect(screen.getByRole('option', { name: 'A - Alpha' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'B - Beta' })).toBeTruthy();
    expect(rows()).toHaveLength(4);
  });

  it('filters status to the selected project and can restore all projects', () => {
    render(<DailyHistoricalBalancesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'beta' } });
    expect(rows()).toHaveLength(2);
    expect(within(rows()[1]).getByText('Loaded')).toBeTruthy();
    expect(within(rows()[1]).queryByText('A - Alpha')).toBeNull();
    // Selecting a project must not remove the multi-project Excel workflow.
    expect(screen.getByText('Multi-project Excel setup')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload Excel to preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    expect(rows()).toHaveLength(4);
  });

  it('keeps blocked projects available for viewing their reason', () => {
    render(<DailyHistoricalBalancesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'gamma' } });
    expect(rows()).toHaveLength(2);
    expect(within(rows()[1]).getByText('Blocked')).toBeTruthy();
    expect(within(rows()[1]).getByText('Existing Daily Submission')).toBeTruthy();
  });

  it('clears the selection if a refreshed scope no longer contains it', () => {
    const view = render(<DailyHistoricalBalancesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'beta' } });
    state.projects = state.projects.filter(p => p.id !== 'beta');
    view.rerender(<DailyHistoricalBalancesPage />);
    expect((screen.getByRole('combobox', { name: 'Project' }) as HTMLSelectElement).value).toBe('');
    expect(rows()).toHaveLength(3);
  });

  it('does not offer project selection without historical view permission', () => {
    state.canView = false;
    render(<DailyHistoricalBalancesPage />);
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
    expect(screen.getByText(/You do not have access/)).toBeTruthy();
  });
});
