import type { RefObject } from 'react';
import type { DailyValidationIssue } from './reporting-types';

/** Open native details ancestors without changing values or bypassing field locks. */
export function jumpToDailyIssue(root: HTMLElement, path: string): boolean {
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-report-field]'))
    .find(element => element.dataset.reportField === path);
  if (!target) return false;
  for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    if (!target.matches(':disabled') && !target.hasAttribute('readonly')) target.focus({ preventScroll: true });
    else {
      const container = target.parentElement ?? target;
      container.tabIndex = -1;
      container.focus({ preventScroll: true });
    }
  });
  return true;
}

export function DailyValidationIssues({ issues, rootRef }: {
  issues: DailyValidationIssue[]; rootRef: RefObject<HTMLElement | null>;
}) {
  if (!issues.length) return <p className="text-muted-foreground">No issues found in the live preview. The server validates again on submit.</p>;
  return <>
    <p className="mb-2 text-xs text-muted-foreground">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}. Select an issue to go to its field.</p>
    <ul className="max-h-96 list-disc space-y-2 overflow-y-auto pl-4 pr-2 text-destructive" aria-label="Daily report validation issues">
      {issues.map(issue => <li key={issue.path}>
        <button type="button" className="text-left underline underline-offset-2 hover:text-destructive/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => { if (rootRef.current) jumpToDailyIssue(rootRef.current, issue.path); }}>{issue.message}</button>
      </li>)}
    </ul>
  </>;
}
