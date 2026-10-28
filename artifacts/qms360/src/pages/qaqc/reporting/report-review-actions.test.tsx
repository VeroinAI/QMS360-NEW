// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportReviewActions } from './report-review-actions';

let callback: IntersectionObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
const props = {
  allowFloating: true, approveLabel: 'Approve & forward', disabled: false,
  onApprove: vi.fn(), onSendBack: vi.fn(),
};
function visibility(isIntersecting: boolean, intersectionRatio: number) {
  act(() => callback([{ isIntersecting, intersectionRatio } as IntersectionObserverEntry], {} as IntersectionObserver));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('QA/QC and Daily floating review actions', () => {
  it.each(['Approve & forward', 'Approve'])('floats both actions with the existing %s label and handlers', approveLabel => {
    render(<ReportReviewActions {...props} approveLabel={approveLabel} />);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('report-review-actions'));
    visibility(false, 0);
    const floating = within(screen.getByRole('group', { name: 'Report review shortcuts' }));
    fireEvent.click(floating.getByRole('button', { name: approveLabel }));
    fireEvent.click(floating.getByRole('button', { name: 'Send back' }));
    expect(props.onApprove).toHaveBeenCalledTimes(1);
    expect(props.onSendBack).toHaveBeenCalledTimes(1);
    const inline = within(screen.getByTestId('report-review-actions'));
    fireEvent.click(inline.getByRole('button', { name: approveLabel }));
    fireEvent.click(inline.getByRole('button', { name: 'Send back' }));
    expect(props.onApprove).toHaveBeenCalledTimes(2);
    expect(props.onSendBack).toHaveBeenCalledTimes(2);
  });
  it('hides shortcuts only when both inline actions are fully visible and restores on scrolling away', () => {
    render(<ReportReviewActions {...props} />);
    visibility(true, 0.5);
    expect(screen.queryByTestId('floating-report-review-actions')).toBeTruthy();
    visibility(true, 1);
    expect(screen.queryByTestId('floating-report-review-actions')).toBeNull();
    visibility(false, 0);
    expect(screen.queryByTestId('floating-report-review-actions')).toBeTruthy();
  });
  it('disables both copies during review and never submits a surrounding form directly', () => {
    const view = render(<ReportReviewActions {...props} />);
    visibility(false, 0);
    view.rerender(<ReportReviewActions {...props} disabled />);
    for (const button of screen.getAllByRole('button') as HTMLButtonElement[]) {
      expect(button.disabled).toBe(true);
      expect(button.type).toBe('button');
      fireEvent.click(button);
    }
    expect(props.onApprove).not.toHaveBeenCalled();
    expect(props.onSendBack).not.toHaveBeenCalled();
  });
  it('hides shortcuts and disconnects while a confirmation is open', () => {
    const view = render(<ReportReviewActions {...props} />);
    visibility(false, 0);
    view.rerender(<ReportReviewActions {...props} allowFloating={false} />);
    expect(screen.queryByTestId('floating-report-review-actions')).toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
  it('preserves non-floating actions on other forms', () => {
    render(<ReportReviewActions {...props} allowFloating={false} />);
    expect(observe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('floating-report-review-actions')).toBeNull();
  });
  it('disconnects when authorization or workflow changes unmount the actions', () => {
    const view = render(<ReportReviewActions {...props} />);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('keeps inline review actions usable without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<ReportReviewActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(props.onSendBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('floating-report-review-actions')).toBeNull();
  });
});
