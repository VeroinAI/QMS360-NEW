import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, BookOpen, ChevronRight, RefreshCw } from 'lucide-react';
import { useGetQaqcConsolidatedDashboard, getGetQaqcConsolidatedDashboardQueryKey, type GetQaqcConsolidatedDashboardParams } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatReportingPeriod as displayPeriod } from '@workspace/spreadsheet-dates';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardData, DashboardRecord, Point, ProjectOption } from './types';

/* Reference palette from QMS_Consolidated_Dashboards_Design_v1 */
export const C = { purple: '#582C83', cyan: '#06AEBB', amber: '#EB9823', fuchsia: '#A43C96', pink: '#D58BCB', lilac: '#BBA9D2', ink: '#2A1840', paper: '#F7F4FA' };
const SERIES = [C.purple, C.cyan, C.amber, C.fuchsia, C.pink, C.lilac];

export const dash = (v: number | null | undefined, suffix = '', digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${Number(v).toFixed(digits)}${suffix}`;
export const signed = (v: number | null | undefined, suffix = '') =>
  v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`;

type Drill = { title: string; module?: string; projectId?: string; state?: string; category?: string; impact?: string; period?: string; snapshotOnly?: boolean };
export function filterRecords(records: DashboardRecord[], d: Drill) {
  const m = d.module?.toLowerCase();
  return records.filter(r => (!m || r.type.toLowerCase().includes(m))
    && (!d.snapshotOnly || r.snapshot)
    && (!d.projectId || r.projectId === d.projectId)
    && (!d.state || r.state.toLowerCase() === d.state.toLowerCase())
    && (!d.category || (r.category ?? '').toLowerCase() === d.category.toLowerCase())
    && (!d.impact || (r.impact ?? '').toLowerCase() === d.impact.toLowerCase())
    && (!d.period || r.period.startsWith(d.period)));
}

const DEFINITIONS: Array<[string, string, string]> = [
  ['M-008/D-006', 'Total projects', 'Count of active authorized projects within the selected SBG / BU / group / project filters.'],
  ['M-009/D-007', 'Submitted & approved', 'Projects whose monthly (or daily) report for the period / date has status Approved. Only these feed every total.'],
  ['M-010/D-008', 'Pending submission', 'Projects with no report, or a Draft, for the period / date.'],
  ['M-011/D-009', 'Pending approval', 'Projects whose report is Submitted and not yet approved.'],
  ['M-012', 'PQI accumulated', 'Average of “PQI - Acc. till this Month” across projects with an approved report.'],
  ['M-013', 'PQI variance', 'Average of “PQI - Variance” in percentage points; target is the average of project targets.'],
  ['M-014', 'Overall closure rate', 'Σ Closed till this month ÷ Σ Accumulated till this month × 100 across Ext NCR, Int NCR, RFI and RMI.'],
  ['M-016', 'Open NCRs', 'Σ open External and Internal NCRs across projects in view.'],
  ['M-040', 'CSAT average', 'Average of the six ratings over survey responses dated in the period. Uses submitted final surveys (CSAT has no approval workflow).'],
  ['M-042', 'Would recommend', 'Responses answering Yes ÷ all responses × 100.'],
  ['M-044', 'Lowest area', 'The lowest of the six service-area averages.'],
  ['M-054', 'Lessons logged', 'Approved Lesson Learned forms dated in the period, split by Positive / Negative impact.'],
  ['M-056', 'Repeated issues', 'Approved forms flagged Repeated ÷ all approved forms × 100.'],
  ['M-058', 'Escalated lessons', 'Major + Negative forms awaiting approval: P1 at 2 days, L1 at 5 days, L2 at 8 days.'],
  ['M-064', 'Audits conducted', 'Audits conducted ÷ audits planned (approved schedule, From date in month) × 100.'],
  ['M-066', 'Open NCs', 'Non-Conformity findings classified Major / Minor NC not yet completed.'],
  ['M-068', 'CARs overdue', 'CARs still open past due date (priority SLA or approved extension); escalated = L1 or L2.'],
  ['Daily', 'Cumulative vs movement', 'Cumulative shows the snapshot at the selected date. Movement is end snapshot minus start snapshot (may be negative); pending ageing and bottlenecks always use the end snapshot.'],
  ['Daily', 'Pending ageing', 'Documents pending by elapsed days: up to 7, 8–30, over 30.'],
];

/* ---------- small building blocks ---------- */
function Lane({ color, title, eyebrow, children, unavailable, emptyContent }: { color: string; title: string; eyebrow: string; children: ReactNode; unavailable?: boolean; emptyContent?: ReactNode }) {
  return <section aria-label={title} className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_1px_0_rgba(88,44,131,.06),0_12px_32px_-20px_rgba(88,44,131,.35)]" style={{ borderColor: `${color}33` }}>
    <div className="h-1.5" style={{ background: color }} />
    <header className="flex items-baseline justify-between gap-2 px-4 pt-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em]" style={{ color }}>{title}</h2>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{eyebrow}</span>
    </header>
    {unavailable ? <div className="m-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No data — module unavailable for this view.</div> : <div className="flex flex-1 flex-col gap-3 p-4">{emptyContent ?? children}</div>}
  </section>;
}

function Kpi({ label, value, sub, color, onClick, tone }: { label: string; value: string; sub?: ReactNode; color: string; onClick?: () => void; tone?: 'neg' | 'pos' }) {
  const body = <>
    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    <span className="break-words font-[Outfit,sans-serif] text-[clamp(1.2rem,4.8vw,1.875rem)] font-bold leading-none tabular-nums" style={{ color: tone === 'neg' ? C.fuchsia : color }}>{value}</span>
    {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
  </>;
  const cls = 'flex min-w-0 flex-col gap-1.5 rounded-xl p-2 text-left transition sm:p-3';
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2`} style={{ background: `${color}0F`, outlineColor: color }} aria-label={`${label}: ${value}. Open records`}>{body}</button>
    : <div className={cls} style={{ background: `${color}0F` }}>{body}</div>;
}

function ChartBox({ title, children, empty, height = 180 }: { title: string; children: ReactNode; empty: boolean; height?: number }) {
  return <figure className="min-w-0">
    <figcaption className="mb-1 text-xs font-semibold text-foreground/80">{title}</figcaption>
    {empty ? <div className="flex items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground" style={{ height }}>No data</div>
      : <div style={{ height }}><ResponsiveContainer>{children as never}</ResponsiveContainer></div>}
  </figure>;
}

const tip = { contentStyle: { borderRadius: 10, border: `1px solid ${C.lilac}`, fontSize: 12 }, cursor: { fill: `${C.lilac}33` } };
const hasData = (p: Point[]) => p.some(x => Object.entries(x).some(([k, v]) => k !== 'name' && typeof v === 'number'));
const num = (v: unknown) => (typeof v === 'number' ? v : null);
type Series = { key: string; name: string; color: string };

/** Explicitly mapped bar series (no inferred keys). */
export function SeriesBars({ data, series, stacked, expand, layout = 'horizontal', signedValues, pct, onPick, extraTip, children, width, height, approvalLabels }: {
  data: Point[]; series: Series[]; stacked?: boolean; expand?: boolean; layout?: 'horizontal' | 'vertical'; signedValues?: boolean; pct?: boolean;
  onPick?: (p: Point) => void; extraTip?: (p: Point) => string | null; children?: ReactNode; width?: number; height?: number; approvalLabels?: boolean;
}) {
  const fmt = (v: unknown) => v === null || v === undefined ? '—' : signedValues ? signed(v as number) : pct ? `${Number(v).toFixed(1)}%` : String(v);
  return <ComposedChart width={width} height={height} data={data} layout={layout} stackOffset={expand ? 'expand' : signedValues ? 'sign' : undefined} margin={{ left: layout === 'vertical' ? 8 : -12, right: 10, top: 14, bottom: 0 }}>
    <CartesianGrid strokeDasharray="2 4" stroke={`${C.lilac}66`} vertical={layout === 'vertical'} horizontal={layout === 'horizontal'} />
    {layout === 'vertical'
      ? <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={expand ? (v: number) => `${Math.round(v * 100)}%` : undefined} domain={pct ? [0, 100] : undefined} />
      : <XAxis type="category" dataKey="name" tick={{ fontSize: 10 }} interval={0} tickFormatter={v => displayPeriod(v)} />}
    {layout === 'vertical'
      ? <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 10 }} tickFormatter={v => displayPeriod(v)} />
      : <YAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} domain={pct ? [0, 100] : undefined} tickFormatter={expand ? (v: number) => `${Math.round(v * 100)}%` : undefined} />}
    {signedValues && <ReferenceLine {...(layout === 'vertical' ? { x: 0 } : { y: 0 })} stroke={C.ink} strokeOpacity={0.4} />}
    <Tooltip {...tip} formatter={(v: unknown, n: unknown) => [fmt(v), String(n)]} labelFormatter={(l: unknown, payload: readonly { payload?: Point }[]) => {
      const pt = payload?.[0]?.payload; const extra = pt && extraTip ? extraTip(pt) : null; return extra ? `${displayPeriod(l)} · ${extra}` : displayPeriod(l);
    }} />
    {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />}
    {series.map((s, index) => <Bar key={s.key} dataKey={s.key} name={s.name} stackId={stacked || expand ? 's' : undefined} fill={s.color} maxBarSize={34} radius={stacked || expand ? 0 : [4, 4, 4, 4]} className={onPick ? 'cursor-pointer' : ''} onClick={onPick ? (d: unknown) => onPick((d as { payload: Point }).payload) : undefined}>
      {approvalLabels && index === series.length - 1 && <LabelList content={(lp: object) => APPROVAL_LABEL({ ...(lp as object), data })} />}
    </Bar>)}
    {children}
  </ComposedChart>;
}

const TargetTick = (props: { cx?: number; cy?: number; payload?: Point }) => {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || num(payload?.target) === null) return <g />;
  return <g><line x1={cx - 16} x2={cx + 16} y1={cy} y2={cy} stroke={C.amber} strokeWidth={3} strokeLinecap="round" /></g>;
};

/* ---------- filters / url state ---------- */
type Params = { view: 'monthly' | 'daily'; period?: string; date?: string; mode: 'cumulative' | 'movement'; from?: string; to?: string; projectId?: string; sbg?: string; bu?: string; projectGroup?: string };
function readParams(search: string): Params {
  const q = new URLSearchParams(search);
  const g = (k: string) => q.get(k) || undefined;
  return { view: q.get('view') === 'daily' ? 'daily' : 'monthly', mode: q.get('mode') === 'movement' ? 'movement' : 'cumulative', period: g('period'), date: g('date'), from: g('from'), to: g('to'), projectId: g('projectId'), sbg: g('sbg'), bu: g('bu'), projectGroup: g('projectGroup') };
}

function Select({ label, value, options, onChange, all }: { label: string; value?: string; options: Array<[string, string]>; onChange: (v?: string) => void; all: string }) {
  return <label className="flex min-w-0 flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/70">{label}
    <select value={value ?? ''} onChange={e => onChange(e.target.value || undefined)} className="h-9 min-w-0 rounded-lg border border-white/20 bg-white/10 px-2 text-sm font-medium normal-case tracking-normal text-white focus:outline-none focus:ring-2 focus:ring-[#06AEBB] [&>option]:text-[#2A1840]">
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>;
}

/* ---------- page ---------- */
export function ConsolidatedDashboardPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const p = useMemo(() => readParams(search), [search]);
  const set = (patch: Partial<Params>) => {
    const next = { ...p, ...patch };
    const q = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => { if (v && !(k === 'view' && v === 'monthly') && !(k === 'mode' && v === 'cumulative')) q.set(k, String(v)); });
    if (next.mode === 'cumulative' && next.view === 'daily') q.delete('mode');
    navigate(`/qaqc/dashboard${q.toString() ? `?${q}` : ''}`, { replace: true });
  };
  const apiParams = useMemo(() => {
    const o: Record<string, string> = { view: p.view };
    if (p.view === 'monthly') { if (p.period) o.period = p.period; }
    else { o.mode = p.mode; if (p.mode === 'movement') { if (p.from) o.from = p.from; if (p.to) o.to = p.to; } else if (p.date) o.date = p.date; }
    (['projectId', 'sbg', 'bu', 'projectGroup'] as const).forEach(k => { if (p[k]) o[k] = p[k]!; });
    return o as unknown as GetQaqcConsolidatedDashboardParams;
  }, [p]);
  const q = useGetQaqcConsolidatedDashboard(apiParams, { query: { queryKey: getGetQaqcConsolidatedDashboardQueryKey(apiParams),
    staleTime: 30_000, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 60_000 } });
  const data = q.data as unknown as DashboardData | undefined;
  const [drill, setDrill] = useState<Drill | null>(null);
  const [defsOpen, setDefsOpen] = useState(false);

  const projects = data?.projects ?? [];
  const uniq = (list: ProjectOption[], k: 'sbg' | 'bu' | 'projectGroup') => [...new Set(list.map(x => x[k]).filter(Boolean))].sort().map(v => [v, v] as [string, string]);
  const inSbg = projects.filter(x => !p.sbg || x.sbg === p.sbg);
  const inBu = inSbg.filter(x => !p.bu || x.bu === p.bu);
  const inGroup = inBu.filter(x => !p.projectGroup || x.projectGroup === p.projectGroup);

  return <div className="-m-4 min-h-[100dvh] min-w-0 overflow-x-clip md:-m-8" style={{ background: C.paper, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
    <div className="relative overflow-hidden px-4 pb-6 pt-6 text-white md:px-8" style={{ background: `linear-gradient(120deg, ${C.purple} 0%, #3E1D60 62%, ${C.fuchsia} 140%)` }}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border-[28px] opacity-20" style={{ borderColor: C.cyan }} />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">QMS360 · Algihaz Holding</p>
          <h1 className="mt-1 font-[Outfit,sans-serif] text-3xl font-bold md:text-4xl">QAQC Dashboard <span style={{ color: C.cyan }}>·</span> {p.view === 'monthly' ? 'Monthly' : 'Daily'}</h1>
          <p className="mt-1 text-sm text-white/75">Reflects approved reports only{data ? ` · ${data.view === 'monthly' ? displayPeriod(data.period) : data.mode === 'movement' ? `${displayPeriod(data.from ?? '—')} → ${displayPeriod(data.to ?? '—')}` : displayPeriod(data.period)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Dashboard view" className="flex rounded-full bg-white/10 p-1">
            {(['monthly', 'daily'] as const).map(v => <button key={v} role="tab" aria-selected={p.view === v} onClick={() => set({ view: v })} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${p.view === v ? 'bg-white text-[#582C83]' : 'text-white/80 hover:text-white'}`}>{v}</button>)}
          </div>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/15 hover:text-white" onClick={() => setDefsOpen(true)}><BookOpen className="size-4" />Definitions</Button>
          <Button size="sm" className="bg-[#06AEBB] text-white hover:bg-[#06AEBB]/90" onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw className={`size-4 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
        </div>
      </div>
      <div className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Select label="SBG" all="All SBGs" value={p.sbg} options={uniq(projects, 'sbg')} onChange={v => set({ sbg: v, bu: undefined, projectGroup: undefined, projectId: undefined })} />
        <Select label="BU" all="All BUs" value={p.bu} options={uniq(inSbg, 'bu')} onChange={v => set({ bu: v, projectGroup: undefined, projectId: undefined })} />
        <Select label="Project group" all="All project groups" value={p.projectGroup} options={uniq(inBu, 'projectGroup')} onChange={v => set({ projectGroup: v, projectId: undefined })} />
        <Select label="Project" all="All projects" value={p.projectId} options={inGroup.map(x => [x.id, `${x.code} · ${x.name}`])} onChange={v => set({ projectId: v })} />
        {p.view === 'monthly'
          ? <Select label="Reporting period" all={data?.period ? `Latest (${displayPeriod(data.period)})` : 'Latest approved'} value={p.period} options={(data?.periods ?? []).map(x => [x, displayPeriod(x)])} onChange={v => set({ period: v })} />
          : <>
            <Select label="Mode" all="Cumulative" value={p.mode === 'movement' ? 'movement' : undefined} options={[['movement', 'Movement']]} onChange={v => set({ mode: v === 'movement' ? 'movement' : 'cumulative' })} />
            {p.mode === 'movement' ? <>
              <DateField label="From" value={p.from} onChange={v => set({ from: v })} />
              <DateField label="To" value={p.to} onChange={v => set({ to: v })} />
            </> : <Select label="Report date" all={data?.period ? `Latest (${displayPeriod(data.period)})` : 'Latest approved'} value={p.date} options={(data?.periods ?? []).map(x => [x, displayPeriod(x)])} onChange={v => set({ date: v })} />}
          </>}
      </div>
    </div>

    <div className="space-y-5 px-4 py-6 md:px-8">
      {q.isLoading ? <LoadingState /> : q.error ? <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-10 text-center">
        <AlertTriangle className="size-8" style={{ color: C.fuchsia }} /><p className="font-semibold">The dashboard could not be loaded.</p>
        <p className="text-sm text-muted-foreground">{q.error instanceof Error ? q.error.message : 'Request failed.'}</p>
        <Button onClick={() => void q.refetch()}>Retry</Button></div>
        : !data ? null : <>
          {data.warnings.length > 0 && <div role="status" className="rounded-xl border-l-4 bg-card p-3 text-sm" style={{ borderColor: C.amber }}>
            {data.warnings.map(w => <p key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: C.amber }} />{w}</p>)}</div>}
          <Coverage data={data} onDrill={setDrill} />
           {data.view === 'daily' && (data.daily.snapshotReports ?? data.daily.selectedReports) === 0
             ? <div className="rounded-2xl border border-dashed bg-card p-10 text-center"><p className="font-[Outfit,sans-serif] text-lg font-semibold" style={{ color: C.purple }}>No approved reports in this selection</p><p className="text-sm text-muted-foreground">Figures appear once a report for this date is approved. Try another period or widen the filters. Use the coverage tiles to see pending projects.</p></div>
            : data.view === 'monthly' ? <Monthly data={data} onDrill={setDrill} /> : <Daily data={data} onDrill={setDrill} />}
        </>}
    </div>

    <DrillDialog drill={drill} records={data?.records ?? []} onClose={() => setDrill(null)} />
    <Dialog open={defsOpen} onOpenChange={setDefsOpen}><DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>KPI definitions</DialogTitle><DialogDescription>From the QMS consolidated dashboards field mapping. Only approved reports count; unavailable values show an em dash.</DialogDescription></DialogHeader>
      <dl className="divide-y">{DEFINITIONS.map(([id, t, d]) => <div key={id + t} className="grid gap-1 py-2.5 sm:grid-cols-[96px_160px_1fr]"><dt className="font-mono text-xs" style={{ color: C.fuchsia }}>{id}</dt><dt className="text-sm font-semibold">{t}</dt><dd className="text-sm text-muted-foreground">{d}</dd></div>)}</dl>
    </DialogContent></Dialog>
  </div>;
}

function DateField({ label, value, onChange }: { label: string; value?: string; onChange: (v?: string) => void }) {
  return <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/70">{label}
    <Input type="date" value={value ?? ''} onChange={e => onChange(e.target.value || undefined)} className="h-9 rounded-lg border border-white/20 bg-white/10 px-2 text-sm text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#06AEBB]" /></label>;
}

function LoadingState() {
  return <div aria-busy className="space-y-5"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-96 rounded-2xl" />)}</div></div>;
}

function Coverage({ data, onDrill }: { data: DashboardData; onDrill: (d: Drill) => void }) {
  const c = data.coverage; const mod = data.view === 'monthly' ? 'monthly' : 'daily';
  const items: Array<[string, number, string, string | undefined]> = [
    ['Total projects', c.total, C.purple, undefined], ['Submitted & approved', c.approved, C.cyan, 'Approved'],
    ['Pending submission', c.pendingSubmission, C.amber, 'Draft'], ['Pending approval', c.pendingApproval, C.fuchsia, 'Submitted'],
  ];
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {items.map(([l, v, col, state]) => <button key={l} type="button" onClick={() => onDrill({ title: `${l} · ${displayPeriod(data.period)}`, module: mod, state, period: data.period })} className="group flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-left transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2" style={{ borderLeft: `4px solid ${col}` }}>
      <span><span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</span><span className="font-[Outfit,sans-serif] text-2xl font-bold tabular-nums" style={{ color: col }}>{v}</span></span>
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
    </button>)}
  </div>;
}

/* ---------- monthly ---------- */
export function MonthlyQualityEmptyState({ period, pendingApproval, pendingSubmission, onReports, onPending }: {
  period: string; pendingApproval: number; pendingSubmission: number; onReports: () => void; onPending: () => void;
}) {
  return <div role="status" className="rounded-xl border border-dashed p-4 text-sm">
    <p className="font-semibold" style={{ color: C.purple }}>No approved monthly reports for {displayPeriod(period)}</p>
    <p className="mt-2 text-muted-foreground">No approved reports are available in your current selection. Draft reports and reports awaiting approval are excluded from the quality figures. Values appear after final approval.</p>
    <dl className="mt-3 grid grid-cols-2 gap-3">
      <div><dt className="text-xs text-muted-foreground">Pending approval</dt><dd className="text-lg font-semibold">{pendingApproval}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Projects pending submission</dt><dd className="text-lg font-semibold">{pendingSubmission}</dd></div>
    </dl>
    <div className="mt-4 flex flex-wrap gap-2">
      {pendingApproval > 0 && <Button size="sm" onClick={onPending}>View pending approval</Button>}
      <Button size="sm" variant="outline" onClick={onReports}>View monthly reports</Button>
    </div>
  </div>;
}

function Monthly({ data, onDrill }: { data: DashboardData; onDrill: (d: Drill) => void }) {
  const { quality: Q, csat, lessons: L, audit: A, scorecard } = data.monthly;
  const per = data.period;
  /* Monthly-report figures come only from approved reports in the period. */
  const src = (title: string, projectId?: string): Drill => ({ title, module: 'monthly', state: 'approved', period: per, projectId });
  return <>
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <Lane color={C.purple} title="Quality" eyebrow="Monthly report" emptyContent={data.coverage.approved === 0
        ? <MonthlyQualityEmptyState period={per} pendingApproval={data.coverage.pendingApproval} pendingSubmission={data.coverage.pendingSubmission}
          onPending={() => onDrill({ title: 'Monthly reports pending approval', module: 'monthly', state: 'submitted', period: per })}
          onReports={() => onDrill({ title: 'Monthly reports · current selection', module: 'monthly', period: per })} />
        : undefined}>
        <div className="grid grid-cols-3 gap-2">
          <Kpi color={C.purple} label="PQI acc." value={dash(Q.pqi, '%', 1)} sub={<span style={{ color: (Q.variance ?? 0) < 0 ? C.fuchsia : C.cyan }}>{signed(Q.variance, ' pp')} · target {dash(Q.target, '%', 0)}</span>} onClick={() => onDrill(src('PQI · source monthly reports'))} />
          <Kpi color={C.purple} label="Closure" value={dash(Q.closure, '%', 1)} sub={`${Q.closed} of ${Q.issued} closed`} onClick={() => onDrill(src('Overall closure · source monthly reports'))} />
          <Kpi color={C.purple} label="Open NCRs" value={dash(Q.openNcr)} sub={`Ext ${Q.externalOpen} · Int ${Q.internalOpen}`} onClick={() => onDrill(src('Open NCRs · source monthly reports'))} />
        </div>
        <ChartBox title="Closure % by category · target marker" empty={!hasData(Q.categories)}>
          <SeriesBars data={Q.categories} pct series={[{ key: 'value', name: 'Closure %', color: C.purple }]} extraTip={p => `${num(p.closed) ?? '—'} of ${num(p.issued) ?? '—'} closed · target ${dash(num(p.target), '%')}`} onPick={p => onDrill(src(`${p.name} closure · source monthly reports`))}>
            <Line dataKey="target" name="Target %" stroke="none" isAnimationActive={false} dot={TargetTick as never} activeDot={false} legendType="plainline" />
          </SeriesBars>
        </ChartBox>
        <ChartBox title={`Open NCR ageing · ${Q.over45} over 45 days`} empty={!hasData(Q.ageing)} height={150}>
          <SeriesBars data={Q.ageing} stacked layout="vertical" series={[{ key: 'upTo15', name: '0–15 d', color: C.cyan }, { key: 'days15To45', name: '15–45 d', color: C.amber }, { key: 'over45', name: '>45 d', color: C.fuchsia }]} onPick={p => onDrill(src(`${p.name} ageing · source monthly reports`))} />
        </ChartBox>
        <ChartBox title="Document review outcome (100%)" empty={!hasData(Q.documents)} height={170}>
          <SeriesBars data={Q.documents} expand layout="vertical" series={[{ key: 'approved', name: 'Approved', color: C.cyan }, { key: 'resubmitted', name: 'Resubmit', color: C.amber }, { key: 'rejected', name: 'Rejected', color: C.fuchsia }, { key: 'underReview', name: 'Under review', color: C.lilac }]} extraTip={p => `approval ${dash(num(p.value), '%', 1)} of ${num(p.total) ?? '—'}`} onPick={p => onDrill(src(`${p.name} documents · source monthly reports`))} />
        </ChartBox>
      </Lane>

      <Lane color={C.cyan} title="Customer satisfaction" eyebrow="Final surveys">
        <div className="grid grid-cols-3 gap-2">
          <Kpi color={C.cyan} label="CSAT avg" value={dash(csat.average, '', 2)} sub={`out of 5 · ${csat.responses} responses`} onClick={() => onDrill({ title: 'CSAT survey responses', module: 'csat', period: per })} />
          <Kpi color={C.cyan} label="Recommend" value={dash(csat.recommend, '%', 0)} sub={`${csat.yes} of ${csat.responses} said Yes`} onClick={() => onDrill({ title: 'CSAT survey responses', module: 'csat', period: per })} />
          <Kpi color={C.cyan} label="Lowest area" value={dash(csat.lowest?.value ?? null, '', 2)} sub={csat.lowest?.name ?? 'No data'} onClick={() => onDrill({ title: 'CSAT survey responses', module: 'csat', period: per })} />
        </div>
        <ChartBox title="Average rating by service area (of 5)" empty={!hasData(csat.ratings)} height={210}>
          <BarChart data={csat.ratings} layout="vertical" margin={{ left: 8, right: 12 }}>
            <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={98} tick={{ fontSize: 10 }} />
            <Tooltip {...tip} formatter={(v: unknown) => [dash(num(v), '', 2), 'Average']} /><Bar dataKey="value" name="Average" radius={[0, 6, 6, 0]} className="cursor-pointer" onClick={() => onDrill({ title: 'CSAT survey responses', module: 'csat', period: per })}>{csat.ratings.map(r => <Cell key={r.name} fill={r.name === csat.lowest?.name ? C.amber : C.cyan} />)}</Bar>
          </BarChart>
        </ChartBox>
        <ChartBox title="Expectations outcome" empty={!hasData(csat.outcomes)} height={170}>
          <PieChart><Pie data={csat.outcomes.filter(o => o.value !== null && o.value > 0)} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2} onClick={(d: unknown) => onDrill({ title: `CSAT · ${(d as Point).name}`, module: 'csat', period: per, category: (d as Point).name })} className="cursor-pointer">
            {csat.outcomes.map((o, i) => <Cell key={o.name} fill={SERIES[(i + 1) % SERIES.length]} />)}</Pie><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" /></PieChart>
        </ChartBox>
      </Lane>

      <Lane color={C.amber} title="Lessons learned" eyebrow="Approved forms" unavailable={!L.available}>
        <div className="grid grid-cols-3 gap-2">
          <Kpi color={C.amber} label="Logged" value={dash(L.logged)} sub={`${L.positive} positive · ${L.negative} negative`} onClick={() => onDrill({ title: 'Approved lessons in period', module: 'lesson', state: 'approved', period: per })} />
          <Kpi color={C.amber} label="Repeated" value={dash(L.repeated, '%', 0)} sub={`${L.repeatedCount} of ${L.logged ?? '—'} repeated`} onClick={() => onDrill({ title: 'Approved lessons in period', module: 'lesson', state: 'approved', period: per })} />
          <Kpi color={C.amber} label="Escalated" value={dash(L.escalated)} tone={(L.escalated ?? 0) > 0 ? 'neg' : undefined} sub={L.levels.filter(l => l.value).map(l => `${l.name} ${l.value}`).join(' · ') || 'None'} onClick={() => onDrill({ title: 'Negative lessons', module: 'lesson', impact: 'Negative' })} />
        </div>
        <ChartBox title="Positive vs negative · last 6 months" empty={!hasData(L.trend)}>
          <SeriesBars data={L.trend} series={[{ key: 'positive', name: 'Positive', color: C.cyan }, { key: 'negative', name: 'Negative', color: C.fuchsia }]} onPick={p => onDrill({ title: `Approved lessons · ${p.name}`, module: 'lesson', state: 'approved', period: p.name })} />
        </ChartBox>
        <ChartBox title="Negative lessons by severity" empty={!hasData(L.severity)} height={150}>
          <SeriesBars data={L.severity} layout="vertical" series={[{ key: 'value', name: 'Lessons', color: C.amber }]} onPick={p => onDrill({ title: `Negative lessons · ${p.name}`, module: 'lesson', impact: 'Negative', category: p.name, period: per })} />
        </ChartBox>
      </Lane>

      <Lane color={C.fuchsia} title="Audits" eyebrow="Programme & CARs" unavailable={!A.available}>
        <div className="grid grid-cols-3 gap-2">
          <Kpi color={C.fuchsia} label="Conducted" value={A.conducted === null ? '—' : `${A.conducted}/${A.planned ?? '—'}`} sub={`${dash(A.conductedRate, '%', 0)} of plan`} onClick={() => onDrill({ title: 'Audits in period', module: 'audit', period: per })} />
          <Kpi color={C.fuchsia} label="Open NCs" value={dash(A.openNc)} sub={`Major ${A.major} · Minor ${A.minor}`} onClick={() => onDrill({ title: 'Audits (source of findings)', module: 'audit' })} />
          <Kpi color={C.fuchsia} label="CARs overdue" value={dash(A.overdue)} sub={`${dash(A.escalated)} escalated (L1/L2)`} onClick={() => onDrill({ title: 'CARs', module: 'car' })} />
        </div>
        <ChartBox title="Planned vs conducted · last 6 months" empty={!hasData(A.trend)}>
          <SeriesBars data={A.trend} series={[{ key: 'planned', name: 'Planned', color: C.lilac }, { key: 'conducted', name: 'Conducted', color: C.fuchsia }]} onPick={p => onDrill({ title: `Audits · ${p.name}`, module: 'audit', period: p.name })} />
        </ChartBox>
        <ChartBox title="CAR status" empty={!hasData(A.cars)} height={150}>
          <SeriesBars data={A.cars} layout="vertical" series={[{ key: 'value', name: 'CARs', color: C.pink }]} onPick={() => onDrill({ title: 'CARs', module: 'car' })} />
        </ChartBox>
      </Lane>
    </div>
    <Scorecard rows={scorecard} data={data} onDrill={onDrill} />
  </>;
}

const escColor = (e: string) => /l3|l2/i.test(e) ? C.fuchsia : /l1/i.test(e) ? C.amber : C.cyan;
const escRank = (e: string) => Number(/l(\d)/i.exec(e)?.[1] ?? 0);
const sumOrNull = (vals: Array<number | null>) => vals.every(v => v === null) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0);

function Scorecard({ rows, data, onDrill }: { rows: DashboardData['monthly']['scorecard']; data: DashboardData; onDrill: (d: Drill) => void }) {
  const period = data.period; const M = data.monthly;
  const sorted = [...rows].sort((a, b) => escRank(b.escalation) - escRank(a.escalation) || b.monthsBelow - a.monthsBelow || (a.pqi ?? 999) - (b.pqi ?? 999));
  const escalated = sorted.filter(r => escRank(r.escalation) > 0);
  const scored = rows.filter(r => r.pqi !== null);
  const lowest = [...scored].filter(r => r.target !== null && r.pqi! < r.target!).sort((a, b) => a.pqi! - b.pqi!)[0];
  const bestPqi = [...scored].sort((a, b) => b.pqi! - a.pqi!)[0];
  const bestCsat = [...rows].filter(r => r.csat !== null).sort((a, b) => b.csat! - a.csat!)[0];
  const openReport = (r: { projectId: string; projectName: string }) => onDrill({ title: `${r.projectName} · approved monthly report`, module: 'monthly', state: 'approved', period, projectId: r.projectId });
  const projectAll = (r: { projectId: string; projectName: string }) => onDrill({ title: `${r.projectName} · all backing records`, projectId: r.projectId });
  const cardCls = 'rounded-xl p-3 text-left transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2';
  return <section aria-label="Project scorecard" className="rounded-2xl border bg-card p-4 md:p-5">
    <div className="mb-3"><h2 className="font-[Outfit,sans-serif] text-xl font-bold" style={{ color: C.purple }}>Project scorecard</h2><p className="text-xs text-muted-foreground">One row per project · {displayPeriod(period)} · approved reports only</p></div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {escalated.map(r => <button key={r.projectId} type="button" onClick={() => projectAll(r)} className={`${cardCls} text-white`} style={{ background: `linear-gradient(135deg, ${C.purple}, ${escColor(r.escalation)})` }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/75">Needs attention · {r.escalation}</p><p className="truncate font-semibold">{r.projectName}</p>
        <p className="text-xs text-white/85">Closure {dash(r.closure, '%', 1)} · {r.monthsBelow} month(s) below target · {dash(r.over45)} NCRs open &gt;45 d</p></button>)}
      {lowest && <button type="button" onClick={() => openReport(lowest)} className={cardCls} style={{ background: `${C.amber}1F`, border: `1px solid ${C.amber}66` }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.amber }}>Lowest PQI</p><p className="truncate font-semibold">{lowest.projectName}</p>
        <p className="text-xs text-muted-foreground">PQI {dash(lowest.pqi, '%', 1)} · {(lowest.pqi! - lowest.target!).toFixed(1)} pts vs target{(lowest.escalatedLessons ?? 0) > 0 ? ` · ${lowest.escalatedLessons} lesson(s) escalated` : ''}</p></button>}
      {(bestPqi || bestCsat) && <div className={cardCls} style={{ background: `${C.cyan}14`, border: `1px solid ${C.cyan}55` }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.cyan }}>Doing well</p>
        {bestPqi && <button type="button" className="block w-full truncate text-left text-sm hover:underline" onClick={() => openReport(bestPqi)}>Highest PQI: <b>{bestPqi.projectName}</b> {dash(bestPqi.pqi, '%', 1)}</button>}
        {bestCsat && <button type="button" className="block w-full truncate text-left text-sm hover:underline" onClick={() => onDrill({ title: `${bestCsat.projectName} · CSAT`, module: 'csat', projectId: bestCsat.projectId, period })}>Highest CSAT: <b>{bestCsat.projectName}</b> {dash(bestCsat.csat, '', 2)} ({bestCsat.responses} responses)</button>}
      </div>}
    </div>
    {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No projects in this selection.</p> :
      <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {['Project', 'PQI', 'Closure', 'Open NCRs (>45 d)', 'CSAT', 'Lessons (neg · esc)', 'Audits (open NC · CAR od.)', 'Escalation'].map(h => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>
          <tr className="border-b-2 font-semibold" style={{ background: `${C.purple}0D`, borderColor: `${C.purple}33` }}>
            <td className="px-2 py-2" style={{ color: C.purple }}>All projects</td>
            <td className="px-2 tabular-nums">{dash(M.quality.pqi, '%', 1)}</td><td className="px-2 tabular-nums">{dash(M.quality.closure, '%', 1)}</td>
            <td className="px-2 tabular-nums">{dash(M.quality.openNcr)} ({M.quality.over45})</td><td className="px-2 tabular-nums">{dash(M.csat.average, '', 2)}</td>
            <td className="px-2 tabular-nums">{dash(sumOrNull(rows.map(r => r.negativeLessons)))} · {dash(sumOrNull(rows.map(r => r.escalatedLessons)))}</td>
            <td className="px-2 tabular-nums">{dash(sumOrNull(rows.map(r => r.openNc)))} · {dash(sumOrNull(rows.map(r => r.overdueCars)))}</td>
            <td className="px-2">{escalated.length} escalated</td>
          </tr>
          {sorted.map(r => { const below = r.pqi !== null && r.target !== null && r.pqi < r.target; return <tr key={r.projectId} className="border-b last:border-0 hover:bg-[#BBA9D2]/15">
            <td className="px-2 py-2"><button type="button" className="text-left font-semibold underline-offset-2 hover:underline" style={{ color: C.purple }} onClick={() => projectAll(r)}>{r.projectName}</button><div className="text-[11px] text-muted-foreground">{r.bu} · {r.costCentre}</div></td>
            <td className="px-2 tabular-nums">{r.reportId ? <button type="button" className="font-semibold hover:underline" style={{ color: below ? C.fuchsia : undefined }} onClick={() => openReport(r)}>{dash(r.pqi, '%', 1)}</button> : '—'}<div className="text-[10px] text-muted-foreground">target {dash(r.target, '%')}</div></td>
            <td className="px-2 tabular-nums">{dash(r.closure, '%', 1)}</td><td className="px-2 tabular-nums">{dash(r.openNcr)} ({dash(r.over45)})</td>
            <td className="px-2 tabular-nums">{dash(r.csat, '', 2)}<span className="text-[10px] text-muted-foreground"> ({r.responses})</span></td>
            <td className="px-2 tabular-nums">{dash(r.negativeLessons)} · {dash(r.escalatedLessons)}</td><td className="px-2 tabular-nums">{dash(r.openNc)} · {dash(r.overdueCars)}</td>
            <td className="px-2"><span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: escColor(r.escalation) }}>{r.escalation || 'Normal'}{r.monthsBelow ? ` · ${r.monthsBelow} mo` : ''}</span></td>
          </tr>; })}</tbody></table>
        <p className="mt-2 text-[11px] text-muted-foreground">Escalation: Normal · L1 · L2 · L3 by consecutive approved months with closure below target in any category. PQI in fuchsia is below target.</p></div>}
  </section>;
}

/* ---------- daily ---------- */
function StatusBlock({ title, values, color, onDrill, mode }: { title: string; values: Record<string, number>; color: string; onDrill: () => void; mode: string }) {
  const entries = Object.entries(values);
  return <button type="button" onClick={onDrill} className="rounded-xl border bg-card p-4 text-left transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2" style={{ borderTop: `4px solid ${color}` }}>
    <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color }}>{title}</p>
    {entries.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No data</p> : <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">{entries.map(([k, v]) => <div key={k}><dt className="text-[10.5px] capitalize text-muted-foreground">{k.replace(/([A-Z])/g, ' $1')}</dt><dd className="font-[Outfit,sans-serif] text-xl font-bold tabular-nums" style={{ color: v < 0 ? C.fuchsia : undefined }}>{mode === 'movement' ? signed(v) : v}</dd></div>)}</dl>}
  </button>;
}

const APPROVAL_LABEL = (props: { x?: number; y?: number; width?: number; height?: number; index?: number; data: Point[] }) => {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, data } = props; const p = data[index];
  const total = num(p?.total); const approved = num(p?.approved);
  if (!total || approved === null || ![x, y, width, height].every(Number.isFinite)) return <g />;
  return <text x={x + width + 4} y={y + height / 2} dy={3} fontSize={10} fill={C.purple} fontWeight={700}>{((approved / total) * 100).toFixed(0)}%</text>;
};

function Daily({ data, onDrill }: { data: DashboardData; onDrill: (d: Drill) => void }) {
  const d = data.daily; const mv = data.mode === 'movement';
  const [showAll, setShowAll] = useState(false);
  const bott = [...d.bottlenecks].sort((a, b) => b.total - a.total);
  const src = (title: string, projectId?: string): Drill => ({ title, module: 'daily', state: 'approved', projectId, snapshotOnly: true });
  const disc: Series[] = [{ key: 'approved', name: 'Approved', color: C.cyan }, { key: 'resubmit', name: 'Resubmit', color: C.amber }, { key: 'rejected', name: 'Rejected', color: C.fuchsia }, { key: 'underReview', name: 'Under review', color: C.lilac }];
  return <>
    <p className="text-xs text-muted-foreground">{mv ? 'Movement = end snapshot minus start snapshot; negative values shown. Pending ageing and bottlenecks use the end snapshot.' : 'Cumulative snapshot at the report date.'} · {d.selectedReports} approved daily report(s)</p>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatusBlock title="Total documents" values={d.selectedReports ? d.total : {}} color={C.purple} mode={data.mode} onDrill={() => onDrill(src('Total documents · source daily reports'))} />
      <StatusBlock title="Submittals" values={d.selectedReports ? d.submittals : {}} color={C.cyan} mode={data.mode} onDrill={() => onDrill(src('Submittals · source daily reports'))} />
      <StatusBlock title="Drawings" values={d.selectedReports ? d.drawings : {}} color={C.fuchsia} mode={data.mode} onDrill={() => onDrill(src('Drawings · source daily reports'))} />
      <StatusBlock title="Correspondence" values={d.selectedReports ? { incoming: d.correspondence.incoming, outgoing: d.correspondence.outgoing } : {}} color={C.amber} mode={data.mode} onDrill={() => onDrill(src('Correspondence · source daily reports'))} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      <Lane color={C.purple} title="By discipline" eyebrow={mv ? 'Movement (counts)' : 'Status · approval %'}>
        <ChartBox title={mv ? 'Change in documents by status' : 'Documents by status, approval % at bar end'} empty={!d.selectedReports || !hasData(d.disciplines)} height={260}>
          <SeriesBars data={d.disciplines} layout="vertical" stacked series={disc} signedValues={mv} approvalLabels={!mv} extraTip={p => mv ? `net ${signed(num(p.total))}` : `total ${num(p.total) ?? '—'}`} onPick={p => onDrill(src(`${p.name} · source daily reports`))} />
        </ChartBox>
      </Lane>
      <Lane color={C.cyan} title="By document type" eyebrow={mv ? 'Movement' : 'Share of total'}>
        <ChartBox title={mv ? 'Change by document type' : 'Documents by type'} empty={!d.selectedReports || !hasData(d.documentTypes)} height={260}>
          <SeriesBars data={d.documentTypes} layout="vertical" signedValues={mv} series={[{ key: 'value', name: 'Documents', color: C.cyan }]} extraTip={p => num(p.share) === null ? null : `${num(p.share)!.toFixed(1)}% share`} onPick={p => onDrill(src(`${p.name} · source daily reports`))} />
        </ChartBox>
      </Lane>
      <Lane color={C.fuchsia} title="Revisions" eyebrow={mv ? 'Movement (counts)' : '% of drawings + submittals'}>
        <ChartBox title={mv ? 'Change in count by revision' : 'Share by revision (combined D+S denominator)'} empty={!d.selectedReports || !hasData(d.revisions)} height={260}>
          <SeriesBars data={d.revisions} pct={!mv} signedValues={mv}
            series={mv ? [{ key: 'drawingCount', name: 'Drawings', color: C.fuchsia }, { key: 'submittalCount', name: 'Submittals', color: C.cyan }] : [{ key: 'drawings', name: 'Drawings %', color: C.fuchsia }, { key: 'submittals', name: 'Submittals %', color: C.cyan }]}
            extraTip={p => mv ? null : `D ${num(p.drawingCount) ?? '—'} · S ${num(p.submittalCount) ?? '—'}`} onPick={p => onDrill(src(`Revision ${p.name} · source daily reports`))} />
        </ChartBox>
      </Lane>
      <Lane color={C.amber} title="Pending ageing" eyebrow="End snapshot">
        <ChartBox title="Pending by elapsed days" empty={!hasData(d.pending)} height={220}>
          <SeriesBars data={d.pending} stacked series={[{ key: 'upTo7', name: '≤7 d', color: C.cyan }, { key: 'days8To30', name: '8–30 d', color: C.amber }, { key: 'over30', name: '>30 d', color: C.fuchsia }]} onPick={p => onDrill(src(`Pending · ${p.name} · source daily reports`))} />
        </ChartBox>
      </Lane>
      <Lane color={C.purple} title="14-day trend" eyebrow="Approved dailies">
        <ChartBox title="Drawings and submittals (gaps = no approved report)" empty={!hasData(d.trend)} height={220}>
          <LineChart data={d.trend} margin={{ left: -18, right: 8 }}><CartesianGrid strokeDasharray="2 4" stroke={`${C.lilac}66`} vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip {...tip} formatter={(v: unknown, n: unknown) => [v === null || v === undefined ? 'No approved report' : String(v), String(n)]} /><Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Line dataKey="drawings" name="Drawings" stroke={C.fuchsia} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} /><Line dataKey="submittals" name="Submittals" stroke={C.cyan} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} /></LineChart>
        </ChartBox>
      </Lane>
      <Lane color={C.fuchsia} title="Bottlenecks" eyebrow="Pending with · end snapshot">
        <p className="mb-2 text-xs text-muted-foreground">Pending ≥31 days · top 5 projects</p>
        {bott.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No pending documents.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left"><th className="py-2">Project</th><th className="p-2 text-right">Client</th><th className="p-2 text-right">Algihaz</th><th className="p-2 text-right">Supplier</th><th className="p-2 text-right">Total</th></tr></thead><tbody>
          {(showAll ? bott : bott.slice(0, 5)).map(b => <tr key={b.projectId} className="border-b"><td className="py-2"><Link href={`/qaqc/daily/${b.reportId}`} className="font-medium underline" style={{ color: C.purple }}>{b.projectName}</Link></td><td className="p-2 text-right tabular-nums">{b.client}</td><td className="p-2 text-right tabular-nums">{b.algihaz}</td><td className="p-2 text-right tabular-nums">{b.supplier}</td><td className="p-2 text-right font-bold tabular-nums">{b.total}</td></tr>)}
        </tbody></table></div>}
        {bott.length > 5 && <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show top 5' : `View all ${bott.length} projects`}</Button>}
      </Lane>
    </div>
  </>;
}

/* ---------- drilldown ---------- */
function DrillDialog({ drill, records, onClose }: { drill: Drill | null; records: DashboardRecord[]; onClose: () => void }) {
  const list = drill ? filterRecords(records, drill) : [];
  return <Dialog open={!!drill} onOpenChange={o => !o && onClose()}><DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle style={{ color: C.purple }}>{drill?.title}</DialogTitle>
      <DialogDescription>{list.length} matching record{list.length === 1 ? '' : 's'}{drill?.state ? ` · state ${drill.state}` : ''}{drill?.period ? ` · ${displayPeriod(drill.period)}` : ''}</DialogDescription></DialogHeader>
    {list.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No matching records for this selection.</p> :
      <ul className="divide-y">{list.map(r => <li key={`${r.type}-${r.id}`}><Link href={r.href} onClick={onClose} className="flex items-center justify-between gap-3 py-2.5 hover:bg-[#BBA9D2]/15">
        <span className="min-w-0"><span className="block truncate font-medium">{r.id.startsWith('missing-') ? `${r.projectName} · no report yet` : r.title}</span><span className="text-xs text-muted-foreground">{r.projectName} · {r.type} · {displayPeriod(r.period)}{r.category ? ` · ${r.category}` : ''}{r.impact ? ` · ${r.impact}` : ''}</span></span>
        <span className="flex shrink-0 items-center gap-2"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${C.lilac}55`, color: C.purple }}>{r.id.startsWith('missing-') ? 'Create report' : r.state}</span><ChevronRight className="size-4" /></span>
      </Link></li>)}</ul>}
    <p className="border-t pt-2 text-right text-xs text-muted-foreground">Total: {list.length}</p>
  </DialogContent></Dialog>;
}

export default ConsolidatedDashboardPage;
