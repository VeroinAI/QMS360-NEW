import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Keep the existing action in its tile; show a shortcut only while it is offscreen. */
export function ReportSubmitAction({ allowFloating, disabled, onClick, label, className }: {
  allowFloating: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  const inlineAction = useRef<HTMLButtonElement>(null);
  const [outsideViewport, setOutsideViewport] = useState(false);

  useEffect(() => {
    const target = inlineAction.current;
    setOutsideViewport(false);
    if (!allowFloating || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setOutsideViewport(!entry.isIntersecting || entry.intersectionRatio < 1);
    }, { threshold: [0, 1] });
    observer.observe(target);
    return () => observer.disconnect();
  }, [allowFloating]);

  return <>
    <Button ref={inlineAction} type="button" className={className} variant="outline"
      disabled={disabled} onClick={onClick} data-testid="button-report-submit">
      <Send className="mr-2 size-4" />{label}
    </Button>
    {allowFloating && outsideViewport && <div
      className="pointer-events-none fixed left-4 right-24 z-30 flex justify-end"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <Button type="button" className="pointer-events-auto h-auto min-h-10 whitespace-normal border border-primary-foreground/20 px-5 py-3 shadow-lg"
        disabled={disabled} onClick={onClick} data-testid="button-floating-report-submit">
        <Send className="mr-2 size-4 shrink-0" />{label}
      </Button>
    </div>}
  </>;
}
