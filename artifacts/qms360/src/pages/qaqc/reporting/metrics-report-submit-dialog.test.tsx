// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsReportSubmitDialog } from './metrics-report-submit-dialog';
import { workflowConfirmationMessage } from '@/lib/workflow-confirmation';
const confirmName = workflowConfirmationMessage('submit', 'this QA/QC report').confirmLabel;
const state = vi.hoisted(() => ({ allowed: true, status: 'draft', issues: [] as string[], mutate: vi.fn(), invalidate: vi.fn(), toast: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useGetCurrentUser: () => ({ data: { id: 'submitter-not-creator' } }),
  useGetQaqcSowReport: () => ({ data: { id: 'report', reportType: 'monthly', state: state.status, createdById: 'original-creator', projectId: 'project-a', period: '2026-09-01', data: { assessmentConfirmed: true } } }),
  useGetQaqcSowContext: () => ({ data: { approvers: [{ id: 'approver', fullName: 'First reviewer' }], approvalStages: [], approvalErrors: [], baseline: {} } }),
  useSubmitQaqcSowReport: () => ({ mutate: state.mutate, isPending: false }),
  getGetQaqcSowReportQueryKey: () => ['report'], getGetQaqcSowContextQueryKey: () => ['context'],
}));
vi.mock('@/lib/use-qaqc-capabilities', () => ({ useQaqcCapabilities: () => ({ can: (_: string, operation: string) => operation === 'submit' && state.allowed }) }));
vi.mock('@/lib/field-controls', () => ({ useFieldControls: () => ({ fieldProps: () => ({ disabled: false }) }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('./shell', () => ({ useInvalidate: () => state.invalidate, Loading: () => null, ErrorBox: () => null, errMsg: String }));
vi.mock('./metrics-entry-validation', () => ({ normaliseMetricsEntry: (v: unknown) => v, validateMetricsEntry: () => state.issues }));
vi.mock('./monthly-approval', () => ({ MonthlyApprovalPreview: () => null }));
beforeEach(() => { vi.clearAllMocks(); state.allowed = true; state.status = 'draft'; state.issues = []; });
afterEach(cleanup);
describe('Monthly submission by a different authorized user', () => {
  it('submits the saved report without requiring edit rights or changing the creator', () => {
    const onSubmitted = vi.fn();
    render(<MetricsReportSubmitDialog id="report" onClose={vi.fn()} onSubmitted={onSubmitted} />);
    const button = screen.getByRole('button', { name: confirmName });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(state.mutate).toHaveBeenCalledWith({ id: 'report', data: { approverId: 'approver' } }, expect.any(Object));
    state.mutate.mock.calls[0][1].onSuccess();
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
  it('does not authorize submission without the Submit activity grant', () => {
    state.allowed = false;
    render(<MetricsReportSubmitDialog id="report" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    expect((screen.getByRole('button', { name: confirmName }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('retains complete-document validation', () => {
    state.issues = ['Missing required monthly data'];
    render(<MetricsReportSubmitDialog id="report" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    expect((screen.getByRole('button', { name: confirmName }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Missing required monthly data')).toBeTruthy();
  });
});
