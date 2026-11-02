import type { Obj } from './reporting-types';

/** Copy business inputs only, never workflow, input mode or report identity. */
export function copyPreviousDailyData(current: Obj, previous: Obj, canCopy: (key: string) => boolean): Obj {
  const next = { ...current };
  for (const key of ['disciplines', 'documentTypes', 'revisions', 'correspondence', 'rejectedSubmissions', 'pending']) {
    if (canCopy(key) && previous[key] !== undefined) next[key] = structuredClone(previous[key]);
  }
  return next;
}
