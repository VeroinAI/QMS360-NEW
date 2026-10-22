import { formatDate, formatDateTime } from '@workspace/spreadsheet-dates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { saveQaqcHistoricalBalances, useGetQaqcHistoricalBalances, useGetQaqcHistoricalProjects } from '@workspace/api-client-react';
import { ArrowLeft, FileSpreadsheet, History, Lock, RefreshCw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { useToast } from '@/hooks/use-toast';
import type { Obj } from './reporting-types';
import { ErrorBox, Loading, PageFrame, StateBadge, errMsg, useInvalidate } from './shell';
import { historicalOps, isHoursField, monthToPeriod, reasonError, validateBalances, type HistField } from './historical-balances-validation';

import { historicalAuditChanges } from './historical-balances-validation';
import { HistoricalBulkExcel } from './historical-bulk-excel';
const SOURCE: Record<string, string> = { saved_setup: 'Saved go-live setup', previous_report: 'Carried from previous report', zero: 'No prior data (all zero)' };
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : v == null || v === '' ? '-' : String(v));
const status = (e: unknown) => (e as { status?: number })?.status;
type Change = { key: string; label: string; before: unknown; after: unknown };
type Pending = { kind: 'manual' | 'import'; balances: Record<string, number>; reason: string; version: number; changes: Change[]; selKey: string };

export function HistoricalBalancesPage() {
  const cap = useQaqcCapabilities();
  const ops = historicalOps(cap.can as never);
  if (cap.isLoading) return <PageFrame title="Historical balances" description="Go-live opening balances by project and month."><Loading /></PageFrame>;
  if (!ops.view) return <PageFrame title="Historical balances" description="Go-live opening balances by project and month."><Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Lock className="size-6" aria-hidden /><p>You do not have access to historical balances. Ask a QA/QC administrator for the historical balances view permission.</p></CardContent></Card></PageFrame>;
  return <Editor ops={ops} />;
}

function Editor({ ops: grants }: { ops: ReturnType<typeof historicalOps> }) {
  const { toast } = useToast(); const invalidate = useInvalidate();
  const [projectId, setProjectId] = useState('');
  const [month, setMonth] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const period = monthToPeriod(month);
  const selKey = projectId && period ? `${projectId}|${period}` : '';
  const selRef = useRef(selKey); selRef.current = selKey;

  const projQ = useGetQaqcHistoricalProjects();
  const projects = (projQ.data ?? []) as Obj[];
  const balQ = useGetQaqcHistoricalBalances({ projectId, period: period ?? '' }, { query: { enabled: !!selKey } as never });
  const data = (balQ.data && (balQ.data as Obj).projectId === projectId && (balQ.data as Obj).period === period ? balQ.data : undefined) as Obj | undefined;
  const ops = { ...grants, edit: grants.edit && data?.canEdit !== false,
    importOp: grants.importOp && data?.canImport !== false, exportOp: grants.exportOp && data?.canExport !== false };
  const fields: HistField[] = useMemo(() => (data?.fields ?? []) as HistField[], [data]);

  const [raw, setRaw] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [conflictReason, setConflictReason] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const initFor = useRef('');

  // New selection clears everything tied to the previous one.
  useEffect(() => { setRaw({}); setReason(''); setTouched(false); setConflict(false); setConflictReason(''); setPending(null); initFor.current = ''; }, [selKey]);
  useEffect(() => {
    if (data && selKey && initFor.current !== `${selKey}|${data.version}`) {
      initFor.current = `${selKey}|${data.version}`;
      const b = (data.balances ?? {}) as Record<string, number>;
      setRaw(Object.fromEntries(fields.map(f => [f.key, b[f.key] == null ? '' : String(b[f.key])])));
    }
  }, [data, fields, selKey]);

  const v = validateBalances(fields, raw);
  const rErr = reasonError(reason);
  const canApply = data?.canApply === true;
  const blocking = (data?.blockingReports ?? []) as Obj[];
  const drafts = (data?.affectedDrafts ?? []) as Obj[];
  const history = (data?.history ?? []) as Obj[];
  const loadedBal = (data?.balances ?? {}) as Record<string, number>;
  const dirtyChanges: Change[] = fields.filter(f => v.values[f.key] != null && v.values[f.key] !== loadedBal[f.key]).map(f => ({ key: f.key, label: f.label, before: loadedBal[f.key], after: v.values[f.key] }));

  const saveM = useMutation({ mutationFn: (b: Parameters<typeof saveQaqcHistoricalBalances>[0]) => saveQaqcHistoricalBalances(b) });

  const reload = async () => { initFor.current = ''; setConflict(false); setPending(null); await balQ.refetch(); };

  const confirmSave = () => {
    if (!pending || pending.selKey !== selRef.current) { setPending(null); return; }
    const p = pending;
    saveM.mutate({ projectId, period: period!, version: p.version, reason: p.reason.trim(), balances: p.balances }, {
      onSuccess: res => {
        setPending(null);
        if (p.selKey !== selRef.current) return;
        const r = res as Obj; const n = Array.isArray(r.updatedDrafts) ? r.updatedDrafts.length : Number(r.updatedDrafts ?? 0);
        toast({ title: 'Historical balances saved', description: n ? `${n} unsubmitted draft${n === 1 ? '' : 's'} refreshed.` : 'No drafts needed refreshing.' });
        setReason(''); setTouched(false); initFor.current = ''; invalidate();
      },
      onError: e => {
        setPending(null);
        if (status(e) === 409) { setConflictReason(errMsg(e)); setConflict(true); return; }
        toast({ title: 'Could not save balances', description: errMsg(e), variant: 'destructive' });
      },
    });
  };

  const writeBlocked = !canApply || conflict || bulkBusy;

  return <PageFrame title="Historical balances" description="One-time go-live opening balances per project, across all months. Saved values seed the selected month's cumulative totals; derived rates and PQI are always computed, never entered."
    actions={<Button asChild variant="secondary" size="sm"><Link href="/qaqc/settings"><ArrowLeft className="mr-1 size-4" />Reporting settings</Link></Button>}>
    <Card className="min-w-0"><CardContent className="grid min-w-0 grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 space-y-1"><Label htmlFor="hb-project" className="text-xs text-muted-foreground">Project</Label>
        {projQ.isLoading ? <Skeleton className="h-10 w-full" /> : <Select disabled={bulkBusy} value={projectId} onValueChange={setProjectId}><SelectTrigger id="hb-project" className="w-full min-w-0 max-w-full [&>span]:truncate"><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={String(p.id)} value={String(p.id)}>{p.code ? `${p.code} - ` : ''}{p.name}</SelectItem>)}</SelectContent></Select>}</div>
      <div className="min-w-0 space-y-1"><Label htmlFor="hb-month" className="text-xs text-muted-foreground">Month</Label><Input id="hb-month" className="min-w-0 max-w-full" type="month" disabled={bulkBusy} value={month} onChange={e => setMonth(e.target.value)} /></div>
    </CardContent></Card>
    {(grants.importOp||grants.exportOp)&&<HistoricalBulkExcel key={period??'none'} period={period} canImport={grants.importOp} canExport={grants.exportOp} canEdit={grants.edit} disabled={saveM.isPending} onBusyChange={setBulkBusy} onApplied={()=>{if(selRef.current)void reload();}}/>}
    {projQ.error && <ErrorBox error={projQ.error} retry={() => projQ.refetch()} />}
    {!projQ.isLoading && !projQ.error && !projects.length && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No projects are in your scope for historical balances.</CardContent></Card>}
    {!selKey && projects.length > 0 && <Card className="border-dashed"><CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground"><FileSpreadsheet className="size-7" aria-hidden />Choose a project and month to view or set its opening balances.</CardContent></Card>}
    {selKey && (balQ.error ? <ErrorBox error={balQ.error} retry={() => balQ.refetch()} /> : !data ? <Loading /> : <>
      {conflict && <Alert variant="destructive" role="alert"><AlertTitle>Opening balances could not be loaded</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{conflictReason} Reload to see the current values; your unsaved edits will be discarded.</span><Button size="sm" variant="outline" onClick={reload}><RefreshCw className="mr-1 size-4" />Reload latest</Button></AlertDescription></Alert>}
      {!canApply && <Alert variant="destructive"><AlertTitle>{data.alreadyLoaded ? 'Opening balances already loaded — project is read-only' : 'Saving is locked for this month'}</AlertTitle><AlertDescription><p>{data.alreadyLoaded ? String(data.duplicateMessage) : 'Submitted or approved reports exist for this or a later month. Historical balances cannot change submitted history.'}</p>{blocking.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{blocking.map(r => <li key={String(r.id)} className="flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs text-foreground">{String(r.period).slice(0, 7)} <StateBadge state={String(r.state)} /></li>)}</ul>}</AlertDescription></Alert>}

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card><CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2"><div><CardTitle className="text-base">Opening balances</CardTitle><CardDescription>All {fields.length} values are required. Counts are whole numbers; hours may be decimal.</CardDescription></div>
          <div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="secondary">{SOURCE[String(data.source)] ?? String(data.source)}</Badge></div></CardHeader>
          <CardContent className="space-y-4">
            {data.saved && <p className="text-xs text-muted-foreground">Last saved {formatDateTime(String((data.saved as Obj).updatedAt))} by {String((data.saved as Obj).updatedByName ?? history.find(h => ((h.after ?? {}) as Obj).version === data.version)?.actorName ?? '—')}.</p>}
            {!fields.length ? <p className="text-sm text-muted-foreground">No balance fields are defined.</p> :
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{fields.map(f => { const err = touched || raw[f.key] !== (loadedBal[f.key] == null ? '' : String(loadedBal[f.key])) ? v.errors[f.key] : undefined; const id = `hb-${f.key}`; return <div key={f.key} className="space-y-1">
                <Label htmlFor={id} className="flex justify-between text-xs"><span>{f.label}</span><span className="text-muted-foreground">{f.unit ?? (isHoursField(f) ? 'hours' : 'count')}</span></Label>
                <Input id={id} inputMode={isHoursField(f) ? 'decimal' : 'numeric'} value={raw[f.key] ?? ''} disabled={!ops.edit || !canApply || bulkBusy} aria-invalid={!!err} aria-describedby={err ? `${id}-e` : undefined} className={err ? 'border-destructive' : undefined} onChange={e => setRaw(x => ({ ...x, [f.key]: e.target.value }))} onBlur={() => setTouched(true)} />
                {err && <p id={`${id}-e`} className="text-xs text-destructive">{err}</p>}</div>; })}</div>}
            {ops.edit ? <div className="space-y-3 border-t pt-4">
              <div className="space-y-1"><Label htmlFor="hb-reason" className="text-xs">Opening balance reason</Label><Textarea id="hb-reason" rows={2} value={reason} disabled={!canApply || bulkBusy} onChange={e => setReason(e.target.value)} placeholder="e.g. Opening balances from legacy register at go-live" aria-invalid={touched && !!rErr} />{touched && rErr && <p className="text-xs text-destructive">{rErr}</p>}</div>
              {drafts.length > 0 && <p className="text-xs text-muted-foreground">Saving will refresh {drafts.length} never-submitted draft{drafts.length === 1 ? '' : 's'} in this month. Submitted and approved reports are never altered.</p>}
              <div className="flex flex-wrap gap-2"><Button disabled={writeBlocked || saveM.isPending || !dirtyChanges.length && data.source === 'saved_setup'} onClick={() => { setTouched(true); if (!v.valid || rErr) return; setPending({ kind: 'manual', balances: v.values, reason, version: Number(data.version), changes: fields.map(f => ({ key: f.key, label: f.label, before: loadedBal[f.key], after: v.values[f.key] })).filter(c => c.before !== c.after || data.source !== 'saved_setup'), selKey }); }}>Review and save</Button>
                <Button variant="ghost" disabled={saveM.isPending} onClick={() => { initFor.current = ''; setTouched(false); setReason(''); setRaw(Object.fromEntries(fields.map(f => [f.key, loadedBal[f.key] == null ? '' : String(loadedBal[f.key])]))); }}>Discard edits</Button></div>
            </div> : <p className="border-t pt-4 text-xs text-muted-foreground">Read-only: you can view balances but not change them.</p>}
          </CardContent></Card>

        <div className="space-y-6">
          <Card><CardHeader><CardTitle className="text-base">Derived summary</CardTitle><CardDescription>Computed by the server from the loaded (saved) balances. Rates and PQI cannot be entered.</CardDescription></CardHeader>
            <CardContent>{data.derived && typeof data.derived === 'object' && Object.keys(data.derived as Obj).length ? <dl className="space-y-2 text-sm">{Object.entries(data.derived as Obj).filter(([, x]) => x == null || typeof x !== 'object').map(([k, x]) => <div key={k} className="flex justify-between gap-3 border-b pb-1 last:border-0"><dt className="text-muted-foreground">{k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</dt><dd className="font-mono tabular-nums">{fmt(x)}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">No derived values yet.</p>}</CardContent></Card>

        </div>
      </div>


      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="size-4" aria-hidden />Change history</CardTitle><CardDescription>Retained audit trail for this project and month.</CardDescription></CardHeader><CardContent>
        {!history.length ? <p className="text-sm text-muted-foreground">No changes recorded yet.</p> : <ol className="space-y-4">{history.map(h => { const before = (h.before ?? {}) as Obj; const after = (h.after ?? {}) as Obj; return <li key={String(h.id)} className="min-w-0 rounded-lg border p-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{String(h.actorName ?? 'Unknown')}</span><span className="text-xs text-muted-foreground">{formatDateTime(String(h.createdAt))}</span></div>
          <p className="mt-1 text-sm italic text-muted-foreground">{String(h.reason ?? '')}</p>
          <p className="mt-1 text-xs text-muted-foreground">Version {fmt(before.version)} → {fmt(after.version)}</p>
          <ChangeTable changes={historicalAuditChanges(fields, before, after)} />
        </li>; })}</ol>}
      </CardContent></Card>
    </>)}

    <AlertDialog open={!!pending} onOpenChange={o => { if (!o && !saveM.isPending) setPending(null); }}>
      <AlertDialogContent className="max-w-2xl"><AlertDialogHeader><AlertDialogTitle>Load opening balances once?</AlertDialogTitle>
        <AlertDialogDescription>These values will become the opening balances for {formatDate(period)}. Review carefully: after this load, this project cannot be loaded again for this or any other month. Never-submitted drafts in this month ({drafts.length}) will be refreshed; submitted and approved reports are not changed.</AlertDialogDescription></AlertDialogHeader>
        <div className="max-h-72 overflow-auto"><ChangeTable changes={pending?.changes ?? []} /></div>
        <p className="text-sm"><span className="text-muted-foreground">Reason: </span>{pending?.reason}</p>
        <AlertDialogFooter><AlertDialogCancel disabled={saveM.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={saveM.isPending} onClick={e => { e.preventDefault(); confirmSave(); }}>{saveM.isPending ? 'Saving...' : 'Confirm and save'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent></AlertDialog>
  </PageFrame>;
}

function ChangeTable({ changes }: { changes: Change[] }) {
  if (!changes.length) return <p className="mt-2 text-sm text-muted-foreground">No value changes.</p>;
  return <div className="mt-2 overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-2 text-left font-medium">Field</th><th scope="col" className="px-3 py-2 text-right font-medium">Before</th><th scope="col" className="px-3 py-2 text-right font-medium">After</th></tr></thead>
    <tbody>{changes.map(c => <tr key={c.key} className="border-t"><td className="px-3 py-1.5">{c.label}</td><td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmt(c.before)}</td><td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{fmt(c.after)}</td></tr>)}</tbody></table></div>;
}
