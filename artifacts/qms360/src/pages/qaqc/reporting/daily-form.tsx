import { ChevronDown } from 'lucide-react';
import { formatDate } from '@workspace/spreadsheet-dates';
import { usesDailyAdditions, usesDailySupplementAdditions } from '@workspace/field-controls';
import { Input } from '@/components/ui/input';
import { NumField, Section, getIn, useForm } from './form-kit';
import { calcDaily, DISCIPLINES, DISC_STATUSES, DOC_TYPES, DOC_TYPE_LABELS, LEGACY_DOC_TYPES, REJECTED_SUBMISSION_TYPES, type Obj } from './reporting-types';
import { ApprovedRevisions } from './approved-revisions';
import { DailyCountTile } from './daily-count-tile';
import { PendingDays } from './pending-days';

type Calc = ReturnType<typeof calcDaily>;
const disciplineOrder = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Instrumentation'];
const displayDisciplines = [...DISCIPLINES].sort((a, b) => disciplineOrder.indexOf(a) - disciplineOrder.indexOf(b));

export function DailyForm({ calc, baseline, period }: { calc: Calc; baseline: Obj; period?: string }) {
  const f = useForm();
  const currentLabel = period ? `Current Date (${formatDate(period)})` : 'Current Date';
  const prevCalc = calcDaily(baseline ?? {});
  const bp = (p: (string | number)[]) => getIn(baseline, p);
  const documentTypes = [...DOC_TYPES, ...LEGACY_DOC_TYPES.filter(t =>
    getIn(f.data, ['documentTypes', t]) !== undefined || bp(['documentTypes', t]) !== undefined)];
  return <div className="space-y-6">
    {baseline.dailyDisciplineLegacyPrevious && usesDailyAdditions(f.data) && <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The previous report uses the legacy cumulative-entry format. Its saved Current Date values are retained as the cumulative balance. If they were actually daily additions, a reviewed historical correction is required before they can be accumulated.</p>}
    <Section title="2. Daily Submission - Drawings and Submittals by Discipline" description={usesDailyAdditions(f.data)
      ? "Enter only the counts added on the selected day in Current Date. Yesterday is the cumulative balance through the prior reporting date, including historical opening balances. Next day’s Yesterday = Yesterday + Current Date. Total is calculated from the four status counts."
      : "Enter cumulative figures through the selected date in Current Date. Till yesterday is the previous day's submitted cumulative balance (or the go-live opening balance for the first report). Do not add Till yesterday again. Total is calculated from the four status counts."}>
      {(['drawings', 'submittals'] as const).map(cat => {
        const categoryLabel = cat === 'drawings' ? 'Drawings' : 'Submittals';
        const overall = (source: Calc) => DISCIPLINES.reduce((total, discipline) => total + (source.disc[`${cat}.${discipline}`]?.total ?? 0), 0);
        return <div key={cat} className="space-y-4" data-testid={`daily-disciplines-${cat}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{categoryLabel}</h3>
            <p className="text-xs text-muted-foreground" aria-live="polite">{categoryLabel} overall total — Yesterday {overall(prevCalc)} · Current {overall(calc)}</p>
          </div>
          {displayDisciplines.map(d => <div key={d} className="rounded-lg border bg-muted/10 p-3">
            <h4 className="mb-3 text-sm font-semibold text-primary">{d}</h4>
            <div className="overflow-x-auto"><table className="w-full min-w-[360px] table-fixed text-sm" aria-label={`${d} ${categoryLabel}`}>
              <thead><tr><th scope="col" className="w-2/5 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Metric</th><th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Till yesterday</th><th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">{currentLabel} <span aria-hidden="true">*</span></th></tr></thead>
              <tbody>
                <tr className="border-t bg-primary/5"><th scope="row" className="px-2 py-2 text-left font-medium">Total (auto)</th>
                  <td className="px-2 py-2"><Input aria-label={`${d} ${cat} total yesterday`} readOnly className="bg-muted/50 text-muted-foreground" value={prevCalc.disc[`${cat}.${d}`]?.total ?? 0} /></td>
                  <td className="px-2 py-2"><Input aria-label={`${d} ${cat} total current`} readOnly className="bg-muted/50 font-semibold" value={calc.disc[`${cat}.${d}`]?.total ?? 0} /></td>
                </tr>
                {DISC_STATUSES.map(([s, l]) => <tr key={s} className="border-t">
                  <th scope="row" className="px-2 py-2 text-left font-normal">{s === 'underReview' ? 'Under Review' : l}</th>
                  <td className="px-2 py-2"><Input aria-label={`${d} ${cat} ${l} yesterday`} readOnly className="bg-muted/50 text-muted-foreground" value={bp(['disciplines', cat, d, s]) ?? 0} /></td>
                  <td className="px-2 py-2 [&_input]:h-9 [&_input]:w-full"><NumField bare path={['disciplines', cat, d, s]} label={`${d} ${cat} ${l} current`} /></td>
                </tr>)}
              </tbody>
            </table></div>
          </div>)}
        </div>;
      })}
    </Section>
    <details open className="group rounded-xl border bg-card text-card-foreground shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 text-base font-semibold [&::-webkit-details-marker]:hidden">
        3. Document Types<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 px-6 pb-6">
        <p className="text-sm font-medium">Documents by Type (cumulative)</p>
        <p className="text-xs text-muted-foreground">{usesDailySupplementAdditions(f.data)
          ? 'For tiles 3–6, enter only additions for the selected day. Yesterday includes historical opening balances and all previous submitted daily additions. Next day’s Yesterday = Yesterday + Current Date. Enter 0 when there are no additions.'
          : 'For tiles 3–6, enter cumulative figures through the selected date. Till yesterday comes from the previous day’s submitted report; it is not added to Current Date.'}</p>
        {baseline.dailySupplementLegacyPrevious && usesDailySupplementAdditions(f.data) && <p role="note" className="text-xs text-amber-800">The previous report’s tiles 3–6 use the legacy cumulative format. Their saved balances are retained; historical daily additions require a reviewed correction before they can be accumulated.</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[360px] table-fixed text-sm" aria-label="Documents by Type (cumulative)">
          <thead><tr>
            <th scope="col" className="w-1/4 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Document Type</th>
            <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Till yesterday</th>
            <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">{currentLabel} <span aria-hidden="true">*</span></th>
          </tr></thead>
          <tbody>{documentTypes.map(t => {
            const label = DOC_TYPE_LABELS[t] ?? t;
            const legacy = LEGACY_DOC_TYPES.includes(t);
            return <tr key={t} className="border-t">
              <th scope="row" className="px-2 py-2 text-left font-normal">{label}{legacy && <span className="ml-1 text-xs text-muted-foreground">(previously saved)</span>}</th>
              <td className="px-2 py-2"><Input aria-label={`${label} yesterday`} readOnly className="bg-muted/50 text-muted-foreground" value={bp(['documentTypes', t]) ?? 0} /></td>
              <td className="px-2 py-2 [&_input]:h-9 [&_input]:w-full"><NumField bare path={['documentTypes', t]} label={`${label} current`} /></td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className="text-xs text-muted-foreground">Discipline progress on the dashboard is derived automatically from the discipline blocks above.</p>
      </div>
    </details>
    <ApprovedRevisions baseline={baseline} period={period} />
    <DailyCountTile index={5} title="Correspondence" field="correspondence" rows={[['outgoing', 'Outgoing'], ['incoming', 'Incoming']]} baseline={baseline} period={period} />
    <DailyCountTile index={6} title="Rejected Submissions" field="rejectedSubmissions" rows={REJECTED_SUBMISSION_TYPES} baseline={baseline} period={period} />
    <PendingDays />
  </div>;
}
