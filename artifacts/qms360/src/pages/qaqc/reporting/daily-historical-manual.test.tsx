// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyHistoricalManual, manualOpeningData } from './daily-historical-manual';
import { saveDailyOpeningManual } from '@workspace/api-client-react';
vi.mock('@workspace/api-client-react', () => ({ saveDailyOpeningManual: vi.fn() }));
vi.mock('./shell', () => ({ errMsg: (e: Error) => e.message }));
const fields = [{ key: 'correspondence.incoming', label: 'Correspondence / incoming' }];
const props = {
  project: { id: 'project-a', name: 'Project A', loaded: false, goLiveDate: null },
  fields, goLiveDate: '2026-09-19', balancesAsOf: '2026-09-18',
  disabled: false, onBusyChange: vi.fn(), onSaved: vi.fn(),
};
function mount(overrides: Partial<Parameters<typeof DailyHistoricalManual>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><DailyHistoricalManual {...props} {...overrides} /></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveDailyOpeningManual).mockResolvedValue({ applied: 1 }); });
afterEach(cleanup);
describe('Daily manual source validation', () => {
  it('preserves zero and builds nested source counts and revisions', () => {
    expect(manualOpeningData(fields, { 'correspondence.incoming': '0' }, { drawings: [{ name: ' A ', value: '12' }], submittals: [] })).toEqual({
      errors: [], data: { correspondence: { incoming: 0 }, revisions: { drawings: [{ name: 'A', value: 12 }], submittals: [] } },
    });
  });
  it.each(['', '-1', '0.5', '1e2', '9007199254740992'])('rejects missing or invalid whole counts %s', value => {
    expect(manualOpeningData(fields, { 'correspondence.incoming': value }, { drawings: [], submittals: [] }).errors.length).toBeGreaterThan(0);
  });
  it('rejects duplicate or blank revision names and invalid revision counts', () => {
    const result = manualOpeningData(fields, { 'correspondence.incoming': '1' }, { drawings: [{ name: 'A', value: '1' }, { name: ' a ', value: '-2' }], submittals: [{ name: '', value: '' }] });
    expect(result.errors.join()).toMatch(/unique/);
    expect(result.errors.join()).toMatch(/whole number/);
  });
});
describe('Daily manual entry', () => {
  it('requires a date, all source counts and a reason before confirmation', () => {
    mount({ goLiveDate: '', balancesAsOf: null });
    expect((screen.getByRole('button', { name: 'Review manual balances' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not save until confirmation and submits the selected project, cutoff and real input', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Correspondence / incoming *'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Load reason *'), { target: { value: 'Go-live source records' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review manual balances' }));
    expect(saveDailyOpeningManual).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(saveDailyOpeningManual).toHaveBeenCalledWith({
      confirmed: true, projectId: 'project-a', goLiveDate: '2026-09-19', reason: 'Go-live source records',
      data: { correspondence: { incoming: 12 }, revisions: { drawings: [], submittals: [] } },
    });
    expect(props.onBusyChange).toHaveBeenCalledWith(true);
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it('validates blanks instead of treating them as zero; explicit zero-fill is available', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review manual balances' }));
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/);
    fireEvent.click(screen.getByRole('button', { name: 'Fill empty counts with 0' }));
    expect((screen.getByLabelText('Correspondence / incoming *') as HTMLInputElement).value).toBe('0');
    expect(saveDailyOpeningManual).not.toHaveBeenCalled();
  });
  it('shows a failed save without losing entered balances or claiming success', async () => {
    vi.mocked(saveDailyOpeningManual).mockRejectedValue(new Error('Project already loaded'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Fill empty counts with 0' }));
    fireEvent.change(screen.getByLabelText('Load reason *'), { target: { value: 'Go-live source records' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review manual balances' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Nothing was saved/));
    expect(props.onSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Correspondence / incoming *') as HTMLInputElement).value).toBe('0');
  });
  it('keeps previously loaded or blocked projects read-only', () => {
    mount({ project: { ...props.project, blocked: true, reason: 'Existing Daily Submission' } });
    expect(screen.getByText('Existing Daily Submission')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review manual balances' })).toBeNull();
  });
});
