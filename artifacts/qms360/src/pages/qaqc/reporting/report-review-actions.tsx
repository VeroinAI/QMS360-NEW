import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Shortcuts use the same decision handlers as the existing review tile. */
export function ReportReviewActions({ allowFloating, approveLabel, disabled, onApprove, onSendBack }: {
  allowFloating: boolean;
  approveLabel: string;
  disabled: boolean;
  onApprove: () => void;
  onSendBack: () => void;
}) {
  const inlineActions = useRef<HTMLDivElement>(null);
  const [outsideViewport, setOutsideViewport] = useState(false);

  useEffect(() => {
    setOutsideViewport(false);
    const target = inlineActions.current;
    if (!allowFloating || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setOutsideViewport(!entry.isIntersecting || entry.intersectionRatio < 1);
    }, { threshold: [0, 1] });
    observer.observe(target);
    return () => observer.disconnect();
  }, [allowFloating]);

  return <>
    <div ref={inlineActions} className="w-full space-y-3" data-testid="report-review-actions">
      <Button type="button" className="w-full" disabled={disabled} onClick={onApprove}>{approveLabel}</Button>
      <Button type="button" className="w-full" variant="outline" disabled={disabled} onClick={onSendBack}>Send back</Button>
    </div>
    {allowFloating && outsideViewport && <div
      className="pointer-events-none fixed left-4 right-24 z-30 flex justify-end"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div role="group" aria-label="Report review shortcuts" data-testid="floating-report-review-actions"
        className="pointer-events-auto flex max-w-full flex-wrap justify-end gap-2 rounded-lg border bg-background p-2 shadow-lg">
        <Button type="button" className="h-auto whitespace-normal" disabled={disabled} onClick={onApprove}>{approveLabel}</Button>
        <Button type="button" className="h-auto whitespace-normal" variant="outline" disabled={disabled} onClick={onSendBack}>Send back</Button>
      </div>
    </div>}
  </>;
}
