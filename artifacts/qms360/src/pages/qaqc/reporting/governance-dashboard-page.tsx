import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, ArrowUpRight, ClipboardList, FileSpreadsheet, Gauge, ShieldAlert, Smile, TrendingUp, X } from 'lucide-react';
import { exportQaqcSowDashboard, getGetQaqcSowContextQueryKey, getGetQaqcSowDashboardQueryKey, useGetQaqcSowContext, useGetQaqcSowDashboard } from '@workspace/api-client-react';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { Obj, ReportType } from './reporting-types';
import { ErrorBox, errMsg, saveFile, useBusy } from './shell';
import { auditStats, averagePqi, averageVariance, categoryRows, closure, csatSummary, dailyDisciplines, dash, dashboardDateParams, latestPerProject, monthlyDocuments, qmsStats, scopeRows, submissionStatus } from './governance-dashboard-calc';

const ALL = 'all';
const PURPLE = 'hsl(var(--chart-1))', TEAL = 'hsl(var(--chart-2))', YELLOW = 'hsl(var(--chart-3))', FUCHSIA = 'hsl(var(--chart-4))';

export function GovernanceDashboardPage() {
  const cap = useQaqcCapabilities();
  const readable = (['monthly', 'daily', 'csat'] as ReportType[]).filter(t => cap.canAnyRead(`${t}_reports`));
  if (cap.isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!readable.length) return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><ShieldAlert className="size-8 text-muted-foreground" /><p className="font-semibold">You do not have access to QA/QC report data.</p><p className="max-w-md text-sm text-muted-foreground">This dashboard needs read access to monthly, daily or Customer Satisfaction (CSAT) reports. Ask your QA/QC administrator if you need it.</p></CardContent></Card>;
  return <Dashboard ctxType={readable[0]!} canMonthly={readable.includes('monthly')} canDaily={readable.includes('daily')} canCsat={readable.includes('csat')} canExport={cap.can('monthly_reports', 'export') || cap.can('daily_reports', 'export') || cap.can('csat_reports', 'export')} />;
}

function Dashboard({ ctxType, canMonthly, canDaily, canCsat, canExport }: { ctxType: ReportType; canMonthly: boolean; canDaily: boolean; canCsat: boolean; canExport: boolean }) {
  const { toast } = useToast(); const { busy, run } = useBusy();
  const [group, setGroup] = useState(ALL); const [projectId, setProjectId] = useState(ALL);
  const [month, setMonth] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [tab, setTab] = useState<'monthly' | 'daily'>(canMonthly || canCsat ? 'monthly' : 'daily');
  const [list, setList] = useState<{ title: string; rows: Obj[] } | null>(null);
  const fresh = { staleTime: 30_000, refetchOnWindowFocus: true, refetchOnMount: 'always' as const };
  const ctx = useGetQaqcSowContext({ reportType: ctxType }, { query: { ...fresh, queryKey: getGetQaqcSowContextQueryKey({ reportType: ctxType }) } });
  const dailyCtx = useGetQaqcSowContext({ reportType: 'daily' }, { query: { ...fresh, queryKey: getGetQaqcSowContextQueryKey({ reportType: 'daily' }), enabled: canDaily && ctxType !== 'daily' } });
  const csatCtx = useGetQaqcSowContext({ reportType: 'csat' }, { query: { ...fresh, queryKey: getGetQaqcSowContextQueryKey({ reportType: 'csat' }), enabled: canCsat && ctxType !== 'csat' } });
  const projects: Obj[] = [...new Map([ctx.data, canDaily && dailyCtx.data, canCsat && csatCtx.data]
    .flatMap(data => ((data || {}) as Obj).projects ?? []).map((p: Obj) => [p.id, p])).values()];
  const groups = Array.from(new Set(projects.map(p => p.group).filter(Boolean))) as string[];
  const shown = projects.filter(p => group === ALL || p.group === group);
  const rangeOk = !!from && !!to && from <= to;
  const params = { ...(group !== ALL ? { projectGroup: group } : {}), ...(projectId !== ALL ? { projectId } : {}), ...dashboardDateParams(month, from, to) };
  const q = useGetQaqcSowDashboard(params, { query: { ...fresh, queryKey: getGetQaqcSowDashboardQueryKey(params) } });
  const contextError = ctx.error || (canDaily && dailyCtx.error) || (canCsat && csatCtx.error);
  const contextLoading = ctx.isLoading || (canDaily && ctxType !== 'daily' && dailyCtx.isLoading) || (canCsat && ctxType !== 'csat' && csatCtx.isLoading);
  const filtered = group !== ALL || projectId !== ALL || !!month || !!from || !!to;
  const clear = () => { setGroup(ALL); setProjectId(ALL); setMonth(''); setFrom(''); setTo(''); };
  const exportXlsx = () => run(async () => { try { saveFile(await exportQaqcSowDashboard({ ...params, format: 'xlsx' }), 'qaqc-governance-dashboard.xlsx'); } catch (e) { toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }); } });

  const field = (id: string, l: string, el: ReactNode) => <div className="space-y-1.5"><Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{l}</Label>{el}</div>;
  return <div className="space-y-6">
    <header className="rise-in flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-accent">QA/QC Dashboard</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight md:text-3xl">Quality and Document Governance Dashboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Consolidated QA/QC, CSAT and document submission analytics from your authorized saved reports. Includes <span className="font-semibold text-foreground">submitted and approved</span> reports.</p></div>
      <div className="flex gap-2">
        {canExport && <Button variant="secondary" disabled={busy || (!!from || !!to) && !rangeOk} onClick={exportXlsx} data-testid="button-export-consolidated"><FileSpreadsheet className="mr-2 size-4" />{busy ? 'Exporting...' : 'Export consolidated'}</Button>}
        <Button variant="outline" disabled={!filtered} onClick={clear} data-testid="button-clear-filters"><X className="mr-2 size-4" />Clear</Button>
      </div>
    </header>

    <Card className="rise-in delay-1"><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      {field('gd-bu', 'Business unit (project group)', <Select value={group} onValueChange={v => { setGroup(v); setProjectId(ALL); }}><SelectTrigger id="gd-bu" data-testid="select-bu"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All business units</SelectItem>{groups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select>)}
      {field('gd-project', 'Project', <Select value={projectId} onValueChange={setProjectId}><SelectTrigger id="gd-project" data-testid="select-project"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All projects</SelectItem>{shown.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select>)}
      {field('gd-month', 'Reporting period', <Input id="gd-month" type="month" value={month} onChange={e => { setMonth(e.target.value); setFrom(''); setTo(''); }} data-testid="input-period" />)}
      {field('gd-from', 'Date range from', <Input id="gd-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setMonth(''); }} data-testid="input-from" />)}
      {field('gd-to', 'Date range to', <Input id="gd-to" type="date" value={to} onChange={e => { setTo(e.target.value); setMonth(''); }} data-testid="input-to" />)}
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">Business unit groups projects as configured in the project master; strategic business group metadata is not available, so it is not offered. The date range applies daily net movement (end snapshot minus start snapshot).{(from || to) && !rangeOk && <span className="ml-1 font-medium text-destructive">Enter both dates with from on or before to.</span>}</p>
    </CardContent></Card>

    <div role="tablist" aria-label="Dashboard view" className="inline-flex rounded-lg border bg-muted/60 p-1">
      {([['monthly', 'Monthly QA/QC & QMS', canMonthly || canCsat], ['daily', 'Daily Document Governance', canDaily]] as const).filter(t => t[2]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === k ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>)}
    </div>

    {q.isLoading || contextLoading ? <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-64" /></div>
      : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} />
      : contextError ? <ErrorBox error={contextError} retry={() => { void ctx.refetch(); if (canDaily) void dailyCtx.refetch(); if (canCsat) void csatCtx.refetch(); }} />
      : <Body d={(q.data ?? {}) as Obj} tab={tab} visibleProjects={projectId !== ALL ? 1 : shown.length} canMonthly={canMonthly} canCsat={canCsat} onList={setList} filtered={filtered} clear={clear} />}

    <Dialog open={!!list} onOpenChange={o => !o && setList(null)}><DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{list?.title}</DialogTitle><DialogDescription>Authorized monthly reports matching the current filters.</DialogDescription></DialogHeader>
      {list?.rows.length ? <ul className="max-h-80 space-y-1 overflow-y-auto">{list.rows.map((r, i) => <li key={r.id ?? i}>{r.id ? <Link href={`/qaqc/monthly/${r.id}`} className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"><span>{r.projectName ?? r.projectId} <span className="text-muted-foreground">{String(r.period).slice(0, 7)}</span></span><ArrowUpRight className="size-4 text-primary" /></Link> : <span className="block px-3 py-2 text-sm">{r.projectName ?? r.projectId}</span>}</li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">No reports in this status.</p>}
    </DialogContent></Dialog>
  </div>;
}

function Panel({ title, sub, children, className = '' }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return <Card className={`rise-in transition-shadow hover:soft-shadow ${className}`}><CardHeader className="pb-3"><CardTitle className="text-base font-semibold">{title}</CardTitle>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</CardHeader><CardContent>{children}</CardContent></Card>;
}
function Kpi({ label, value, sub, icon, tone }: { label: string; value: string; sub: ReactNode; icon: ReactNode; tone: string }) {
  return <Card className="rise-in transition-transform hover:-translate-y-0.5"><CardContent className="p-5"><div className="flex items-start justify-between text-sm text-muted-foreground">{label}<span className={tone}>{icon}</span></div><p className="mt-2 font-display text-3xl font-bold tabular-nums" data-testid={`kpi-${label}`}>{value}</p><div className="mt-1 text-xs text-muted-foreground">{sub}</div></CardContent></Card>;
}
const Unavailable = ({ text }: { text: string }) => <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground"><AlertCircle className="size-4 shrink-0" />{text}</div>;

function Body({ d, tab, visibleProjects, canMonthly, canCsat, onList, filtered, clear }: { d: Obj; tab: 'monthly' | 'daily'; visibleProjects: number; canMonthly: boolean; canCsat: boolean; onList: (l: { title: string; rows: Obj[] }) => void; filtered: boolean; clear: () => void }) {
  const monthlyAll: Obj[] = d.monthly ?? []; const csat: Obj[] = scopeRows(d.csat, null); const daily: Obj[] = d.daily ?? [];
  const monthly = useMemo(() => latestPerProject(monthlyAll), [monthlyAll]);
  const empty = !monthlyAll.length && !csat.length && !daily.length;
  if (tab === 'daily') return <Daily daily={daily} />;
  const pqi = averagePqi(monthly), variance = averageVariance(monthly), cl = closure(monthly), ncr = closure(monthly, ['external_ncr', 'internal_ncr']);
  const cs = csatSummary(csat), sub = submissionStatus(monthlyAll, visibleProjects), cats = categoryRows(monthly), docs = monthlyDocuments(monthly), qms = qmsStats(monthly), audit = auditStats(monthly);
  const csatByProject = new Map(latestPerProject(csat).map(r => [String(r.projectId), r]));
  const recent = [...monthlyAll.map(r => ['monthly', r] as const), ...csat.map(r => ['csat', r] as const), ...daily.map(r => ['daily', r] as const)].filter(([, r]) => r.id).sort((a, b) => String(b[1].period).localeCompare(String(a[1].period))).slice(0, 8);
  const tiles: [string, number, Obj[] | null, string][] = [['Visible projects', sub.visibleProjects, null, 'text-foreground'], ['Projects reporting', sub.reporting, latestPerProject(monthlyAll), 'text-primary'], ['Pending approval', sub.submitted.length, sub.submitted, 'text-[hsl(var(--ag-yellow))]'], ['Approved', sub.approved.length, sub.approved, 'text-accent']];
  return <div className="space-y-6">
    {empty && <Card><CardContent className="flex flex-wrap items-center gap-3 py-5 text-sm text-muted-foreground"><ClipboardList className="size-5 shrink-0" /><p>No submitted or approved reports match these filters.</p>{filtered && <Button variant="outline" size="sm" onClick={clear}>Clear filters</Button>}</CardContent></Card>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Project Quality Index" value={dash(pqi, 1, '%')} icon={<Gauge className="size-4" />} tone="text-primary" sub={<>{canMonthly ? `Avg of latest accumulated PQI, ${monthly.length} project(s)` : 'Monthly access required'}{variance !== null && <span className={`ml-1 font-medium ${variance >= 0 ? 'text-accent' : 'text-destructive'}`}>{variance >= 0 ? '+' : ''}{variance.toFixed(1)} variance</span>}</>} />
      <Kpi label="Overall Closure Rate" value={dash(cl.rate, 1, '%')} icon={<TrendingUp className="size-4" />} tone="text-accent" sub={`${cl.closed}/${cl.issued} closed across NCR, RFI, RMI`} />
      <Kpi label="CSAT Average" value={cs.average === null ? '\u2014' : `${cs.average.toFixed(2)} / 5`} icon={<Smile className="size-4" />} tone="text-[hsl(var(--ag-yellow))]" sub={canCsat ? `${cs.responses} responses, ${dash(cs.recommendPct, 0, '%')} recommend` : 'CSAT access required'} />
      <Kpi label="Open NCRs" value={ncr.open === null ? '\u2014' : String(ncr.open)} icon={<ShieldAlert className="size-4" />} tone="text-destructive" sub="External + internal, latest accumulated" />
    </div>

    {canMonthly && <Panel title="Monthly QA/QC submission status" sub="Counts from authorized monthly reports in scope. Select a number to see the list. Drafts are not included in this view.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles.map(([l, n, rows, tone]) => {
        const inner = <><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p><p className={`mt-1 font-display text-3xl font-bold tabular-nums ${tone}`}>{n}</p>{rows && <p className="mt-1 text-xs text-primary">View list</p>}</>;
        return rows ? <button key={l} onClick={() => onList({ title: l, rows })} data-testid={`tile-${l}`} className="rounded-lg border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{inner}</button> : <div key={l} className="rounded-lg border bg-muted/30 p-4">{inner}</div>;
      })}</div>
    </Panel>}

    {canMonthly && <Panel title="Projects overview" sub="Latest monthly report per project. Select a card to open the report.">
      {monthly.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{monthly.map(r => { const c = closure([r]); const nc = closure([r], ['external_ncr', 'internal_ncr']); const cr = csatByProject.get(String(r.projectId)); const p = r.computed?.pqi?.accumulated;
        return <Link key={r.id ?? r.projectId} href={r.id ? `/qaqc/monthly/${r.id}` : '/qaqc/monthly'} className="group rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:soft-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{r.projectName ?? r.projectId}</p><p className="text-xs text-muted-foreground">{String(r.period).slice(0, 7)}</p></div><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.state === 'approved' ? 'bg-accent/15 text-accent' : 'bg-[hsl(var(--ag-yellow)/.18)] text-foreground'}`}>{r.state === 'approved' ? 'Approved' : 'Pending approval'}</span></div>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-center">{([['PQI', p === undefined || p === null ? '\u2014' : `${Number(p).toFixed(1)}%`], ['Closure', dash(c.rate, 0, '%')], ['Open NCR', nc.open === null ? '\u2014' : String(nc.open)], ['CSAT', cr?.computed?.averageRating != null ? Number(cr.computed.averageRating).toFixed(1) : '\u2014']] as const).map(([k, v]) => <div key={k}><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums text-primary">{v}</dd></div>)}</dl>
        </Link>; })}</div> : <Unavailable text="No monthly reports in scope." />}
    </Panel>}

    {canMonthly && <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="QA/QC categories" sub="Accumulated issued vs closed from the latest monthly report per project.">
        {monthly.length ? <div className="h-64" role="img" aria-label="Issued and closed by category"><ResponsiveContainer><BarChart data={cats}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip cursor={{ fill: 'hsl(var(--muted))' }} /><Legend /><Bar dataKey="issued" name="Issued" fill={PURPLE} radius={[4, 4, 0, 0]} /><Bar dataKey="closed" name="Closed" fill={TEAL} radius={[4, 4, 0, 0]} /><Bar dataKey="open" name="Open" fill={FUCHSIA} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Unavailable text="No monthly category data." />}
      </Panel>
      <Panel title="Monthly documents" sub="Drawings and submittals status counts reported in monthly reports.">
        {docs.has ? <div className="h-64" role="img" aria-label="Monthly document statuses"><ResponsiveContainer><BarChart data={docs.rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip cursor={{ fill: 'hsl(var(--muted))' }} /><Legend /><Bar dataKey="drawings" name="Drawings" fill={PURPLE} radius={[4, 4, 0, 0]} /><Bar dataKey="submittals" name="Submittals" fill={YELLOW} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Unavailable text="No document counts reported." />}
      </Panel>
    </div>}

    {canCsat && <Panel title="Customer Satisfaction (CSAT)" sub="Average rating per dimension (1 to 5) and recommendation responses.">
      {cs.responses ? <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <ul className="space-y-2.5">{cs.dims.map(x => <li key={x.key} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm"><span className="text-muted-foreground">{x.label}</span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full origin-left rounded-full bg-primary transition-transform duration-700" style={{ transform: `scaleX(${(x.value ?? 0) / 5})` }} /></span><span className="text-right font-semibold tabular-nums">{dash(x.value, 2)}</span></li>)}</ul>
        <div className="grid grid-cols-3 gap-2 self-start">{Object.entries(cs.recommend).map(([k, v]) => <div key={k} className="rounded-lg border p-3 text-center"><p className="text-xs text-muted-foreground">{k}</p><p className="font-display text-2xl font-bold tabular-nums">{v}</p></div>)}<p className="col-span-3 text-xs text-muted-foreground">Would recommend</p></div>
      </div> : <Unavailable text="No CSAT responses in scope." />}
    </Panel>}

    {canMonthly && <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="QMS statistics" sub="QMS document register rows reported in monthly reports.">
        {qms.total ? <div className="space-y-4"><p className="text-sm"><span className="font-display text-2xl font-bold">{qms.total}</span> <span className="text-muted-foreground">documents</span></p>
          {[['By status', qms.byStatus], ['By type', qms.byType]].map(([t, o]) => <div key={t as string}><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t as string}</p><div className="flex flex-wrap gap-2">{Object.entries(o as Record<string, number>).map(([k, v]) => <span key={k} className="rounded-md border px-2.5 py-1 text-xs"><span className="text-muted-foreground">{k}</span> <span className="font-semibold">{v}</span></span>)}</div></div>)}</div> : <Unavailable text="No QMS register rows reported." />}
      </Panel>
      <Panel title="Internal audits" sub="From the internal audit section of the latest monthly reports.">
        {audit.reported ? <div className="space-y-3"><div className="grid grid-cols-3 gap-2">{([['Reported', audit.reported], ['Conducted', audit.conducted], ['Next date passed', audit.overdueNext]] as const).map(([k, v]) => <div key={k} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="font-display text-2xl font-bold tabular-nums">{v}</p></div>)}</div>
          {audit.upcoming.length > 0 && <ul className="divide-y text-sm">{audit.upcoming.slice(0, 5).map((u, i) => <li key={i} className="flex justify-between py-2"><span>{u.report.projectName ?? u.report.projectId}</span><span className="tabular-nums text-muted-foreground">Next {u.nextDate}</span></li>)}</ul>}</div> : <Unavailable text="Internal audit data unavailable in the reports in scope." />}
      </Panel>
    </div>}

    <Panel title="Recent reports" sub="Most recent authorized reports in scope.">
      {recent.length ? <ul className="divide-y">{recent.map(([t, r]) => <li key={r.id}><Link href={`/qaqc/${t}/${r.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted"><span className="min-w-0 truncate"><span className="font-medium">{r.projectName ?? r.projectId}</span> <span className="text-muted-foreground">{t === 'csat' ? 'CSAT' : t === 'monthly' ? 'Monthly' : 'Daily'} · {String(r.period)}</span></span><ArrowUpRight className="size-4 shrink-0 text-primary" /></Link></li>)}</ul> : <Unavailable text="No reports to open." />}
    </Panel>
  </div>;
}

function Daily({ daily }: { daily: Obj[] }) {
  if (!daily.length) return <Unavailable text="No daily reports in scope." />;
  const dd = dailyDisciplines(daily); const latest = latestPerProject(daily);
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-3">
      <Kpi label="Projects with daily data" value={String(dd.projects)} icon={<ClipboardList className="size-4" />} tone="text-primary" sub="Latest record per project" />
      <Kpi label="Pending documents" value={String(dd.pending)} icon={<AlertCircle className="size-4" />} tone="text-destructive" sub={dd.movement ? 'Net movement in range' : 'Latest cumulative snapshot'} />
      <Kpi label="View" value={dd.movement ? 'Movement' : 'Snapshot'} icon={<TrendingUp className="size-4" />} tone="text-accent" sub="Snapshots are never summed across days" />
    </div>
    <Panel title="Drawings and submittals by discipline" sub={dd.movement ? 'Net movement per discipline and status.' : 'Latest cumulative snapshot per project, combined across projects.'}>
      <div className="h-72" role="img" aria-label="Discipline statuses"><ResponsiveContainer><BarChart data={dd.rows}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="discipline" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip cursor={{ fill: 'hsl(var(--muted))' }} /><Legend /><Bar dataKey="Approved" stackId="a" fill={TEAL} /><Bar dataKey="Under review" stackId="a" fill={PURPLE} /><Bar dataKey="Resubmit" stackId="a" fill={YELLOW} /><Bar dataKey="Rejected" stackId="a" fill={FUCHSIA} /></BarChart></ResponsiveContainer></div>
    </Panel>
    <Panel title="Latest daily reports"><ul className="divide-y">{latest.map(r => <li key={r.id ?? r.projectId}>{r.id ? <Link href={`/qaqc/daily/${r.id}`} className="flex justify-between rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted"><span className="font-medium">{r.projectName ?? r.projectId}</span><span className="text-muted-foreground">{r.period}</span></Link> : <span className="block px-2 py-2.5 text-sm">{r.projectName ?? r.projectId}</span>}</li>)}</ul></Panel>
  </div>;
}
