import { ChevronDown } from 'lucide-react';
import { NumField, getIn, useForm } from './form-kit';
import { ENTITIES, PEND_BUCKETS, PEND_STATUSES, num } from './reporting-types';

const bucketLabels: Record<string, string> = { upTo7: '≤7 days', days8To30: '8–30 days', over30: '≥31 days' };

export function PendingDays() {
  const f = useForm();
  return <details open className="group rounded-xl border bg-card text-card-foreground shadow-sm">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 text-base font-semibold [&::-webkit-details-marker]:hidden">
      7. Submission Review — Pending Days<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="overflow-x-auto px-6 pb-6">
      <table className="w-full min-w-[680px] text-sm" aria-label="Submission Review — Pending Days">
        <thead><tr>
          <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Entity</th>
          <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Bucket</th>
          {PEND_BUCKETS.map(([key]) => <th key={key} scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">{bucketLabels[key]}</th>)}
          <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Total</th>
        </tr></thead>
        {ENTITIES.map(entity => <tbody key={entity}>
          {PEND_STATUSES.map(([status, label], i) => <tr key={status} className="border-t">
            {i === 0 && <th scope="rowgroup" rowSpan={PEND_STATUSES.length} className="px-2 py-3 text-left align-top font-medium">{entity}</th>}
            <th scope="row" className="whitespace-nowrap px-2 py-3 text-left text-xs font-normal text-muted-foreground">{status === 'underReview' ? 'UNDER REVIEW' : `STATUS ${label}`}</th>
            {PEND_BUCKETS.map(([bucket, bucketLabel]) => <td key={bucket} className="px-2 py-2 [&_input]:h-9 [&_input]:w-full">
              <NumField bare path={['pending', entity, status, bucket]} label={`${entity} ${label} ${bucketLabel} current`} />
            </td>)}
            <td className="px-2 py-2 font-medium" aria-label={`${entity} ${label} total`} aria-live="polite">
              {PEND_BUCKETS.reduce((sum, [bucket]) => sum + num(getIn(f.data, ['pending', entity, status, bucket])), 0)}
            </td>
          </tr>)}
        </tbody>)}
      </table>
    </div>
  </details>;
}
