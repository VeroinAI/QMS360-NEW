import { Fragment, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumField, Section, getIn, useForm } from './form-kit';
import { calcDaily, DISCIPLINES, DISC_STATUSES, DOC_TYPES, ENTITIES, PEND_BUCKETS, PEND_STATUSES, num, type Obj } from './reporting-types';

type Calc = ReturnType<typeof calcDaily>;
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
  return <div className="space-y-6">
    {(['drawings', 'submittals'] as const).map(cat => <Section key={cat} title={`Disciplines - ${cat}`} description="Yesterday is the preceding submitted snapshot (read-only). Totals are calculated.">
      <div className="overflow-x-auto"><table className="w-full"><thead><tr><th rowSpan={2} className="px-2 text-left text-xs font-medium text-muted-foreground">Discipline</th>{DISC_STATUSES.map(([s, l]) => <Fragment2 key={s}>{pair(l)}</Fragment2>)}{pair('Total')}</tr><tr>{DISC_STATUSES.map(([s]) => <Fragment2 key={s}>{sub}</Fragment2>)}{sub}</tr></thead><tbody>
        {DISCIPLINES.map(d => <tr key={d} className="border-t"><td className="px-2 py-1 text-sm font-medium">{d}</td>
          {DISC_STATUSES.map(([s, l]) => <Fragment2 key={s}><td className="px-1 py-1 text-right"><Prev v={bp(['disciplines', cat, d, s]) ?? 0} /></td><td className="px-1 py-1 text-right"><NumField bare path={['disciplines', cat, d, s]} label={`${d} ${cat} ${l} current`} /></td></Fragment2>)}
          <td className="px-1 text-right"><Tot v={prevCalc.disc[`${cat}.${d}`]?.total ?? 0} /></td><td className="px-1 text-right"><Tot v={calc.disc[`${cat}.${d}`]?.total ?? 0} /></td></tr>)}
      </tbody></table></div>
    </Section>)}
    <Section title="Revisions" description="Dynamic revision names must be unique per category. Yesterday values are read-only."><Revisions cat="drawings" baseline={baseline} /><Revisions cat="submittals" baseline={baseline} /></Section>
    <Section title="Document types">
      <table className="w-full"><thead><tr><th className="px-2 text-left text-xs font-medium text-muted-foreground">Type</th>{sub}</tr></thead><tbody>{DOC_TYPES.map(t => <tr key={t} className="border-t"><td className="px-2 py-1 text-sm">{t}</td><td className="px-1 text-right"><Prev v={bp(['documentTypes', t]) ?? 0} /></td><td className="px-1 text-right"><NumField bare path={['documentTypes', t]} label={`${t} current`} /></td></tr>)}</tbody></table>
    </Section>
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
