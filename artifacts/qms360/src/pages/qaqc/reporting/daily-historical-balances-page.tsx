import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { formatDate } from '@workspace/spreadsheet-dates';
import { useMutation, useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { ArrowLeft, CalendarClock, CheckCircle2, Download, FileSpreadsheet, Lock, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { useToast } from '@/hooks/use-toast';
import { ErrorBox, PageFrame, errMsg, saveFile, useInvalidate } from './shell';
import { historicalOps } from './historical-balances-validation';

const BASE = '/api/qaqc/reporting/daily-historical-balances';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET = 'Daily opening balances';
const TITLE = 'Daily historical balances';
const DESC = 'One-time go-live opening snapshot per project for Daily Submission reports. Issued reports are never rewritten.';

export interface DailyHistProject { id: string; name: string; label?: string; loaded: boolean; goLiveDate: string | null; blocked?: boolean; reason?: string | null }
export interface DailyHistField { key: string; label: string }
export interface DailyHistRow { projectId: string; projectName: string; rowNumber: number; goLiveDate: string; reason: string; data: Record<string, unknown>; errors: string[] }
export interface DailyHistPreview { valid: boolean; errors: string[]; fields: DailyHistField[]; rows: DailyHistRow[] }

const PROJECTS_KEY = [`${BASE}/projects`];
const fmtNum = (v: unknown) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v == null || v === '' ? '-' : String(v);
const getPath = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
const prevDay = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); if (isNaN(d.getTime())) return null; d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

export function DailyHistoricalBalancesPage() {
  const cap = useQaqcCapabilities();
  const ops = historicalOps(cap.can as never);
  if (cap.isLoading) return <PageFrame title={TITLE} description={DESC}><Skeleton className="h-40 w-full" /></PageFrame>;
  if (!ops.view) return <PageFrame title={TITLE} description={DESC}><Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Lock className="size-6" aria-hidden /><p>You do not have access to historical balances. Ask a QA/QC administrator for the historical balances view permission.</p></CardContent></Card></PageFrame>;
  return <Workspace ops={ops} />;
}

function Workspace({ ops }: { ops: ReturnType<typeof historicalOps> }) {
  const { toast } = useToast(); const invalidate = useInvalidate();
  const projQ = useQuery({ queryKey: PROJECTS_KEY, queryFn: () => customFetch<{ items: DailyHistProject[] }>(`${BASE}/projects`, { method: 'GET' }), refetchOnMount: 'always' });
  const projects = projQ.data?.items ?? [];
  const [goLive, setGoLive] = useState('');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<DailyHistPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0); const applying = useRef(false);
  useEffect(() => () => { generation.current++; }, []);

  const downloadM = useMutation({
    mutationFn: (date: string) => customFetch<Blob>(`${BASE}/template?goLiveDate=${encodeURIComponent(date)}`, { method: 'GET', headers: { Accept: XLSX }, responseType: 'blob' } as never),
    onSuccess: (blob, date) => saveFile(blob, `daily-historical-balances-${date}.xlsx`),
    onError: e => setError(errMsg(e)),
  });
  const previewM = useMutation({ mutationFn: (fileBase64: string) => customFetch<DailyHistPreview>(`${BASE}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileBase64 }) }) });
  const applyM = useMutation({
    mutationFn: (p: DailyHistPreview) => customFetch<{ applied: number }>(`${BASE}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true, items: p.rows.map(r => ({ projectId: r.projectId, goLiveDate: r.goLiveDate, reason: r.reason, data: r.data, rowNumber: r.rowNumber })) }) }),
  });

  const busy = reading || downloadM.isPending || previewM.isPending || applyM.isPending;
  const ready = !!preview && preview.valid && !preview.errors.length && preview.rows.length > 0 && preview.rows.every(r => !r.errors.length) && ops.edit && ops.importOp;
  const discard = () => { generation.current++; setPreview(null); setFileName(''); setError(''); setConfirm(false); };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const request = ++generation.current;
    setError(''); setPreview(null); setConfirm(false); setFileName(file.name);
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 2 * 1024 * 1024) { setError('Upload an .xlsx workbook no larger than 2 MB.'); return; }
    setReading(true);
    const reader = new FileReader();
    reader.onerror = () => { if (request === generation.current) { setReading(false); setError('The file could not be read.'); } };
    reader.onload = () => {
      if (request !== generation.current) return;
      setReading(false);
      previewM.mutate(String(reader.result ?? '').replace(/^data:[^,]*,/, ''), {
        onSuccess: r => { if (request === generation.current) setPreview(r); },
        onError: e => { if (request === generation.current) setError(errMsg(e)); },
      });
    };
    reader.readAsDataURL(file);
  };

  const doApply = () => {
    if (!preview || !ready || applying.current) return;
    const request = generation.current; applying.current = true;
    applyM.mutate(preview, {
      onSuccess: r => {
        if (request !== generation.current) return;
        discard(); invalidate(); void projQ.refetch();
        toast({ title: 'Daily opening balances loaded', description: `${r.applied} project${r.applied === 1 ? '' : 's'} loaded. Their first daily reports will use these as Yesterday values.` });
      },
      onError: e => { setConfirm(false); setError(`${errMsg(e)} Nothing was saved — this operation applies all projects or none.`); setPreview(p => p ? { ...p, valid: false } : null); },
      onSettled: () => { applying.current = false; },
    });
  };

  const loaded = projects.filter(p => p.loaded).length;
  const baseline = goLive ? prevDay(goLive) : null;

  return <PageFrame title={TITLE} description={DESC} actions={<Button asChild variant="secondary" size="sm"><Link href="/qaqc/settings"><ArrowLeft className="mr-1 size-4" />Reporting settings</Link></Button>}>
    <Alert><CalendarClock className="size-4" /><AlertTitle>How the go-live date works</AlertTitle><AlertDescription>Imported balances are as of the calendar day before each project's go-live date. They pre-fill the Yesterday auto fields on the first daily report, and remain the baseline until an actual submitted prior report replaces them. Setup is allowed only before the project has any Daily Submission — including a draft — or retained submitted history; existing Daily Submissions block setup. Complete setup before creating the first Daily report. Each project can be loaded only once, across all dates.</AlertDescription></Alert>

    {projQ.error ? <ErrorBox error={projQ.error} retry={() => projQ.refetch()} /> : projQ.isLoading ? <Skeleton className="h-48 w-full" /> : !projects.length ?
      <Card className="border-dashed"><CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground"><FileSpreadsheet className="size-7" aria-hidden /><p className="font-medium text-foreground">No projects in your historical-balances scope</p><p>Ask a QA/QC administrator to grant project access before loading daily opening balances.</p></CardContent></Card> : <>
      <Card className="min-w-0 border-primary/30">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="size-4" aria-hidden />Multi-project Excel setup</CardTitle>
          <CardDescription>One project per row on the "{SHEET}" sheet, with all numeric opening fields and revision lists in columns. The template lists only authorized projects not yet loaded; select from the Project Master dropdown. IDs, codes and versions are handled internally. Revision cells use semicolon-separated revision=count pairs, e.g. 0=25; 1=10. Leave empty for none.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {ops.exportOp && <div className="space-y-2 rounded-lg border p-4">
              <p className="text-sm font-medium">1. Download template</p>
              <div className="space-y-1"><Label htmlFor="dhb-golive" className="text-xs text-muted-foreground">Go-live date (pre-filled in template)</Label>
                <Input id="dhb-golive" type="date" value={goLive} disabled={busy} onChange={e => setGoLive(e.target.value)} /></div>
              {baseline && <p className="text-xs text-muted-foreground">Balances will be as of {formatDate(baseline)}.</p>}
              <Button variant="outline" disabled={!goLive || busy} onClick={() => { setError(''); downloadM.mutate(goLive); }}><Download className="mr-2 size-4" />{downloadM.isPending ? 'Preparing template…' : 'Download template'}</Button>
              {!goLive && <p className="text-xs text-primary">Select a go-live date to download the template.</p>}
            </div>}
            {ops.importOp && <div className="space-y-2 rounded-lg border p-4">
              <p className="text-sm font-medium">2. Upload to preview</p>
              <p className="text-xs text-muted-foreground">Go-live dates are read from each workbook row — no date selection needed. Uploading does not save anything. Maximum 500 project rows / 2 MB.</p>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" aria-label="Upload daily historical balances workbook" disabled={busy} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
              <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="mr-2 size-4" />{reading || previewM.isPending ? 'Checking workbook…' : 'Upload Excel to preview'}</Button>
              {fileName && <p className="truncate text-xs"><span className="text-muted-foreground">File: </span>{fileName}</p>}
            </div>}
          </div>
          {!ops.importOp && !ops.exportOp && <p className="text-sm text-muted-foreground">Read-only: you can view load status but not download templates or upload workbooks.</p>}
          {ops.importOp && !ops.edit && <p className="text-sm text-muted-foreground">You can preview workbooks, but applying requires historical balance edit permission.</p>}
          {error && <Alert variant="destructive" role="alert"><AlertTitle>Workbook could not be applied</AlertTitle><AlertDescription className="whitespace-pre-line break-words">{error}</AlertDescription></Alert>}

          {preview && <div className="space-y-4 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Preview — {fileName} · {preview.rows.length} project{preview.rows.length === 1 ? '' : 's'}</h3>
              <Badge variant={ready ? 'secondary' : 'destructive'}>{ready ? 'Ready for confirmation' : 'Complete file blocked — resolve issues'}</Badge></div>
            {preview.errors.length > 0 && <ul className="list-inside list-disc text-sm text-destructive">{preview.errors.map(m => <li key={m}>{m}</li>)}</ul>}
            {!ready && <p className="text-sm text-destructive">No projects will be saved until every row is valid and authorized. Fix the workbook and upload again.</p>}
            <div className="space-y-2">{preview.rows.map(row => <details key={`${row.rowNumber}-${row.projectId}`} className="min-w-0 rounded-lg border p-3">
              <summary className="cursor-pointer text-sm"><span className="font-medium">{row.projectName}</span><span className="ml-2 text-muted-foreground">{SHEET}! Row {row.rowNumber} · Go-live {formatDate(row.goLiveDate)}</span>
                {row.errors.length > 0 && <span className="ml-2 text-destructive">Blocked</span>}</summary>
              {row.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-sm text-destructive">{row.errors.map(m => <li key={m}>{m}</li>)}</ul>}
              <p className="mt-2 break-words text-sm"><span className="text-muted-foreground">Reason: </span>{row.reason || '-'}</p>
              <RowData fields={preview.fields} data={row.data} />
            </details>)}</div>
            <div className="flex flex-wrap gap-2"><Button disabled={!ready || busy} onClick={() => setConfirm(true)}>Apply all {preview.rows.length} projects</Button>
              <Button variant="ghost" disabled={applyM.isPending} onClick={discard}>Discard preview</Button></div>
          </div>}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">Load status</CardTitle><CardDescription>{loaded} of {projects.length} projects in your scope have a daily opening snapshot.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Project</th><th className="px-4 py-2 text-left font-medium">Status</th><th className="px-4 py-2 text-left font-medium">Go-live date</th><th className="px-4 py-2 text-left font-medium">Balances as of</th></tr></thead>
          <tbody>{projects.map(p => <tr key={p.id} className="border-t"><td className="px-4 py-2">{p.label || p.name}</td>
            <td className="px-4 py-2">{p.loaded ? <Badge variant="secondary"><CheckCircle2 className="mr-1 size-3" />Loaded</Badge> : p.blocked ? <Badge variant="destructive">Blocked</Badge> : <Badge variant="outline">Not loaded</Badge>}{p.blocked && p.reason && <p className="mt-1 text-xs text-muted-foreground">{p.reason}</p>}</td>
            <td className="px-4 py-2 tabular-nums">{p.goLiveDate ? formatDate(p.goLiveDate) : '-'}</td>
            <td className="px-4 py-2 tabular-nums text-muted-foreground">{p.goLiveDate ? formatDate(prevDay(p.goLiveDate)) : '-'}</td></tr>)}</tbody></table></CardContent></Card>
    </>}

    <AlertDialog open={confirm} onOpenChange={o => { if (!applyM.isPending) setConfirm(o); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Load daily opening balances for {preview?.rows.length} projects?</AlertDialogTitle>
        <AlertDialogDescription>Each project's balances are loaded once, as of the day before its go-live date, in one transaction with an audit reason. Projects with any existing Daily Submission (including drafts) or submitted history are rejected, and no drafts are refreshed. Previously loaded projects cannot be loaded again. If any row fails, none are saved.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={applyM.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!ready || busy} onClick={e => { e.preventDefault(); doApply(); }}>{applyM.isPending ? 'Applying…' : 'Confirm and apply all'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent></AlertDialog>
  </PageFrame>;
}

function RowData({ fields, data }: { fields: DailyHistField[]; data: Record<string, unknown> }) {
  const revs = (['drawings', 'submittals'] as const).map(k => [k, getPath(data, `revisions.${k}`)] as const);
  const revText = (v: unknown) => {
    if (!Array.isArray(v) || !v.length) return 'None';
    return v.map(x => x && typeof x === 'object' ? (() => { const o = x as Record<string, unknown>; const r = o.name ?? o.revision ?? o.rev ?? o.key; const c = o.count ?? o.value; return r != null && c != null ? `Rev ${r} = ${fmtNum(c)}` : JSON.stringify(o); })() : String(x)).join('; ');
  };
  const numeric = fields.filter(f => !f.key.startsWith('revisions.'));
  return <div className="mt-2 space-y-3">
    {numeric.length > 0 && <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Field</th><th className="px-3 py-2 text-right font-medium">Opening value</th></tr></thead>
      <tbody>{numeric.map(f => <tr key={f.key} className="border-t"><td className="px-3 py-1.5">{f.label}</td><td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtNum(getPath(data, f.key))}</td></tr>)}</tbody></table></div>}
    <div className="grid gap-2 sm:grid-cols-2">{revs.map(([k, v]) => <div key={k} className="rounded-md border p-2 text-sm"><p className="text-xs font-medium text-muted-foreground">{k === 'drawings' ? 'Drawing revisions' : 'Submittal revisions'}</p><p className="mt-1 break-words font-mono tabular-nums">{revText(v)}</p></div>)}</div>
  </div>;
}
