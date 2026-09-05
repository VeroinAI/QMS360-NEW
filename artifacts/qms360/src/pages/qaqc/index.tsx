import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation, useRoute } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowLeft, Bot, Check, ChevronLeft, ChevronRight, ClipboardCheck, Download,
  FileBarChart, FileText, Gauge, Inbox, PackageCheck, Plus, Search, Sparkles,
  Trash2, Upload, Users, X,
} from 'lucide-react';
import {
  downloadQaqcMetricsTemplate, exportDocumentGovernanceReport, exportQaqcMonthlyReport,
  useAnswerQaqcPromptQuestion, useCreateCustomerSatisfactionEntry,
  useCreateDocumentGovernanceEntry, useCreateMaterialInspection, useCreateQaqcMetric,
  useCreateQtbtEntry, useCreateQualityBrief, useDeleteCustomerSatisfactionEntry,
  useDeleteDocumentGovernanceEntry, useDeleteMaterialInspection, useDeleteQaqcMetric,
  useDeleteQtbtEntry, useDraftQualityBriefWithAi, useGetQaqcDashboard, useGetQaqcPqi,
  useImportQaqcMetrics, useListCustomerSatisfactionEntries, useListDocumentGovernanceLog,
  useListMaterialInspections, useListQaqcApprovals, useListQaqcMetrics,
  useListQtbtEntries, useListQualityBriefs, usePromptToQaqcTransaction,
  useRephraseQaqcField, useReviewQaqcMetric, useReviewQualityBrief,
  useListQaqcApprovers, useSubmitQaqcMetric, useSubmitQualityBrief, useUpdateQaqcMetric, useUpdateQualityBrief,
  type CustomerSatisfactionEntry, type DocumentGovernanceLogEntry,
  type MaterialInspectionEntry, type QAQCMetricEntry, type QTBTEntry,
  type QualityAssessmentBrief,
} from '@workspace/api-client-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useLov, withLegacyOption } from '@/lib/use-lov';
import { useFieldControls } from '@/lib/field-controls';

const limit = 10;
const dimensions = ['Quality', 'Timeliness', 'Communication', 'Safety', 'Documentation', 'Responsiveness'];
const fieldClass = 'space-y-2';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).includes('/api/qaqc') });
}

function Page({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="min-h-full bg-muted/30 p-4 md:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-xl bg-primary p-6 text-primary-foreground shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest opacity-75">QA/QC & Document Governance</p><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 max-w-2xl text-sm opacity-80">{description}</p></div>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      </div>
      {children}
    </div>
  </div>;
}

function QueryState({ loading, error, empty, children }: { loading: boolean; error: unknown; empty: boolean; children: ReactNode }) {
  if (loading) return <Card><CardContent className="py-14 text-center text-muted-foreground">Loading current records…</CardContent></Card>;
  if (error) return <Alert variant="destructive"><AlertTitle>Unable to load data</AlertTitle><AlertDescription>{errorText(error)}</AlertDescription></Alert>;
  if (empty) return <Card><CardContent className="py-14 text-center"><Inbox className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">No records found</p><p className="text-sm text-muted-foreground">Try changing the filters or create the first record.</p></CardContent></Card>;
  return <>{children}</>;
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
    <span className="text-muted-foreground">Page {page} of {pages} · {total} records</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /></Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" /></Button></div>
  </div>;
}

function StateBadge({ state }: { state: string }) {
  const variant = state === 'Approved' ? 'default' : state === 'Sent Back' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{state}</Badge>;
}

function SearchBox({ value, onChange, placeholder = 'Search records…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

function ConfirmDelete({ onConfirm, busy }: { onConfirm: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button size="icon" variant="ghost" aria-label="Delete record" onClick={() => setOpen(true)}><Trash2 className="size-4 text-destructive" /></Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Delete this record?</DialogTitle><DialogDescription>This soft-deletes the record while preserving its audit history.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => { onConfirm(); setOpen(false); }}>Delete</Button></DialogFooter></DialogContent></Dialog></>;
}

function DashboardPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const dashboard = useGetQaqcDashboard({ period });
  const pqi = useGetQaqcPqi({ period });
  const approvals = useListQaqcApprovals({ page: 1, limit: 5 });
  const metrics = (dashboard.data?.metrics || {}) as Record<string, unknown>;
  const num = (key: string) => Number(metrics[key] ?? 0);
  const trend = (dashboard.data?.series || []).map((row, i) => ({ name: String(row.category ?? row.period ?? `Period ${i + 1}`), value: Number(row.value ?? row.count ?? 0), ageing: Number(row.ageing ?? row.over45 ?? 0) }));
  const cards = [
    ['Open NCR', num('openNcr'), ClipboardCheck], ['Open RFI', num('openRfi'), FileText],
    ['Open RMI', num('openRmi'), PackageCheck], ['Pending approvals', num('pendingApprovals') || approvals.data?.total || 0, Inbox],
  ] as const;
  return <Page title="Quality command centre" description="Live project quality, closure performance, ageing and approval workload." actions={<Input type="month" className="w-44 bg-card text-foreground" value={period} onChange={e => setPeriod(e.target.value)} />}>
    <QueryState loading={dashboard.isLoading || pqi.isLoading} error={dashboard.error || pqi.error} empty={!dashboard.data && !pqi.data}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value, Icon]) => <Card key={label}><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p></div><div className="rounded-lg bg-primary/10 p-3"><Icon className="size-5 text-primary" /></div></CardContent></Card>)}
        <Card><CardContent className="flex items-center gap-4 p-5"><div className="relative size-16 rounded-full border-[7px] border-primary/20"><div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{Math.round(pqi.data?.pqi || 0)}%</div></div><div><p className="text-sm text-muted-foreground">PQI score</p><p className="font-semibold">{period}</p></div></CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Category trend</CardTitle><CardDescription>Reported quality activity by category</CardDescription></CardHeader><CardContent className="h-72"><ResponsiveContainer><AreaChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Area type="monotone" dataKey="value" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.2} /></AreaChart></ResponsiveContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Ageing buckets</CardTitle><CardDescription>Open items by elapsed-days bracket</CardDescription></CardHeader><CardContent className="h-72"><ResponsiveContainer><BarChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="ageing" fill="var(--chart-2)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Quick links</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
        ['/qaqc/metrics', 'NCR / RFI / RMI metrics', Gauge], ['/qaqc/material-inspections', 'Material inspections', PackageCheck],
        ['/qaqc/documents', 'Document governance', FileText], ['/qaqc/briefs', 'AI quality briefs', Bot],
      ].map(([href, text, Icon]) => <Link key={href as string} href={href as string}><Button variant="outline" className="h-auto w-full justify-start gap-3 py-4"><Icon className="size-5 text-primary" />{text as string}</Button></Link>)}</CardContent></Card>
      <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Pending approvals</CardTitle><CardDescription>Items waiting for your review</CardDescription></div><Link href="/qaqc/approvals"><Button variant="outline" size="sm">Open inbox</Button></Link></CardHeader><CardContent className="space-y-2">{approvals.data?.items.length ? approvals.data.items.map(a => <Link key={a.id} href={a.recordType.toLowerCase().includes('brief') ? `/qaqc/briefs/${a.recordId}` : '/qaqc/metrics'}><div className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50"><div><p className="font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.recordType} · {new Date(a.submittedAt).toLocaleDateString()}</p></div><ChevronRight className="size-4" /></div></Link>) : <p className="py-5 text-center text-sm text-muted-foreground">No pending approvals.</p>}</CardContent></Card>
    </QueryState>
  </Page>;
}

const blankMetric = (): QAQCMetricEntry => ({ id: crypto.randomUUID(), projectId: '', period: new Date().toISOString().slice(0, 7), category: 'External NCR', issuedCount: 0, closedCount: 0, ageing0To15: 0, ageing15To45: 0, ageingOver45: 0, workflowState: 'Draft' });

function AiQuickEntry({ onExtract }: { onExtract: (data: Record<string, unknown>) => void }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<ReturnType<typeof usePromptToQaqcTransaction>['data']>();
  const ai = usePromptToQaqcTransaction();
  const answer = useAnswerQaqcPromptQuestion();
  const send = () => ai.mutate({ data: { prompt } }, { onSuccess: r => { setResult(r); onExtract(r.extracted); } });
  return <Card className="border-primary/20 bg-primary/5"><CardContent className="p-4"><div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />AI quick entry</div><p className="mb-3 text-sm text-muted-foreground">Describe a metric in plain language and review the extracted values.</p><div className="flex gap-2"><Input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. External NCR for project… 12 issued, 9 closed" /><Button disabled={!prompt.trim() || ai.isPending} onClick={send}>Extract</Button></div>{ai.error && <p className="mt-2 text-sm text-destructive">{errorText(ai.error)}</p>}{result?.missing.map(m => <div key={m.field} className="mt-3 rounded-md bg-card p-3"><p className="mb-2 text-sm font-medium">{m.question}</p><div className="flex flex-wrap gap-2">{m.options.map(option => <Button key={option} size="sm" variant="outline" onClick={() => answer.mutate({ sessionId: result.sessionId, data: { field: m.field, value: option } }, { onSuccess: r => { setResult(r); onExtract(r.extracted); } })}>{option}</Button>)}</div></div>)}</CardContent></Card>;
}

function MetricDialog({ open, onOpenChange, seed, existing }: { open: boolean; onOpenChange: (v: boolean) => void; seed?: Record<string, unknown>; existing?: QAQCMetricEntry }) {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const fc = useFieldControls('qaqc', 'metric'); const ro = (key: string) => fc.fieldProps(key).disabled; const req = (key: string) => fc.fieldProps(key).required;
  const [form, setForm] = useState<QAQCMetricEntry>(() => ({ ...blankMetric(), ...seed, ...existing }));
  const create = useCreateQaqcMetric(); const update = useUpdateQaqcMetric();
  const categories = useLov('metric_categories');
  const setNum = (key: keyof QAQCMetricEntry, value: string) => setForm(f => ({ ...f, [key]: Math.max(0, Number(value)) }));
  const valid = form.projectId.trim() && form.period;
  const save = () => {
    const missing = fc.mandatoryFieldKeys().filter(key => { const value = form[key as keyof QAQCMetricEntry]; return value == null || (typeof value === 'string' && !value.trim()); });
    if (missing.length) { toast({ title: 'Complete mandatory fields', description: `Required by your administrator: ${missing.join(', ')}`, variant: 'destructive' }); return; }
    const options = { onSuccess: () => { invalidate(queryClient); toast({ title: existing ? 'Metric updated' : 'Metric created' }); onOpenChange(false); }, onError: (e: unknown) => toast({ title: existing ? 'Could not update metric' : 'Could not create metric', description: errorText(e), variant: 'destructive' as const }) };
    if (existing) update.mutate({ id: existing.id, data: form }, options);
    else create.mutate({ data: form }, options);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{existing ? 'Edit quality metric' : 'New quality metric'}</DialogTitle><DialogDescription>Enter issued, closed and ageing counts for the reporting period.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
    <div className={fieldClass}><Label>Project ID{req('projectId') && <span className="ml-1 text-destructive">*</span>}</Label><Input value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} disabled={ro('projectId')} /><p className="text-xs text-muted-foreground">Required project identifier</p></div>
    <div className={fieldClass}><Label>Period{req('period') && <span className="ml-1 text-destructive">*</span>}</Label><Input type="month" value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} disabled={ro('period')} /></div>
    <div className={fieldClass}><Label>Category{req('category') && <span className="ml-1 text-destructive">*</span>}</Label><Select value={form.category} disabled={categories.isLoading || ro('category')} onValueChange={v => setForm({ ...form, category: v as QAQCMetricEntry['category'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{withLegacyOption(categories.options, form.category).map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
    {([['issuedCount', 'Issued'], ['closedCount', 'Closed'], ['ageing0To15', 'Ageing 0–15 days'], ['ageing15To45', 'Ageing 15–45 days'], ['ageingOver45', 'Ageing >45 days']] as const).map(([key, label]) => <div key={key} className={fieldClass}><Label>{label}{req(key) && <span className="ml-1 text-destructive">*</span>}</Label><Input type="number" min={0} value={form[key]} onChange={e => setNum(key, e.target.value)} disabled={ro(key)} /></div>)}
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid || create.isPending || update.isPending} onClick={save}>{existing ? 'Save changes' : 'Save draft'}</Button></DialogFooter></DialogContent></Dialog>;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cell = ''; let row: string[] = []; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function tableToMetricRows(header: string[] | undefined, lines: string[][]): QAQCMetricEntry[] {
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return lines.map((cols) => {
    const raw: Record<string, string> = {};
    keys.forEach((key, i) => { raw[key] = String(cols[i] ?? '').trim(); });
    return {
      id: raw.id || crypto.randomUUID(),
      projectId: raw.projectId || '',
      period: raw.period || '',
      category: raw.category || 'External NCR',
      issuedCount: Number(raw.issuedCount || 0),
      closedCount: Number(raw.closedCount || 0),
      ageing0To15: Number(raw.ageing0To15 || 0),
      ageing15To45: Number(raw.ageing15To45 || 0),
      ageingOver45: Number(raw.ageingOver45 || 0),
      workflowState: raw.workflowState || 'Draft',
    } as unknown as QAQCMetricEntry;
  }).filter((row) => row.projectId || row.period);
}

function SubmitForReviewButton({ label, size, disabled, onSubmit }: { label: string; size?: 'sm'; disabled?: boolean; onSubmit: (approverId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [approverId, setApproverId] = useState('');
  const approvers = useListQaqcApprovers();
  return <>
    <Button size={size} variant="outline" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Submit for review</DialogTitle><DialogDescription>Choose the designated approver. They are notified in-app and by email, and only they (or an org admin) can review it.</DialogDescription></DialogHeader>
      <Select value={approverId} onValueChange={setApproverId}><SelectTrigger><SelectValue placeholder={approvers.isLoading ? 'Loading approvers…' : 'Select approver'} /></SelectTrigger><SelectContent>{(approvers.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.fullName}</SelectItem>)}</SelectContent></Select>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!approverId} onClick={() => { onSubmit(approverId); setOpen(false); setApproverId(''); }}>Submit</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

function csvToMetricRows(text: string): QAQCMetricEntry[] {
  const [header, ...lines] = parseCsvRows(text);
  return tableToMetricRows(header, lines);
}

async function xlsxToMetricRows(file: File): Promise<QAQCMetricEntry[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) return [];
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
  const [header, ...lines] = grid;
  return tableToMetricRows(header, lines as string[][]);
}

function MetricsPage() {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const [page, setPage] = useState(1); const [projectId, setProjectId] = useState(''); const [period, setPeriod] = useState(''); const [category, setCategory] = useState('External NCR'); const [open, setOpen] = useState(false); const [seed, setSeed] = useState<Record<string, unknown>>({}); const [editing, setEditing] = useState<QAQCMetricEntry>();
  const query = useListQaqcMetrics({ page, limit, projectId: projectId || undefined, period: period || undefined });
  const categories = useLov('metric_categories');
  const rows = (query.data?.items || []).filter(r => r.category === category);
  const del = useDeleteQaqcMetric(); const submit = useSubmitQaqcMetric(); const review = useReviewQaqcMetric(); const importer = useImportQaqcMetrics();
  const [reviewing, setReviewing] = useState<{ id: string; decision: 'approve' | 'send_back' }>(); const [comments, setComments] = useState('');
  const done = (message: string) => { invalidate(queryClient); toast({ title: message }); };
  const delivery = async (kind: 'template' | 'report') => { try { const r = kind === 'template' ? await downloadQaqcMetricsTemplate({ format: 'xlsx' }) : await exportQaqcMonthlyReport({ format: 'csv', ...(period ? { period } : {}) }); if (r.downloadUrl) window.location.assign(r.downloadUrl); else toast({ title: r.fileName, description: r.message || 'Your report is being prepared.' }); } catch (e) { toast({ title: 'Download failed', description: errorText(e), variant: 'destructive' }); } };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const rows = /\.xlsx$/i.test(file.name) ? await xlsxToMetricRows(file) : csvToMetricRows(await file.text());
      if (!rows.length) { toast({ title: 'No data rows found', description: 'Use the downloaded template and keep the header row.', variant: 'destructive' }); return; }
      importer.mutate({ data: rows }, {
        onSuccess: r => { done(`Import finished: ${r.created} created, ${r.updated} updated`); if (r.errors?.length) toast({ title: `${r.rejected} rows rejected`, description: r.errors.map(x => x.error).join(', '), variant: 'destructive' }); },
        onError: err => toast({ title: 'Import failed', description: errorText(err), variant: 'destructive' }),
      });
    } catch { toast({ title: 'Could not read the file', description: 'Use the downloaded CSV or Excel template and try again.', variant: 'destructive' }); }
  };
  return <Page title="NCR / RFI / RMI metrics" description="Monthly quality transactions, closure performance and ageing analysis." actions={<><Button variant="secondary" onClick={() => delivery('template')}><Download className="mr-2 size-4" />Template</Button><Button variant="secondary" onClick={() => delivery('report')}><FileBarChart className="mr-2 size-4" />Export CSV</Button><Button variant="secondary" onClick={() => { setEditing(undefined); setSeed({}); setOpen(true); }}><Plus className="mr-2 size-4" />New entry</Button></>}>
    <AiQuickEntry onExtract={data => { setEditing(undefined); setSeed(data); setOpen(true); }} />
    <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><SearchBox value={projectId} onChange={v => { setProjectId(v); setPage(1); }} placeholder="Filter by project ID" /><Input className="w-full sm:w-44" type="month" value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }} /><Label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"><Upload className="size-4" />{importer.isPending ? 'Importing…' : 'Import Excel / CSV'}<input className="hidden" type="file" accept=".csv,.xlsx" onChange={importFile} /></Label></CardContent></Card>
    <Tabs value={category} onValueChange={setCategory}><TabsList className="h-auto flex-wrap">{withLegacyOption(categories.options, category).map(c => <TabsTrigger key={c.value} value={c.value}>{c.label}</TabsTrigger>)}</TabsList></Tabs>
    <QueryState loading={query.isLoading} error={query.error} empty={!rows.length}><Card className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Project / period</TableHead><TableHead>Issued</TableHead><TableHead>Closed</TableHead><TableHead>Ageing 0–15 / 15–45 / &gt;45</TableHead><TableHead>Closure</TableHead><TableHead>Variance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => {
      const rate = row.issuedCount === 0 && row.closedCount === 0 ? 100 : row.issuedCount ? row.closedCount / row.issuedCount * 100 : 0;
      return <TableRow key={row.id}><TableCell className="font-mono text-xs">{row.referenceNumber ?? '—'}</TableCell><TableCell><p className="font-medium">{row.projectId}</p><p className="text-xs text-muted-foreground">{row.period}</p></TableCell><TableCell>{row.issuedCount}</TableCell><TableCell>{row.closedCount}</TableCell><TableCell>{row.ageing0To15} / {row.ageing15To45} / {row.ageingOver45}</TableCell><TableCell>{(row.closureRate ?? rate).toFixed(1)}%</TableCell><TableCell>{(row.variance ?? 0).toFixed(1)}</TableCell><TableCell><StateBadge state={row.workflowState} /></TableCell><TableCell><div className="flex justify-end gap-1">{(row.workflowState === 'Draft' || row.workflowState === 'Sent Back') && <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setOpen(true); }}>Edit</Button>}{row.workflowState === 'Draft' && <SubmitForReviewButton label="Submit" size="sm" disabled={submit.isPending} onSubmit={(approverId) => submit.mutate({ id: row.id, data: { approverId } }, { onSuccess: () => done('Metric submitted') })} />}{row.workflowState === 'Submitted' && <><Button size="sm" onClick={() => setReviewing({ id: row.id, decision: 'approve' })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setReviewing({ id: row.id, decision: 'send_back' })}>Send back</Button></>}<ConfirmDelete busy={del.isPending} onConfirm={() => del.mutate({ id: row.id }, { onSuccess: () => done('Metric deleted') })} /></div></TableCell></TableRow>;
    })}</TableBody></Table><Pager page={page} total={query.data?.total || 0} onPage={setPage} /></Card></QueryState>
    <MetricDialog key={`${editing?.id || 'new'}-${JSON.stringify(seed)}`} open={open} onOpenChange={setOpen} seed={seed} existing={editing} />
    <Dialog open={!!reviewing} onOpenChange={() => setReviewing(undefined)}><DialogContent><DialogHeader><DialogTitle>{reviewing?.decision === 'approve' ? 'Approve metric' : 'Send metric back'}</DialogTitle><DialogDescription>Add review remarks. Remarks are required when sending back.</DialogDescription></DialogHeader><Textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Review remarks" /><DialogFooter><Button variant="outline" onClick={() => setReviewing(undefined)}>Cancel</Button><Button disabled={!reviewing || (reviewing.decision === 'send_back' && !comments.trim()) || review.isPending} onClick={() => reviewing && review.mutate({ id: reviewing.id, data: { decision: reviewing.decision, comments } }, { onSuccess: () => { done(reviewing.decision === 'approve' ? 'Metric approved' : 'Metric sent back'); setReviewing(undefined); setComments(''); } })}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </Page>;
}

type SimpleKind = 'mir' | 'qtbt' | 'csat' | 'documents';
function SimpleRecordsPage({ kind }: { kind: SimpleKind }) {
  const config = {
    mir: ['Material inspections', 'Track MIR status and enforce exact reconciliation.'],
    qtbt: ['Quality toolbox talks', 'Capture quality talk frequency, attendance and duration.'],
    csat: ['Customer satisfaction', 'Measure six service dimensions and customer outcomes.'],
    documents: ['Daily document governance log', 'Monitor review status, pending ownership and elapsed days.'],
  }[kind];
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [open, setOpen] = useState(false);
  const mir = useListMaterialInspections({ page, limit });
  const qtbt = useListQtbtEntries({ page, limit });
  const csat = useListCustomerSatisfactionEntries({ page, limit });
  const docs = useListDocumentGovernanceLog({ page, limit });
  const q = kind === 'mir' ? mir : kind === 'qtbt' ? qtbt : kind === 'csat' ? csat : docs;
  const items = ((q.data?.items || []) as Array<MaterialInspectionEntry | QTBTEntry | CustomerSatisfactionEntry | DocumentGovernanceLogEntry>).filter(x => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
  const exportDocs = async () => { const r = await exportDocumentGovernanceReport({ format: 'csv' }); if (r.downloadUrl) window.location.assign(r.downloadUrl); };
  return <Page title={config[0]} description={config[1]} actions={<>{kind === 'documents' && <Button variant="secondary" onClick={exportDocs}><Download className="mr-2 size-4" />Export report</Button>}<Button variant="secondary" onClick={() => setOpen(true)}><Plus className="mr-2 size-4" />New entry</Button></>}>
    {kind === 'csat' && items.length > 0 && <CsatChart items={items as CustomerSatisfactionEntry[]} />}
    <Card><CardContent className="p-4"><SearchBox value={search} onChange={setSearch} /></CardContent></Card>
    <QueryState loading={q.isLoading} error={q.error} empty={!items.length}><SimpleTable kind={kind} items={items} /><Pager page={page} total={q.data?.total || 0} onPage={setPage} /></QueryState>
    <SimpleForm kind={kind} open={open} onOpenChange={setOpen} />
  </Page>;
}

function CsatChart({ items }: { items: CustomerSatisfactionEntry[] }) {
  const data = dimensions.map((name, i) => ({ name, score: items.reduce((sum, x) => sum + (x.serviceRatings[i] || 0), 0) / items.length }));
  return <Card><CardHeader><CardTitle>Service dimension profile</CardTitle><CardDescription>Average rating across visible entries (out of 5)</CardDescription></CardHeader><CardContent className="h-72"><ResponsiveContainer><RadarChart data={data}><PolarGrid /><PolarAngleAxis dataKey="name" /><Radar dataKey="score" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.25} /></RadarChart></ResponsiveContainer></CardContent></Card>;
}

function SimpleTable({ kind, items }: { kind: SimpleKind; items: Array<MaterialInspectionEntry | QTBTEntry | CustomerSatisfactionEntry | DocumentGovernanceLogEntry> }) {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const d1 = useDeleteMaterialInspection(); const d2 = useDeleteQtbtEntry(); const d3 = useDeleteCustomerSatisfactionEntry(); const d4 = useDeleteDocumentGovernanceEntry();
  const remove = (id: string) => {
    const mutation = kind === 'mir' ? d1 : kind === 'qtbt' ? d2 : kind === 'csat' ? d3 : d4;
    mutation.mutate({ id }, { onSuccess: () => { invalidate(queryClient); toast({ title: 'Record deleted' }); } });
  };
  return <Card className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Period / date</TableHead><TableHead>Details</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{items.map(item => {
    const mir = kind === 'mir' ? item as MaterialInspectionEntry : undefined;
    const sum = mir ? mir.approved + mir.onHold + mir.rejected + mir.hazardous + mir.handleWithCare : 0;
    const detail = kind === 'mir' ? `Total ${(item as MaterialInspectionEntry).mirnTotal} · breakdown ${sum}` : kind === 'qtbt' ? `${(item as QTBTEntry).talkCount} talks · ${(item as QTBTEntry).attendance} attendees · ${(item as QTBTEntry).durationMinutes} min` : kind === 'csat' ? `Average ${((item as CustomerSatisfactionEntry).serviceRatings.reduce((a, b) => a + b, 0) / 6).toFixed(1)} / 5` : `${(item as DocumentGovernanceLogEntry).documentType} · ${(item as DocumentGovernanceLogEntry).pendingWith} · ${(item as DocumentGovernanceLogEntry).pendingDays || 0} days`;
    return <TableRow key={item.id}><TableCell className="font-medium">{item.projectId}</TableCell><TableCell>{'period' in item ? item.period : item.date}</TableCell><TableCell>{detail}</TableCell><TableCell>{mir ? <Badge variant={sum === mir.mirnTotal ? 'default' : 'destructive'}>{sum === mir.mirnTotal ? 'Reconciled' : `Variance ${mir.mirnTotal - sum}`}</Badge> : kind === 'documents' ? <Badge variant="secondary">{(item as DocumentGovernanceLogEntry).status}</Badge> : <Badge variant="secondary">Recorded</Badge>}</TableCell><TableCell className="text-right"><ConfirmDelete onConfirm={() => remove(item.id)} /></TableCell></TableRow>;
  })}</TableBody></Table></Card>;
}

function SimpleForm({ kind, open, onOpenChange }: { kind: SimpleKind; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const formKey = { mir: 'material-inspection', qtbt: 'qtbt', csat: 'customer-satisfaction', documents: 'document-log' }[kind];
  const fc = useFieldControls('qaqc', formKey);
  const ro = (key: string) => fc.fieldProps(key).disabled; const req = (key: string) => fc.fieldProps(key).required;
  const [projectId, setProjectId] = useState(''); const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); const [values, setValues] = useState<Record<string, string>>({});
  const c1 = useCreateMaterialInspection(); const c2 = useCreateQtbtEntry(); const c3 = useCreateCustomerSatisfactionEntry(); const c4 = useCreateDocumentGovernanceEntry();
  const documentTypes = useLov('document_types'); const documentStatuses = useLov('document_statuses'); const pendingWith = useLov('pending_with');
  const n = (key: string) => Math.max(0, Number(values[key] || 0)); const set = (key: string, value: string) => setValues(v => ({ ...v, [key]: value }));
  const mirSum = n('approved') + n('onHold') + n('rejected') + n('hazardous') + n('handleWithCare'); const reconciled = mirSum === n('mirnTotal');
  const save = () => {
    const valueOf = (key: string) => key === 'projectId' ? projectId : key === 'period' ? period : key === 'serviceRatings' ? 'set' : (values[key] ?? '');
    const missing = fc.mandatoryFieldKeys().filter(key => !String(valueOf(key)).trim());
    if (missing.length) { toast({ title: 'Complete mandatory fields', description: `Required by your administrator: ${missing.join(', ')}`, variant: 'destructive' }); return; }
    const id = crypto.randomUUID(); const success = () => { invalidate(queryClient); toast({ title: 'Record created' }); onOpenChange(false); };
    const fail = (e: unknown) => toast({ title: 'Could not create record', description: errorText(e), variant: 'destructive' });
    if (kind === 'mir') c1.mutate({ data: { id, projectId, period, mirnTotal: n('mirnTotal'), osdCount: n('osdCount'), approved: n('approved'), onHold: n('onHold'), rejected: n('rejected'), hazardous: n('hazardous'), handleWithCare: n('handleWithCare') } }, { onSuccess: success, onError: fail });
    if (kind === 'qtbt') c2.mutate({ data: { id, projectId, period, talkCount: n('talkCount'), attendance: n('attendance'), durationMinutes: n('durationMinutes') } }, { onSuccess: success, onError: fail });
    if (kind === 'csat') c3.mutate({ data: { id, projectId, period, serviceRatings: dimensions.map((_, i) => n(`rating${i}`) || 3), feedback: values.feedback || null } }, { onSuccess: success, onError: fail });
    if (kind === 'documents') c4.mutate({ data: { id, projectId, date: values.date || new Date().toISOString().slice(0, 10), disciplineId: values.disciplineId || '', documentType: (values.documentType || 'Submittal') as DocumentGovernanceLogEntry['documentType'], status: (values.status || 'Under Review') as DocumentGovernanceLogEntry['status'], pendingWith: (values.pendingWith || 'Client') as DocumentGovernanceLogEntry['pendingWith'], reviewDays: n('reviewDays'), pendingDays: n('pendingDays'), correspondenceCount: n('correspondenceCount') } }, { onSuccess: success, onError: fail });
  };
  const numeric = kind === 'mir' ? [['mirnTotal', 'Total MIRN'], ['osdCount', 'OSD'], ['approved', 'Approved'], ['onHold', 'On hold'], ['rejected', 'Rejected'], ['hazardous', 'Hazardous'], ['handleWithCare', 'Handle with care']] : kind === 'qtbt' ? [['talkCount', 'Talk count'], ['attendance', 'Attendance'], ['durationMinutes', 'Duration (minutes)']] : [];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>New {kind === 'mir' ? 'material inspection' : kind === 'qtbt' ? 'QTBT entry' : kind === 'csat' ? 'satisfaction entry' : 'document log entry'}</DialogTitle><DialogDescription>Complete all required fields before saving.</DialogDescription></DialogHeader><div className="grid max-h-[60vh] gap-4 overflow-y-auto p-1 sm:grid-cols-2">
    <div className={fieldClass}><Label>Project ID{req('projectId') && <span className="ml-1 text-destructive">*</span>}</Label><Input value={projectId} onChange={e => setProjectId(e.target.value)} disabled={ro('projectId')} /></div>
    {kind !== 'documents' && <div className={fieldClass}><Label>Period{req('period') && <span className="ml-1 text-destructive">*</span>}</Label><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} disabled={ro('period')} /></div>}
    {numeric.map(([key, label]) => <div className={fieldClass} key={key}><Label>{label}{req(key) && <span className="ml-1 text-destructive">*</span>}</Label><Input type="number" min={0} value={values[key] || '0'} onChange={e => set(key, e.target.value)} disabled={ro(key)} /></div>)}
    {kind === 'mir' && <div className="sm:col-span-2"><Badge variant={reconciled ? 'default' : 'destructive'}>{reconciled ? <><Check className="mr-1 size-3" />Reconciled: breakdown equals total MIRN</> : <><X className="mr-1 size-3" />Not reconciled: breakdown {mirSum}, total {n('mirnTotal')}</>}</Badge></div>}
    {kind === 'csat' && <>{dimensions.map((d, i) => <div className={fieldClass} key={d}><Label>{d} (1–5){req('serviceRatings') && <span className="ml-1 text-destructive">*</span>}</Label><Input type="number" min={1} max={5} value={values[`rating${i}`] || '3'} onChange={e => set(`rating${i}`, e.target.value)} disabled={ro('serviceRatings')} /></div>)}<div className="sm:col-span-2"><RephraseField label="Customer feedback" value={values.feedback || ''} onChange={v => set('feedback', v)} disabled={ro('feedback')} required={req('feedback')} /></div></>}
     {kind === 'documents' && <><div className={fieldClass}><Label>Date{req('date') && <span className="ml-1 text-destructive">*</span>}</Label><Input type="date" value={values.date || ''} onChange={e => set('date', e.target.value)} disabled={ro('date')} /></div><div className={fieldClass}><Label>Discipline ID{req('disciplineId') && <span className="ml-1 text-destructive">*</span>}</Label><Input value={values.disciplineId || ''} onChange={e => set('disciplineId', e.target.value)} disabled={ro('disciplineId')} /></div>{([['documentType', 'Document type', documentTypes], ['status', 'Status', documentStatuses], ['pendingWith', 'Pending with', pendingWith]] as const).map(([key, label, lov]) => <div className={fieldClass} key={key}><Label>{label}{req(key) && <span className="ml-1 text-destructive">*</span>}</Label><Select value={values[key] || lov.options[0]?.value || ''} disabled={lov.isLoading || ro(key)} onValueChange={v => set(key, v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{withLegacyOption(lov.options, values[key]).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>)}{[['reviewDays', 'Review days'], ['pendingDays', 'Pending days'], ['correspondenceCount', 'Correspondence count']].map(([key, label]) => <div className={fieldClass} key={key}><Label>{label}{req(key) && <span className="ml-1 text-destructive">*</span>}</Label><Input type="number" min={0} value={values[key] || '0'} onChange={e => set(key, e.target.value)} disabled={ro(key)} /></div>)}</>}
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!projectId.trim() || (kind === 'mir' && !reconciled)} onClick={save}>Save</Button></DialogFooter></DialogContent></Dialog>;
}

function RephraseField({ label, value, onChange, disabled = false, required = false }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; required?: boolean }) {
  const ai = useRephraseQaqcField(); const [suggestion, setSuggestion] = useState('');
  return <div className={fieldClass}><div className="flex items-center justify-between"><Label>{label}{required && <span className="ml-1 text-destructive">*</span>}</Label><Button type="button" size="sm" variant="ghost" disabled={disabled || !value.trim() || ai.isPending} onClick={() => ai.mutate({ data: { field: label, text: value } }, { onSuccess: r => setSuggestion(r.suggestion) })}><Sparkles className="mr-1 size-3" />Rephrase with AI</Button></div><Textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />{ai.error && <p className="text-xs text-destructive">{errorText(ai.error)}</p>}{suggestion && <div className="rounded-md border bg-muted/40 p-3 text-sm"><p>{suggestion}</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => { onChange(suggestion); setSuggestion(''); }}>Use</Button><Button size="sm" variant="ghost" onClick={() => setSuggestion('')}>Dismiss</Button></div></div>}</div>;
}

function BriefsPage() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [open, setOpen] = useState(false); const q = useListQualityBriefs({ page, limit }); const create = useCreateQualityBrief(); const qc = useQueryClient(); const { toast } = useToast();
  const items = (q.data?.items || []).filter(x => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
  return <Page title="AI Quality Assessment Briefs" description="Human-reviewed quality narratives informed by current project data." actions={<Button variant="secondary" onClick={() => setOpen(true)}><Plus className="mr-2 size-4" />New brief</Button>}>
    <Card><CardContent className="p-4"><SearchBox value={search} onChange={setSearch} /></CardContent></Card>
    <QueryState loading={q.isLoading} error={q.error} empty={!items.length}><Card className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Period</TableHead><TableHead>Narrative</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{items.map(x => <TableRow key={x.id}><TableCell className="font-medium">{x.projectId}</TableCell><TableCell>{x.period}</TableCell><TableCell className="max-w-md truncate">{x.narrative || 'Not written'}</TableCell><TableCell><StateBadge state={x.workflowState} /></TableCell><TableCell><Link href={`/qaqc/briefs/${x.id}`}><Button size="sm" variant="outline">Open editor</Button></Link></TableCell></TableRow>)}</TableBody></Table><Pager page={page} total={q.data?.total || 0} onPage={setPage} /></Card></QueryState>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Create quality brief</DialogTitle><DialogDescription>Start a manual brief, then optionally generate an AI draft.</DialogDescription></DialogHeader><BriefCreateForm onSave={(projectId, period) => create.mutate({ data: { id: crypto.randomUUID(), projectId, period, narrative: '', workflowState: 'Draft' } }, { onSuccess: () => { invalidate(qc); toast({ title: 'Brief created' }); setOpen(false); } })} /></DialogContent></Dialog>
  </Page>;
}

function BriefCreateForm({ onSave }: { onSave: (project: string, period: string) => void }) {
  const [project, setProject] = useState(''); const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { toast } = useToast();
  const fc = useFieldControls('qaqc', 'quality-brief'); const ro = (key: string) => fc.fieldProps(key).disabled; const req = (key: string) => fc.fieldProps(key).required;
  const save = () => {
    const missing = fc.mandatoryFieldKeys().filter(key => !(key === 'projectId' ? project : key === 'period' ? period : '').trim());
    if (missing.length) { toast({ title: 'Complete mandatory fields', description: `Required by your administrator: ${missing.join(', ')}`, variant: 'destructive' }); return; }
    onSave(project, period);
  };
  return <><div className={fieldClass}><Label>Project ID{req('projectId') && <span className="ml-1 text-destructive">*</span>}</Label><Input value={project} onChange={e => setProject(e.target.value)} disabled={ro('projectId')} /></div><div className={fieldClass}><Label>Period{req('period') && <span className="ml-1 text-destructive">*</span>}</Label><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} disabled={ro('period')} /></div><DialogFooter><Button disabled={!project.trim()} onClick={save}>Create</Button></DialogFooter></>;
}

function BriefEditor() {
  const [, params] = useRoute('/qaqc/briefs/:id'); const id = params?.id || ''; const q = useListQualityBriefs({ page: 1, limit: 200 }); const original = q.data?.items.find(x => x.id === id);
  const [narrative, setNarrative] = useState<string>(); const text = narrative ?? original?.narrative ?? '';
  const ai = useDraftQualityBriefWithAi(); const update = useUpdateQualityBrief(); const submit = useSubmitQualityBrief(); const review = useReviewQualityBrief(); const qc = useQueryClient(); const { toast } = useToast(); const [, navigate] = useLocation(); const [aiDraft, setAiDraft] = useState<{ draft: string; suggestions: string[] }>(); const [aiUnavailable, setAiUnavailable] = useState(false); const [remarks, setRemarks] = useState(''); const [decision, setDecision] = useState<'approve' | 'send_back'>();
  const fc = useFieldControls('qaqc', 'quality-brief'); const ro = (key: string) => fc.fieldProps(key).disabled; const req = (key: string) => fc.fieldProps(key).required;
  if (q.isLoading) return <Page title="Quality brief editor" description="Loading brief…"><QueryState loading error={undefined} empty={false}><span /></QueryState></Page>;
  if (q.error || !original) return <Page title="Quality brief editor" description="The requested brief could not be loaded."><QueryState loading={false} error={q.error || new Error('Brief not found')} empty={false}><span /></QueryState></Page>;
  const save = (next = text, aiDecision = original.aiReviewDecision) => {
    if (fc.fieldProps('narrative').required && !next.trim()) { toast({ title: 'Narrative is required', description: 'Your administrator marked the narrative as mandatory.', variant: 'destructive' }); return; }
    update.mutate({ id, data: { ...original, narrative: next, aiReviewDecision: aiDecision } }, { onSuccess: () => { invalidate(qc); toast({ title: 'Brief saved' }); } });
  };
  return <Page title="Quality brief editor" description={`${original.projectId} · ${original.period}`} actions={<Button variant="secondary" onClick={() => navigate('/qaqc/briefs')}><ArrowLeft className="mr-2 size-4" />All briefs</Button>}>
    {aiUnavailable && <Alert><Bot className="size-4" /><AlertTitle>AI drafting is temporarily unavailable</AlertTitle><AlertDescription>You can continue writing and submit the brief manually. Your work is not affected.</AlertDescription></Alert>}
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]"><Card><CardHeader><CardTitle>Assessment narrative</CardTitle><CardDescription>Review all generated content before accepting it.</CardDescription></CardHeader><CardContent className="space-y-4"><RephraseField label="Quality assessment narrative" value={text} onChange={setNarrative} disabled={ro('narrative')} required={req('narrative')} /><div className="flex flex-wrap gap-2"><Button onClick={() => save()}>Save changes</Button>{original.workflowState === 'Draft' && <SubmitForReviewButton label="Submit for review" disabled={submit.isPending} onSubmit={(approverId) => submit.mutate({ id, data: { approverId } }, { onSuccess: () => { invalidate(qc); toast({ title: 'Brief submitted' }); } })} />}{original.workflowState === 'Submitted' && <><Button variant="outline" onClick={() => setDecision('approve')}>Approve</Button><Button variant="outline" onClick={() => setDecision('send_back')}>Send back</Button></>}</div></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" />AI draft assistant</CardTitle><CardDescription>Suggestions require an explicit human decision.</CardDescription></CardHeader><CardContent className="space-y-3"><Button className="w-full" disabled={ai.isPending} onClick={() => { setAiUnavailable(false); ai.mutate({ id }, { onSuccess: setAiDraft, onError: () => setAiUnavailable(true) }); }}><Bot className="mr-2 size-4" />Generate AI draft</Button>{aiDraft && <><div className="max-h-52 overflow-auto rounded-md border p-3 text-sm">{aiDraft.draft}</div><div className="flex flex-wrap gap-1">{aiDraft.suggestions.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}</div><div className="grid grid-cols-3 gap-2"><Button size="sm" disabled={ro('narrative')} onClick={() => { setNarrative(aiDraft.draft); save(aiDraft.draft, 'Accept'); }}>Accept</Button><Button size="sm" variant="outline" disabled={ro('narrative')} onClick={() => { setNarrative(aiDraft.draft); save(aiDraft.draft, 'Edit'); }}>Edit</Button><Button size="sm" variant="outline" onClick={() => { save(text, 'Reject'); setAiDraft(undefined); }}>Reject</Button></div></>}</CardContent></Card>
    </div>
    <Dialog open={!!decision} onOpenChange={() => setDecision(undefined)}><DialogContent><DialogHeader><DialogTitle>{decision === 'approve' ? 'Approve brief' : 'Send brief back'}</DialogTitle><DialogDescription>Remarks are required when sending a brief back.</DialogDescription></DialogHeader><Textarea value={remarks} onChange={e => setRemarks(e.target.value)} /><DialogFooter><Button disabled={!decision || (decision === 'send_back' && !remarks.trim())} onClick={() => decision && review.mutate({ id, data: { decision, comments: remarks } }, { onSuccess: () => { invalidate(qc); toast({ title: decision === 'approve' ? 'Brief approved' : 'Brief sent back' }); setDecision(undefined); } })}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </Page>;
}

function ApprovalsPage() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const q = useListQaqcApprovals({ page, limit }); const metric = useReviewQaqcMetric(); const brief = useReviewQualityBrief(); const qc = useQueryClient(); const { toast } = useToast(); const [sendBack, setSendBack] = useState<{ id: string; type: string }>(); const [remarks, setRemarks] = useState('');
  const items = (q.data?.items || []).filter(x => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
  const review = (type: string, id: string, decision: 'approve' | 'send_back', comments?: string) => {
    const mutation = type.toLowerCase().includes('brief') ? brief : metric;
    mutation.mutate({ id, data: { decision, comments } }, { onSuccess: () => { invalidate(qc); toast({ title: decision === 'approve' ? 'Item approved' : 'Item sent back' }); setSendBack(undefined); setRemarks(''); }, onError: e => toast({ title: 'Review failed', description: errorText(e), variant: 'destructive' }) });
  };
  return <Page title="Approvals inbox" description="Submitted quality metrics and briefs awaiting your review.">
    <Card><CardContent className="p-4"><SearchBox value={search} onChange={setSearch} placeholder="Search title or record type" /></CardContent></Card>
    <QueryState loading={q.isLoading} error={q.error} empty={!items.length}><Card className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead>Submitted</TableHead><TableHead>Delegation</TableHead><TableHead className="text-right">Decision</TableHead></TableRow></TableHeader><TableBody>{items.map(x => <TableRow key={x.id}><TableCell className="font-medium">{x.title}</TableCell><TableCell><Badge variant="secondary">{x.recordType}</Badge></TableCell><TableCell>{new Date(x.submittedAt).toLocaleString()}</TableCell><TableCell>{x.delegatedFrom || 'Direct assignment'}</TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" onClick={() => review(x.recordType, x.recordId, 'approve')}>Approve</Button><Button size="sm" variant="outline" onClick={() => setSendBack({ id: x.recordId, type: x.recordType })}>Send back</Button></div></TableCell></TableRow>)}</TableBody></Table><Pager page={page} total={q.data?.total || 0} onPage={setPage} /></Card></QueryState>
    <Dialog open={!!sendBack} onOpenChange={() => setSendBack(undefined)}><DialogContent><DialogHeader><DialogTitle>Send item back</DialogTitle><DialogDescription>Explain what must be corrected before resubmission.</DialogDescription></DialogHeader><Textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Required remarks" /><DialogFooter><Button variant="outline" onClick={() => setSendBack(undefined)}>Cancel</Button><Button disabled={!remarks.trim()} onClick={() => sendBack && review(sendBack.type, sendBack.id, 'send_back', remarks)}>Send back</Button></DialogFooter></DialogContent></Dialog>
  </Page>;
}

function NotFound() {
  return <Page title="Page not found" description="This QA/QC workspace route does not exist."><Card><CardContent className="py-12 text-center"><Link href="/qaqc"><Button>Return to dashboard</Button></Link></CardContent></Card></Page>;
}

export function QaqcRoutes() {
  return <Switch>
    <Route path="/qaqc" component={DashboardPage} />
    <Route path="/qaqc/metrics" component={MetricsPage} />
    <Route path="/qaqc/material-inspections">{() => <SimpleRecordsPage kind="mir" />}</Route>
    <Route path="/qaqc/qtbt">{() => <SimpleRecordsPage kind="qtbt" />}</Route>
    <Route path="/qaqc/customer-satisfaction">{() => <SimpleRecordsPage kind="csat" />}</Route>
    <Route path="/qaqc/documents">{() => <SimpleRecordsPage kind="documents" />}</Route>
    <Route path="/qaqc/briefs/:id" component={BriefEditor} />
    <Route path="/qaqc/briefs" component={BriefsPage} />
    <Route path="/qaqc/approvals" component={ApprovalsPage} />
    <Route><NotFound /></Route>
  </Switch>;
}
