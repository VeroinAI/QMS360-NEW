import { useState } from 'react';

export function resolveMonthlyApprover(candidateIds: string[], selectedId = ''): string {
  if (candidateIds.length === 1) return candidateIds[0];
  return candidateIds.includes(selectedId) ? selectedId : '';
}

/** Keep manual choices only for the same dialog session and eligible audience. */
export function useMonthlyApproverSelection(candidateIds: string[], scope: string) {
  const key = JSON.stringify([scope, [...candidateIds].sort()]);
  const [selection, setSelection] = useState({ key, id: '' });
  if (selection.key !== key) setSelection({ key, id: '' });
  const selectedId = selection.key === key ? selection.id : '';
  return [
    resolveMonthlyApprover(candidateIds, selectedId),
    (id: string) => setSelection({ key, id }),
  ] as const;
}
