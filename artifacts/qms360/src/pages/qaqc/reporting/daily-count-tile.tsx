import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NumField, getIn } from './form-kit';
import type { Obj } from './reporting-types';

export function DailyCountTile({ title, field, rows, baseline }: {
  title: string; field: string; rows: readonly (readonly [string, string])[]; baseline: Obj;
}) {
  return <details open className="group rounded-xl border bg-card text-card-foreground shadow-sm">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 text-base font-semibold [&::-webkit-details-marker]:hidden">
      {title}<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="overflow-x-auto px-6 pb-6"><table className="w-full min-w-[360px] table-fixed text-sm" aria-label={title}>
      <thead><tr>
        <th scope="col" className="w-1/6 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
        <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Yesterday (auto)</th>
        <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Current Date <span aria-hidden="true">*</span></th>
      </tr></thead>
      <tbody>{rows.map(([key, label], i) => <tr key={key} className={`border-t ${i % 2 ? 'bg-muted/20' : ''}`}>
        <th scope="row" className="px-2 py-2 text-left font-normal">{label}</th>
        <td className="px-2 py-2"><Input aria-label={`${title} ${label} yesterday`} readOnly className="bg-muted/50 text-muted-foreground" value={getIn(baseline, [field, key]) ?? 0} /></td>
        <td className="px-2 py-2 [&_input]:h-9 [&_input]:w-full"><NumField bare path={[field, key]} label={`${title} ${label} current`} /></td>
      </tr>)}</tbody>
    </table></div>
  </details>;
}
