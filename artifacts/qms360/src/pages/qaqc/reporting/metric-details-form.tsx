import { useId, type ComponentType, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getIn, useForm } from './form-kit';
import { AGEING_BUCKETS, fmt, METRICS, type Obj } from './reporting-types';

type Path = (string | number)[];
type TileC = ComponentType<{ index?: number; title: string; children: ReactNode }>;
const cols = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3';
const BUCKETS: [string, string][] = AGEING_BUCKETS.map(([value, label]) => [value, value === 'over45' ? '>45 days' : label]);

const Req = () => <span className="ml-1 text-destructive" aria-hidden="true">*</span>;
function Fld({ label, id, required, children }: { label: string; id: string; required?: boolean; children: ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id} className="text-xs text-muted-foreground">{label}{required && <Req />}</Label>{children}</div>;
}
function RO({ label, value, tone, testId }: { label: string; value: ReactNode; tone?: string; testId?: string }) {
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><div data-testid={testId} className={`flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm ${tone ?? ''}`}>{value}</div></div>;
}
function Int({ path, label, min = 0, required = true }: { path: Path; label: string; min?: number; required?: boolean }) {
  const f = useForm(); const id = useId(); const v = getIn(f.data, path);
  return <Fld id={id} label={label} required={required}><Input id={id} type="number" min={min} step={1} inputMode="numeric" aria-required={required} disabled={f.readOnly} value={v ?? ''} onChange={e => f.set(path, e.target.value === '' ? undefined : Number(e.target.value))} /></Fld>;
}
function Pick({ path, label, options }: { path: Path; label: string; options: { value: string; label: string }[] }) {
  const f = useForm(); const id = useId(); const v = getIn(f.data, path);
  const opts = v && !options.some(o => o.value === v) ? [{ value: String(v), label: String(v) }, ...options] : options;
  return <Fld id={id} label={label} required><Select disabled={f.readOnly || !options.length} value={v == null ? '' : String(v)} onValueChange={x => f.set(path, x)}><SelectTrigger id={id} aria-required><SelectValue placeholder={options.length ? 'Select' : 'No options configured'} /></SelectTrigger><SelectContent>{opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>{!options.length && <p className="text-xs text-muted-foreground">Configure Department choices in Master Data before adding NCR ageing rows.</p>}</Fld>;
}
function DeptPick({ path }: { path: Path }) {
  const f = useForm();
  const list = (f.departments ?? []).map(d => typeof d === 'string' ? { value: d, label: d } : { value: d.value, label: d.label ?? d.value }).filter(d => d.value);
  return <Pick path={path} label="BU/Dept" options={list} />;
}

function Details({ k, calc }: { k: string; calc?: Obj }) {
  const f = useForm();
  const ncr = k === 'external_ncr' || k === 'internal_ncr';
  const c: Obj = calc ?? {};
  const rows: Obj[] = getIn(f.data, ['metrics', k, 'ageing']) ?? [];
  const ap: Path = ['metrics', k, 'ageing'];
  const variance = Number(c.variance ?? 0);
  const vt = variance > 0 ? 'text-emerald-700 font-semibold' : variance < 0 ? 'text-destructive font-semibold' : '';
  const vlabel = variance > 0 ? 'improvement' : variance < 0 ? 'worsening' : 'no change';
  const n = (x: unknown) => String(x ?? 0);
  const pct = (x: unknown) => `${fmt(Number(x ?? 0))}%`;
  const sum = Number(c.ageSum ?? 0), open = Number(c.open ?? 0);
  return <>
    <div className={cols}>
      <RO label="Acc. till Last Month" value={n(c.prevIssued)} />
      <RO label="Closed till Last Month" value={n(c.prevClosed)} />
      <span className="hidden lg:block" />
      <Int path={['metrics', k, 'issued']} label="Issued this Month" />
      <Int path={['metrics', k, 'closed']} label="Closed this Month" />
      <span className="hidden lg:block" />
      <RO label="Acc. till this Month" value={n(c.accIssued)} />
      <RO label="Closed till this Month" value={n(c.accClosed)} />
      <RO label="Closure Rate this Month" value={pct(c.monthlyRate)} />
      <RO label="% Acc. till Last Month" value={pct(c.prevRate)} />
      <RO label="% Acc. till this Month" value={pct(c.accRate)} />
      <RO label="Variance" testId={`text-variance-${k}`} tone={vt} value={`${variance >= 0 ? '+' : ''}${fmt(variance)} pp (${vlabel})`} />
      {ncr && <RO label="Open NCRs" value={n(c.open)} testId={`text-open-${k}`} />}
    </div>
    {ncr && <div className="space-y-3">
      <p className="text-sm font-medium">Open NCR ageing</p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No ageing rows added.</p>}
      {rows.map((_, i) => <div key={i} className="flex items-end gap-2 rounded-lg border bg-muted/20 p-3">
        <div className={`${cols} flex-1`}>
          <DeptPick path={[...ap, i, 'department']} />
          <Pick path={[...ap, i, 'bucket']} label="Ageing Bucket" options={BUCKETS.map(([value, label]) => ({ value, label }))} />
          <Int path={[...ap, i, 'count']} label="Count" min={1} />
        </div>
        {!f.readOnly && <Button type="button" size="icon" variant="ghost" aria-label={`Remove ageing row ${i + 1}`} onClick={() => f.set(ap, rows.filter((_, j) => j !== i))}><Trash2 className="size-4 text-destructive" /></Button>}
      </div>)}
      {!f.readOnly && <Button type="button" size="sm" variant="outline" onClick={() => f.set(ap, [...rows, { department: '', bucket: '' }])}><Plus className="mr-1 size-4" />Add ageing row</Button>}
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Ageing total vs Open NCRs</span><span data-testid={`text-ageing-${k}`} className={sum === open ? 'font-semibold' : 'font-semibold text-destructive'}>{sum} / {open}</span></div>
    </div>}
  </>;
}

export function MetricDetailsForm({ calc, Tile }: { calc?: Record<string, Obj>; Tile: TileC }) {
  return <Tile index={7} title="QA/QC Metric Details Section (Ext NCR, Int NCR, RFI & RMI)">
    {METRICS.map(([k, label]) => <section key={k} aria-labelledby={`metric-heading-${k}`} className="space-y-4 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 id={`metric-heading-${k}`} className="text-sm font-semibold">{label}</h3>
      <Details k={k} calc={calc?.[k]} />
    </section>)}
  </Tile>;
}
