// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportSubmitAction } from './report-submit-action';

let callback: IntersectionObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
const props = { allowFloating: true, disabled: false, onClick: vi.fn(), label: 'Submit for Approval' };
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

describe('Monthly Metrics floating submit action', () => {
  it('keeps the original tile action and observes its visibility', () => {
    render(<ReportSubmitAction {...props} />);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('button-report-submit'));
    visibility(true, 1);
    expect(screen.queryByTestId('button-floating-report-submit')).toBeNull();
  });
  it('shows the floating shortcut while the original is offscreen and uses the same action', () => {
    render(<ReportSubmitAction {...props} />);
    visibility(false, 0);
    fireEvent.click(screen.getByTestId('button-floating-report-submit'));
    expect(props.onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('button-report-submit'));
    expect(props.onClick).toHaveBeenCalledTimes(2);
  });
  it('removes the shortcut when scrolling to the action tile and restores it when leaving', () => {
    render(<ReportSubmitAction {...props} />);
    visibility(false, 0);
    expect(screen.getAllByRole('button', { name: 'Submit for Approval' })).toHaveLength(2);
    visibility(true, 1);
    expect(screen.getAllByRole('button', { name: 'Submit for Approval' })).toHaveLength(1);
    visibility(false, 0);
    expect(screen.getByTestId('button-floating-report-submit')).toBeTruthy();
  });
  it('keeps the shortcut until the normal button is completely visible', () => {
    render(<ReportSubmitAction {...props} />);
    visibility(true, 0.5);
    expect(screen.getByTestId('button-floating-report-submit')).toBeTruthy();
  });
  it('applies existing validation and pending-state disabling to both buttons', () => {
    const view = render(<ReportSubmitAction {...props} />);
    visibility(false, 0);
    view.rerender(<ReportSubmitAction {...props} disabled />);
    for (const id of ['button-report-submit', 'button-floating-report-submit']) {
      const button = screen.getByTestId(id) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(props.onClick).not.toHaveBeenCalled();
  });
  it('does not float on other forms', () => {
    render(<ReportSubmitAction {...props} allowFloating={false} />);
    expect(observe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('button-floating-report-submit')).toBeNull();
    fireEvent.click(screen.getByTestId('button-report-submit'));
    expect(props.onClick).toHaveBeenCalledTimes(1);
  });
  it('hides the shortcut while a dialog is open and disconnects the observer', () => {
    const view = render(<ReportSubmitAction {...props} />);
    visibility(false, 0);
    view.rerender(<ReportSubmitAction {...props} allowFloating={false} />);
    expect(screen.queryByTestId('button-floating-report-submit')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });
  it('disconnects on unmount', () => {
    const view = render(<ReportSubmitAction {...props} />);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('keeps the inline action usable if the browser cannot observe intersections', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<ReportSubmitAction {...props} />);
    expect(screen.queryByTestId('button-floating-report-submit')).toBeNull();
    fireEvent.click(screen.getByTestId('button-report-submit'));
    expect(props.onClick).toHaveBeenCalledTimes(1);
  });
});
