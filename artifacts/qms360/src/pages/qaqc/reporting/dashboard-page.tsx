import { useState } from 'react';
import { Link } from 'wouter';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { exportQaqcSowDashboard, useGetQaqcSowContext, useGetQaqcSowDashboard } from '@workspace/api-client-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CSAT_RATINGS, DISCIPLINES, DISC_STATUSES, DOC_TYPES, ENTITIES, METRICS, PEND_BUCKETS, PEND_STATUSES, fmt, num, type Obj } from './reporting-types';
import { ErrorBox, Loading, PageFrame, errMsg, saveFile, useBusy } from './shell';
import { BUILTIN_TEMPLATE, PdfTemplatePicker } from './pdf-template-picker';

const ALL = 'all';
type Mode = 'latest' | 'date' | 'range';

export function DashboardPage() {
  const { toast } = useToast(); const { busy, run } = useBusy();
  const [group, setGroup] = useState(ALL); const [projectId, setProjectId] = useState(ALL); const [category, setCategory] = useState(ALL);
  const [month, setMonth] = useState(''); const [mode, setMode] = useState<Mode>('latest'); const [date, setDate] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const ctx = useGetQaqcSowContext({});
  const projects: Obj[] = ((ctx.data ?? {}) as Obj).projects ?? [];
  const groups = Array.from(new Set(projects.map(p => p.group).filter(Boolean))) as string[];
  const shown = projects.filter(p => group === ALL || p.group === group);
  const params = {
    ...(group !== ALL ? { projectGroup: group } : {}), ...(projectId !== ALL ? { projectId } : {}), ...(category !== ALL ? { category } : {}),
    ...(month ? { period: `${month}-01` } : {}), ...(mode === 'date' && date ? { period: date } : {}), ...(mode === 'range' && from && to ? { from, to } : {}),
  };
  const [tplType, setTplType] = useState<'monthly' | 'daily' | 'csat'>('monthly');
  const [templateId, setTemplateId] = useState(BUILTIN_TEMPLATE);
  const q = useGetQaqcSowDashboard(params);
  const label = mode === 'range' && from && to ? `Net movement from ${from} to ${to}: end snapshot minus start snapshot, not a sum of daily entries.`
    : mode === 'date' && date ? `Net movement on ${date}: that day's snapshot minus the preceding snapshot.` : 'Latest cumulative snapshot of daily reports.';
  const download = (format: 'pdf' | 'xlsx') => run(async () => { try { saveFile(await exportQaqcSowDashboard({ ...params, format, ...(format === 'pdf' ? { templateId } : {}) }), `qaqc-dashboard.${format}`); } catch (e) { toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }); } });
  const field = (l: string, el: React.ReactNode) => <div className="space-y-1"><Label className="text-xs text-muted-foreground">{l}</Label>{el}</div>;
  return <PageFrame title="Reporting dashboard" description="Monthly KPIs, closure trends, Customer Satisfaction (CSAT) and daily document snapshots from submitted reports."
    actions={<><Button variant="secondary" disabled={busy} onClick={() => download('xlsx')}><FileSpreadsheet className="mr-2 size-4" />XLSX</Button><Button variant="secondary" disabled={busy} onClick={() => download('pdf')}><FileText className="mr-2 size-4" />PDF</Button></>}>
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {field('Project group', <Select value={group} onValueChange={v => { setGroup(v); setProjectId(ALL); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All groups</SelectItem>{groups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select>)}
      {field('Project', <Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All projects</SelectItem>{shown.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>)}
      {field('Month', <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />)}
      {field('Category', <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All categories</SelectItem>{METRICS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>)}
      {field('Daily view', <Select value={mode} onValueChange={v => setMode(v as Mode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="latest">Latest snapshot</SelectItem><SelectItem value="date">Past date (net movement)</SelectItem><SelectItem value="range">Custom range (net movement)</SelectItem></SelectContent></Select>)}
      {mode === 'date' && field('Date', <Input type="date" value={date} onChange={e => setDate(e.target.value)} />)}
      {mode === 'range' && <>{field('From', <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />)}{field('To', <Input type="date" value={to} onChange={e => setTo(e.target.value)} />)}</>}
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4" data-testid="dashboard-pdf-form">
        {field('PDF form type', <Select value={tplType} onValueChange={v => { setTplType(v as typeof tplType); setTemplateId(BUILTIN_TEMPLATE); }}><SelectTrigger className="w-64 max-w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="csat">Customer Satisfaction (CSAT)</SelectItem></SelectContent></Select>)}
        <PdfTemplatePicker reportType={tplType} kind="dashboard" value={templateId} onChange={setTemplateId} />
        <p className="text-xs text-muted-foreground">Applies to PDF export only. XLSX is unchanged.</p>
      </div>
    </CardContent></Card>
    <Alert><AlertTitle>{mode === 'latest' ? 'Snapshot view' : 'Net movement view'}</AlertTitle><AlertDescription>{label}</AlertDescription></Alert>
    {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <Results d={(q.data ?? {}) as Obj} mode={mode} />}
  </PageFrame>;
}

function Grid({ title, note, cols, rows }: { title: string; note?: string; cols: string[]; rows: (string | number)[][] }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle>{note && <p className="text-xs text-muted-foreground">{note}</p>}</CardHeader><CardContent className="overflow-x-auto">
    {rows.length ? <Table><TableHeader><TableRow>{cols.map((c, i) => <TableHead key={i} className={i ? 'text-right' : ''}>{c}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((r, i) => <TableRow key={i}>{r.map((v, j) => <TableCell key={j} className={j ? 'text-right tabular-nums' : 'font-medium'}>{v}</TableCell>)}</TableRow>)}</TableBody></Table> : <p className="py-6 text-center text-sm text-muted-foreground">No submitted reports match these filters.</p>}
  </CardContent></Card>;
}
const pct = (v: unknown) => `${fmt(num(v))}%`;
const sget = (o: Obj, ...p: string[]) => p.reduce((a: any, k) => a?.[k], o);

function Results({ d, mode }: { d: Obj; mode: Mode }) {
  const monthly: Obj[] = d.monthly ?? []; const aggregates: Obj[] = d.aggregates ?? []; const csat: Obj[] = d.csat ?? []; const daily: Obj[] = d.daily ?? [];
  const name = (r: Obj) => r.projectName ?? r.projectId;
  const csatName = (r: Obj) => r.projectName ?? monthly.find(m => m.projectId === r.projectId)?.projectName ?? daily.find(m => m.projectId === r.projectId)?.projectName ?? r.projectId;
  const val = (r: Obj) => (r.movement && !r.absoluteSnapshot ? r.movement : r.snapshot) ?? {};
  const unit = mode === 'latest' ? 'Snapshot' : 'Net movement';
  const avgPqi = monthly.length ? monthly.reduce((a, r) => a + num(r.computed?.pqi?.accumulated), 0) / monthly.length : 0;
  const kpis: [string, string][] = [['Projects reporting monthly', String(new Set(monthly.map(m => m.projectId)).size)], ['Average PQI (accumulated)', pct(avgPqi)], ['Customer Satisfaction (CSAT) average (of 5)', fmt(num(d.csatAverage), 2)], ['Daily snapshots', String(daily.length)]];
  return <div className="space-y-6">
    {[...monthly, ...csat, ...daily].some(r => r.id) && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Open project reports</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
      {([['monthly', monthly], ['csat', csat], ['daily', daily]] as const).flatMap(([type, reports]) => reports.filter(r => r.id).map(r => <Link key={r.id} href={`/qaqc/${type}/${r.id}`} className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-muted">{name(r)} · {r.period} · {type === 'csat' ? 'Customer Satisfaction (CSAT)' : type}</Link>))}
    </CardContent></Card>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{kpis.map(([l, v]) => <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-bold tabular-nums">{v}</p></CardContent></Card>)}</div>
    <Grid title="Project KPI summary" note="Accumulated closure rate per category, latest submitted monthly report in each period." cols={['Project', 'Period', 'Status', 'PQI', 'PQI change', ...METRICS.map(([, l]) => `${l} closure`)]}
      rows={monthly.map(r => [name(r), String(r.period).slice(0, 7), String(r.state).replaceAll('_', ' '), pct(sget(r.computed, 'pqi', 'accumulated')), `${num(sget(r.computed, 'pqi', 'variance')) >= 0 ? '+' : ''}${fmt(num(sget(r.computed, 'pqi', 'variance')))}`, ...METRICS.map(([k]) => pct(sget(r.computed, 'metrics', k, 'accumulatedRate')))])} />
    <Grid title="Portfolio by period" note="Average PQI and closure rate across reporting projects." cols={['Period', 'Projects', 'Average PQI', ...METRICS.map(([, l]) => l)]} rows={aggregates.map(a => [String(a.period).slice(0, 7), a.projects, pct(a.averagePqi), ...METRICS.map(([k]) => pct(a.metrics?.[k]))])} />
    {METRICS.map(([k, l]) => <Grid key={k} title={`${l} - issued and closed`} cols={['Project', 'Period', 'Prev issued', 'Prev closed', 'Issued', 'Closed', 'Acc. issued', 'Acc. closed', 'Open', 'Monthly %', 'Accumulated %', 'Target']}
      rows={monthly.map(r => { const m = r.computed?.metrics?.[k] ?? {}; return [name(r), String(r.period).slice(0, 7), num(m.previousIssued), num(m.previousClosed), num(m.issued), num(m.closed), num(m.accumulatedIssued), num(m.accumulatedClosed), num(m.open), pct(m.monthlyRate), pct(m.accumulatedRate), pct(m.target)]; })} />)}
    <Grid title="Material inspections (MIRN)" cols={['Project', 'Period', 'Prev issued', 'Prev closed', 'Issued', 'Closed', 'Open', 'Accumulated %']} rows={monthly.map(r => { const m = r.computed?.material ?? {}; return [name(r), String(r.period).slice(0, 7), num(m.previousIssued), num(m.previousClosed), num(m.issued), num(m.closed), num(m.open), pct(m.accumulatedRate)]; })} />
    <Grid title="Customer Satisfaction (CSAT)" note="Six ratings, 1 to 5." cols={['Project', 'Date', ...CSAT_RATINGS.map(([, l]) => l), 'Average']} rows={csat.map(r => [csatName(r), String(r.period), ...CSAT_RATINGS.map(([k]) => num(r.data?.ratings?.[k])), fmt(num(r.computed?.averageRating), 2)])} />
    <Grid title={`Daily document governance - ${unit.toLowerCase()} by discipline`} note="Drawings (D) and submittals (S) totals across status." cols={['Project', 'Date', ...DISCIPLINES.flatMap(x => [`${x} D`, `${x} S`])]} rows={daily.map(r => [name(r), r.period, ...DISCIPLINES.flatMap(x => [num(val(r).disciplineTotals?.[`drawings.${x}`]), num(val(r).disciplineTotals?.[`submittals.${x}`])])])} />
    <Grid title={`Discipline statuses - ${unit.toLowerCase()}`} cols={['Project', 'Date', 'Category', 'Discipline', ...DISC_STATUSES.map(([, label]) => label), 'Total']}
      rows={daily.flatMap(r => ['drawings', 'submittals'].flatMap(category => DISCIPLINES.map(discipline => [name(r), r.period, category, discipline, ...DISC_STATUSES.map(([status]) => num(val(r).disciplines?.[category]?.[discipline]?.[status])), num(val(r).disciplineTotals?.[`${category}.${discipline}`])])))} />
    <Grid title={`Document types - ${unit.toLowerCase()}`} cols={['Project', 'Date', ...DOC_TYPES]} rows={daily.map(r => [name(r), r.period, ...DOC_TYPES.map(t => num(val(r).documentTypes?.[t]))])} />
    <Grid title={`Pending documents - ${unit.toLowerCase()}`} cols={['Project', 'Date', 'Entity', 'Total', ...PEND_STATUSES.map(([, l]) => `Status ${l}`)]}
      rows={daily.flatMap(r => ENTITIES.map(e => [name(r), r.period, e, num(val(r).pendingTotals?.[e]), ...PEND_STATUSES.map(([s]) => PEND_BUCKETS.reduce((a, [b]) => a + num(val(r).pending?.[e]?.[s]?.[b]), 0))]))} />
    <Grid title="Pending by ageing bucket" cols={['Project', 'Date', 'Entity', ...PEND_BUCKETS.map(([, l]) => l)]} rows={daily.flatMap(r => ENTITIES.map(e => [name(r), r.period, e, ...PEND_BUCKETS.map(([b]) => PEND_STATUSES.reduce((a, [s]) => a + num(val(r).pending?.[e]?.[s]?.[b]), 0))]))} />
    <Grid title={`Correspondence - ${unit.toLowerCase()}`} cols={['Project', 'Date', 'Incoming', 'Outgoing']} rows={daily.map(r => [name(r), r.period, num(val(r).correspondence?.incoming), num(val(r).correspondence?.outgoing)])} />
    <Grid title={`Revisions - ${unit.toLowerCase()}`} note="Matched by revision name. Removed revisions appear as negative movement in filtered views." cols={['Project', 'Date', 'Category', 'Revision', 'Value']}
      rows={daily.flatMap(r => (['drawings', 'submittals'] as const).flatMap(c => ((val(r).revisions?.[c] ?? []) as Obj[]).map(v => [name(r), r.period, c, String(v.name), num(v.value)])))} />
  </div>;
}
