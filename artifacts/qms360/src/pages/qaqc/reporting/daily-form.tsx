import { Fragment, type ReactNode } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumField, Section, getIn, useForm } from './form-kit';
import { calcDaily, DISCIPLINES, DISC_STATUSES, DOC_TYPES, DOC_TYPE_LABELS, LEGACY_DOC_TYPES, ENTITIES, PEND_BUCKETS, PEND_STATUSES, num, type Obj } from './reporting-types';

type Calc = ReturnType<typeof calcDaily>;
const disciplineOrder = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Instrumentation'];
const displayDisciplines = [...DISCIPLINES].sort((a, b) => disciplineOrder.indexOf(a) - disciplineOrder.indexOf(b));
const Prev = ({ v }: { v: unknown }) => <span className="inline-flex h-8 w-20 items-center justify-end rounded-md border bg-muted/50 px-2 text-sm text-muted-foreground" title="Yesterday (read-only)">{v === undefined || v === null ? '-' : String(v)}</span>;
const Tot = ({ v }: { v: number }) => <span className="inline-flex h-8 w-20 items-center justify-end px-2 text-sm font-semibold">{v}</span>;
const th = 'px-2 py-2 text-right text-xs font-medium text-muted-foreground';
const pair = (label: string) => <th colSpan={2} className="px-2 pt-2 text-center text-xs font-medium">{label}</th>;
const sub = <><th className={th}>Yesterday</th><th className={th}>Current</th></>;

function Revisions({ cat, baseline }: { cat: 'drawings' | 'submittals'; baseline: Obj }) {
  const f = useForm();
  const rows: Obj[] = f.data.revisions?.[cat] ?? [];
  const prior: Obj[] = baseline?.revisions?.[cat] ?? [];
  const names = new Set(rows.map(r => String(r.name ?? '').trim().toLowerCase()));
  const path = ['revisions', cat];
  const priorVal = (name: string) => prior.find(p => String(p.name).toLowerCase() === String(name ?? '').trim().toLowerCase())?.value;
  return <div className="space-y-2"><p className="text-sm font-medium capitalize">{cat} revisions</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Revision</th>{sub}<th /></tr></thead><tbody>
      {prior.filter(p => !names.has(String(p.name).trim().toLowerCase())).map((p, i) => <tr key={`p${i}`} className="border-t"><td className="px-2 py-1">{p.name}</td><td className="px-2 py-1 text-right"><Prev v={p.value} /></td><td className="px-2 py-1 text-right">{!f.readOnly && <Button size="sm" variant="outline" onClick={() => f.set(path, [...rows, { name: p.name, value: undefined }])}>Enter current</Button>}</td><td /></tr>)}
      {rows.map((r, i) => <tr key={i} className="border-t"><td className="px-2 py-1"><Input disabled={f.readOnly} placeholder={`Rev ${String(i).padStart(2, '0')}`} value={r.name ?? ''} onChange={e => f.set([...path, i, 'name'], e.target.value)} className="h-8" /></td><td className="px-2 py-1 text-right"><Prev v={priorVal(r.name)} /></td><td className="px-2 py-1 text-right"><NumField bare path={[...path, i, 'value']} label={`${cat} revision ${r.name ?? i} current`} /></td><td>{!f.readOnly && <Button size="icon" variant="ghost" aria-label="Remove revision" onClick={() => f.set(path, rows.filter((_, j) => j !== i))}><Trash2 className="size-4 text-destructive" /></Button>}</td></tr>)}
    </tbody></table></div>
    {!f.readOnly && <Button size="sm" variant="outline" onClick={() => f.set(path, [...rows, { name: `Rev ${String(rows.length).padStart(2, '0')}`, value: undefined }])}><Plus className="mr-1 size-4" />Add revision</Button>}
  </div>;
}

export function DailyForm({ calc, baseline }: { calc: Calc; baseline: Obj }) {
  const f = useForm();
  const prevCalc = calcDaily(baseline ?? {});
  const bp = (p: (string | number)[]) => getIn(baseline, p);
  const documentTypes = [...DOC_TYPES, ...LEGACY_DOC_TYPES.filter(t =>
    getIn(f.data, ['documentTypes', t]) !== undefined || bp(['documentTypes', t]) !== undefined)];
  return <div className="space-y-6">
    <Section title="Daily Submission - Drawings and Submittals by Discipline" description="Enter the cumulative figures as on the Current Date for each discipline. Yesterday is read-only (auto-loaded from the previous log) and Total is auto-calculated as Approved + Resubmit + Rejected + Under Review.">
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
              <thead><tr><th scope="col" className="w-2/5 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Metric</th><th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Yesterday (auto)</th><th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Current Date <span aria-hidden="true">*</span></th></tr></thead>
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
    <Section title="Revisions" description="Dynamic revision names must be unique per category. Yesterday values are read-only."><Revisions cat="drawings" baseline={baseline} /><Revisions cat="submittals" baseline={baseline} /></Section>
    <details open className="group rounded-xl border bg-card text-card-foreground shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 text-base font-semibold [&::-webkit-details-marker]:hidden">
        Document Types<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 px-6 pb-6">
        <p className="text-sm font-medium">Documents by Type (cumulative)</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[360px] table-fixed text-sm" aria-label="Documents by Type (cumulative)">
          <thead><tr>
            <th scope="col" className="w-1/4 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Document Type</th>
            <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Yesterday (auto)</th>
            <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Current Date <span aria-hidden="true">*</span></th>
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
    {ENTITIES.map(e => <Section key={e} title={`Pending with ${e}`} description="Status by ageing bucket. Entity and row totals are calculated.">
      <div className="overflow-x-auto"><table className="w-full"><thead><tr><th rowSpan={2} className="px-2 text-left text-xs font-medium text-muted-foreground">Status</th>{PEND_BUCKETS.map(([b, l]) => <Fragment2 key={b}>{pair(l)}</Fragment2>)}{pair('Row total')}</tr><tr>{PEND_BUCKETS.map(([b]) => <Fragment2 key={b}>{sub}</Fragment2>)}{sub}</tr></thead><tbody>
        {PEND_STATUSES.map(([s, sl]) => { const rowSum = (src: unknown) => PEND_BUCKETS.reduce((a, [b]) => a + num(getIn(src, ['pending', e, s, b])), 0); return <tr key={s} className="border-t"><td className="px-2 py-1 text-sm font-medium">{sl}</td>
          {PEND_BUCKETS.map(([b, bl]) => <Fragment2 key={b}><td className="px-1 text-right"><Prev v={bp(['pending', e, s, b]) ?? 0} /></td><td className="px-1 text-right"><NumField bare path={['pending', e, s, b]} label={`${e} ${sl} ${bl} current`} /></td></Fragment2>)}
          <td className="px-1 text-right"><Tot v={rowSum(baseline)} /></td><td className="px-1 text-right"><Tot v={rowSum(f.data)} /></td></tr>; })}
        <tr className="border-t bg-muted/30"><td className="px-2 py-1 text-sm font-semibold" colSpan={PEND_BUCKETS.length * 2 + 1}>Entity total</td><td className="px-1 text-right"><Tot v={prevCalc.pending[e] ?? 0} /></td><td className="px-1 text-right"><Tot v={calc.pending[e] ?? 0} /></td></tr>
      </tbody></table></div>
    </Section>)}
    <Section title="Correspondence"><table className="w-full"><thead><tr><th className="px-2 text-left text-xs font-medium text-muted-foreground">Direction</th>{sub}</tr></thead><tbody>{([['incoming', 'Incoming'], ['outgoing', 'Outgoing']] as const).map(([k, l]) => <tr key={k} className="border-t"><td className="px-2 py-1 text-sm">{l}</td><td className="px-1 text-right"><Prev v={bp(['correspondence', k]) ?? 0} /></td><td className="px-1 text-right"><NumField bare path={['correspondence', k]} label={`${l} current`} /></td></tr>)}</tbody></table></Section>
  </div>;
}

function Fragment2({ children }: { children: ReactNode }) { return <Fragment>{children}</Fragment>; }
