import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileUp, Plus, RefreshCw, Save, Trash2, Wand2 } from 'lucide-react';
import {
  createQaqcPdfTemplate, downloadQaqcPdfTemplate, inspectQaqcPdfTemplate, publishQaqcPdfTemplate, resumeQaqcPdfTemplateUpload, updateQaqcPdfTemplate,
  useGetQaqcPdfTemplateCatalog, useListQaqcPdfTemplates, type QaqcPdfTemplate,
} from '@workspace/api-client-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errMsg, saveFile } from './shell';

type RT = 'monthly' | 'daily' | 'csat';
type Kind = 'report' | 'dashboard';
const LIST_KEY = '/api/qaqc/reporting/pdf-templates';
const RT_LABEL: Record<RT, string> = { monthly: 'Monthly report', daily: 'Daily report', csat: 'Customer Satisfaction (CSAT) report' };
const KIND_LABEL: Record<Kind, string> = { report: 'Report', dashboard: 'Dashboard' };
const PDF = { headers: { Accept: 'application/pdf' } };

interface Row { source: string; mode: 'field' | 'rect'; pdfField: string; page: string; x: string; y: string; width: string; height: string; fontSize: string }
const emptyRow = (): Row => ({ source: '', mode: 'field', pdfField: '', page: '1', x: '', y: '', width: '', height: '', fontSize: '10' });
const toRows = (t: QaqcPdfTemplate): Row[] => t.mappings.map(m => ({
  source: m.source, mode: m.pdfField ? 'field' : 'rect', pdfField: m.pdfField ?? '', page: String(m.page ?? 1),
  x: m.x == null ? '' : String(m.x), y: m.y == null ? '' : String(m.y), width: m.width == null ? '' : String(m.width), height: m.height == null ? '' : String(m.height), fontSize: m.fontSize == null ? '' : String(m.fontSize),
}));
const toPayload = (rows: Row[]) => rows.map(r => r.mode === 'field'
  ? { source: r.source.trim(), pdfField: r.pdfField }
  : { source: r.source.trim(), page: Number(r.page), x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height), ...(r.fontSize ? { fontSize: Number(r.fontSize) } : {}) });

function validate(rows: Row[], t: QaqcPdfTemplate): string[][] {
  const used = new Map<string, number>();
  rows.forEach(r => { if (r.mode === 'field' && r.pdfField) used.set(r.pdfField, (used.get(r.pdfField) ?? 0) + 1); });
  return rows.map(r => {
    const e: string[] = [];
    if (!r.source.trim()) e.push('Source path is required.'); else if (r.source.length > 200) e.push('Source path is limited to 200 characters.');
    if (r.mode === 'field') {
      if (!r.pdfField) e.push('Choose a fillable PDF field.'); else if ((used.get(r.pdfField) ?? 0) > 1) e.push('This PDF field is mapped more than once.');
    } else {
      const page = Number(r.page); const pg = t.pages[page - 1];
      const [x, y, w, h, fs] = [r.x, r.y, r.width, r.height, r.fontSize].map(v => (v === '' ? NaN : Number(v)));
      if (!Number.isInteger(page) || page < 1 || page > Math.min(40, t.pages.length || 40)) e.push(`Page must be between 1 and ${t.pages.length || 40}.`);
      if (!(x >= 0)) e.push('X must be 0 or more.'); if (!(y >= 0)) e.push('Y must be 0 or more.');
      if (!(w > 0)) e.push('Width must be above 0.'); if (!(h > 0)) e.push('Height must be above 0.');
      if (pg && x + w > pg.width + 0.01) e.push(`Rectangle exceeds page width (${pg.width} pt).`);
      if (pg && y + h > pg.height + 0.01) e.push(`Rectangle exceeds page height (${pg.height} pt).`);
      if (r.fontSize !== '' && !(fs >= 6 && fs <= 36)) e.push('Font size must be 6 to 36.');
    }
    return e;
  });
}

const pdfProblem = (f: File) => f.size > 10485760 ? 'The PDF must be 10 MB or smaller.' : f.size < 1 ? 'The file is empty.' : (f.type && f.type !== 'application/pdf') || !/\.pdf$/i.test(f.name) ? 'Only PDF files are accepted.' : '';
async function putPdf(url: string, f: File) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: f });
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status}).`);
}
const stateTone = (s: string) => s === 'published' ? 'bg-accent text-accent-foreground' : s === 'draft' ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground';

export function PdfTemplatesAdmin() {
  const [reportType, setReportType] = useState<RT | 'all'>('all');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const params = { includeDrafts: true, ...(reportType !== 'all' ? { reportType } : {}), ...(kind !== 'all' ? { kind } : {}) };
  const list = useListQaqcPdfTemplates(params, { query: { refetchOnMount: 'always', queryKey: [LIST_KEY, params] } });
  const items = list.data ?? [];
  const open = items.find(t => t.id === openId) ?? null;
  const { toast } = useToast(); const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [LIST_KEY] });
  const [retrying, setRetrying] = useState<string | null>(null);
  const resume = async (t: QaqcPdfTemplate, f: File | undefined) => {
    if (!f) return;
    const bad = pdfProblem(f);
    if (bad) { toast({ title: 'File not accepted', description: bad, variant: 'destructive' }); return; }
    setRetrying(t.id);
    try {
      const r = await resumeQaqcPdfTemplateUpload(t.id, { fileName: f.name, fileSize: f.size });
      await putPdf(r.uploadUrl, f); await inspectQaqcPdfTemplate(t.id);
      toast({ title: 'Upload resumed', description: 'Review the detected fields and confirm mappings.' }); setOpenId(t.id);
    } catch (e) { toast({ title: 'Resume failed', description: errMsg(e), variant: 'destructive' }); }
    finally { setRetrying(null); refresh(); }
  };
  const retryInspect = async (t: QaqcPdfTemplate) => {
    setRetrying(t.id);
    try { await inspectQaqcPdfTemplate(t.id); toast({ title: 'Inspection complete', description: `${t.name} ${t.version}` }); }
    catch (e) { toast({ title: 'Inspection failed', description: errMsg(e), variant: 'destructive' }); }
    finally { setRetrying(null); refresh(); }
  };
  const groups = useMemo(() => ['draft', 'published', 'archived'].map(s => [s, items.filter(t => t.state === s)] as const), [items]);

  return <div className="space-y-5" data-testid="pdf-templates-admin">
    <Card><CardHeader><CardTitle>PDF Templates</CardTitle><CardDescription>
      Upload the approved exact-PDF form for each report or dashboard. The <b>name</b> must be the approved form name and the <b>version</b> its approved revision (for example, "QA-FRM-014" and "Rev 3"). Fields on your reports and the data-entry forms are not changed; mappings only decide where values are placed on the PDF. Previews use sample data, never business data.
    </CardDescription></CardHeader></Card>
    <UploadCard onDone={id => { refresh(); setOpenId(id); }} />
    <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">Version manager</CardTitle><CardDescription>Every version is retained. Published mappings are immutable; upload a new named version to revise.</CardDescription></div>
      <div className="flex flex-wrap gap-2">
        <Select value={reportType} onValueChange={v => setReportType(v as RT | 'all')}><SelectTrigger className="w-40" data-testid="filter-pdf-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{(Object.keys(RT_LABEL) as RT[]).map(k => <SelectItem key={k} value={k}>{RT_LABEL[k]}</SelectItem>)}</SelectContent></Select>
        <Select value={kind} onValueChange={v => setKind(v as Kind | 'all')}><SelectTrigger className="w-36" data-testid="filter-pdf-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Reports and dashboards</SelectItem><SelectItem value="report">Reports</SelectItem><SelectItem value="dashboard">Dashboards</SelectItem></SelectContent></Select>
        <Button variant="outline" size="icon" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className="size-4" /></Button>
      </div></CardHeader>
      <CardContent className="space-y-5">
        {list.isLoading && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>}
        {list.error && <Alert variant="destructive"><AlertTitle>Templates could not be loaded</AlertTitle><AlertDescription>{errMsg(list.error)} <button className="underline" onClick={() => list.refetch()}>Retry</button></AlertDescription></Alert>}
        {!list.isLoading && !list.error && items.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No named PDF templates yet. Upload the first approved form above.</div>}
        {groups.map(([state, rows]) => rows.length > 0 && <div key={state} className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{state} ({rows.length})</p>
          {rows.map(t => <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" data-testid={`row-pdf-template-${t.id}`}>
            <div className="min-w-48 flex-1"><p className="font-medium">{t.name} <span className="text-muted-foreground">- {t.version}</span></p><p className="text-xs text-muted-foreground">{RT_LABEL[t.reportType]} / {KIND_LABEL[t.kind]} / {t.fileName}</p></div>
            <Badge className={stateTone(t.state)}>{t.state}</Badge>
            {t.isDefault && <Badge variant="outline">Default for scheduled exports</Badge>}
            {!t.uploaded && <Badge variant="destructive">File not uploaded</Badge>}
            {t.state === 'draft' && !t.uploaded && <label className="inline-flex"><input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={retrying === t.id} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void resume(t, f); }} data-testid={`input-resume-upload-${t.id}`} /><span className="inline-flex h-8 cursor-pointer items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"><FileUp className="mr-2 size-4" />Resume upload</span></label>}
            {t.state === 'draft' && t.uploaded && t.pages.length === 0 && <Button size="sm" variant="outline" disabled={retrying === t.id} onClick={() => retryInspect(t)} data-testid={`button-retry-inspect-${t.id}`}><RefreshCw className="mr-2 size-4" />Retry inspection</Button>}
            <Button size="sm" variant="secondary" onClick={() => setOpenId(t.id)} data-testid={`button-open-pdf-template-${t.id}`}>{t.state === 'draft' ? 'Edit mappings' : 'View mappings'}</Button>
          </div>)}
        </div>)}
      </CardContent></Card>
    {open && <TemplateEditor key={open.id} template={open} onClose={() => setOpenId(null)} onChanged={refresh} />}
  </div>;
}

function UploadCard({ onDone }: { onDone: (id: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(''); const [version, setVersion] = useState('');
  const [reportType, setReportType] = useState<RT>('monthly'); const [kind, setKind] = useState<Kind>('report');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const pending = useRef<{ id: string; uploadUrl: string; uploaded: boolean; fresh: boolean } | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const problem = !name.trim() ? 'Enter the approved form name.' : !version.trim() ? 'Enter the approved version.' : !file ? 'Choose the approved PDF.'
    : pdfProblem(file);
  const finish = async (f: File) => {
    const p = pending.current!;
    if (!p.uploaded) {
      if (!p.fresh) p.uploadUrl = (await resumeQaqcPdfTemplateUpload(p.id, { fileName: f.name, fileSize: f.size })).uploadUrl;
      p.fresh = false;
      await putPdf(p.uploadUrl, f);
      p.uploaded = true;
    }
    await inspectQaqcPdfTemplate(p.id);
  };
  const submit = async () => {
    if (problem || !file) return;
    setBusy(true); setError('');
    try {
      if (!pending.current) {
        const r = await createQaqcPdfTemplate({ name: name.trim(), version: version.trim(), reportType, kind, fileName: file.name, fileSize: file.size });
        pending.current = { id: r.template.id, uploadUrl: r.uploadUrl, uploaded: false, fresh: true }; setHasPending(true);
      }
      await finish(file);
      const id = pending.current.id;
      pending.current = null; setHasPending(false); setName(''); setVersion(''); setFile(null); if (fileRef.current) fileRef.current.value = '';
      toast({ title: 'Template uploaded', description: 'Review the detected fields and confirm mappings.' }); onDone(id);
    } catch (e) {
      setError(`${errMsg(e)} The draft record is kept. Retry (a fresh upload link is requested), abandon the pending upload, or use "Resume upload" on the draft later.`);
      onDone('');
    } finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle className="text-base">Upload a new named version</CardTitle></CardHeader><CardContent className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1"><Label>Approved form name</Label><Input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="QA-FRM-014 Monthly Quality Report" disabled={hasPending} data-testid="input-pdf-name" /></div>
      <div className="space-y-1"><Label>Approved version</Label><Input value={version} onChange={e => setVersion(e.target.value)} maxLength={60} placeholder="Rev 3" disabled={hasPending} data-testid="input-pdf-version" /></div>
      <div className="space-y-1"><Label>Report type</Label><Select value={reportType} onValueChange={v => setReportType(v as RT)} disabled={hasPending}><SelectTrigger data-testid="select-pdf-report-type"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(RT_LABEL) as RT[]).map(k => <SelectItem key={k} value={k}>{RT_LABEL[k]}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label>Used for</Label><Select value={kind} onValueChange={v => setKind(v as Kind)} disabled={hasPending}><SelectTrigger data-testid="select-pdf-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="report">Individual report export</SelectItem><SelectItem value="dashboard">Dashboard export</SelectItem></SelectContent></Select></div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Input ref={fileRef} type="file" accept="application/pdf,.pdf" className="max-w-sm" disabled={hasPending} onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-pdf-file" />
      <Button onClick={submit} disabled={busy || !!problem} data-testid="button-upload-pdf"><FileUp className="mr-2 size-4" />{busy ? 'Working...' : hasPending ? 'Retry upload and inspection' : 'Upload and inspect'}</Button>
      {hasPending && <Button variant="outline" disabled={busy} onClick={() => { pending.current = null; setHasPending(false); setError(''); }} data-testid="button-abandon-upload">Abandon pending upload</Button>}
      {problem && (name || version || file) && <span className="text-xs text-muted-foreground">{problem}</span>}
    </div>
    {error && <Alert variant="destructive"><AlertTitle>Upload or inspection incomplete</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </CardContent></Card>;
}

function TemplateEditor({ template: t, onClose, onChanged }: { template: QaqcPdfTemplate; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const draft = t.state === 'draft';
  const catalog = useGetQaqcPdfTemplateCatalog({ reportType: t.reportType, kind: t.kind }, { query: { refetchOnMount: 'always', queryKey: [LIST_KEY, 'catalog', t.reportType, t.kind] } });
  const sources = catalog.data ?? [];
  const [rows, setRows] = useState<Row[]>(() => toRows(t));
  const [saved, setSaved] = useState(JSON.stringify(toRows(t)));
  const [previewed, setPreviewed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [suggest, setSuggest] = useState<Row[]>([]);
  const [confirm, setConfirm] = useState<'publish' | 'archive' | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const dirty = JSON.stringify(rows) !== saved;
  const errors = useMemo(() => validate(rows, t), [rows, t]);
  const invalid = errors.some(e => e.length > 0) || rows.length > 500;
  useEffect(() => { if (dirty) setPreviewed(false); }, [dirty]);

  // Auto-match fillable names to exact catalog paths: suggestions only, admin confirms.
  useEffect(() => {
    if (!draft || !sources.length) return;
    const taken = new Set(rows.map(r => r.pdfField).filter(Boolean));
    const paths = new Set(sources.map(s => s.path));
    setSuggest(t.fields.filter(f => paths.has(f.name) && !taken.has(f.name)).map(f => ({ ...emptyRow(), source: f.name, pdfField: f.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, t.fields, draft]);

  const patch = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...p } : r));
  const act = async (label: string, fn: () => Promise<void>) => { setBusy(label); setError(''); try { await fn(); } catch (e) { setError(`${label} failed: ${errMsg(e)}`); } finally { setBusy(''); } };
  const save = () => act('Save', async () => {
    const r = await updateQaqcPdfTemplate(t.id, { mappings: toPayload(rows) });
    setSaved(JSON.stringify(rows)); setRows(toRows(r)); setSaved(JSON.stringify(toRows(r))); onChanged(); toast({ title: 'Mappings saved' });
  });
  const preview = () => act('Preview', async () => {
    saveFile(await downloadQaqcPdfTemplate(t.id, { preview: true }, PDF), `${t.name}-${t.version}-sample-preview.pdf`); setPreviewed(true);
    toast({ title: 'Sample preview generated', description: 'Sample data only. Check placement before publishing.' });
  });
  const blank = () => act('Blank download', async () => { saveFile(await downloadQaqcPdfTemplate(t.id, undefined, PDF), `${t.name}-${t.version}-blank.pdf`); });
  const reinspect = () => act('Inspection', async () => { await inspectQaqcPdfTemplate(t.id); onChanged(); toast({ title: 'Inspection complete' }); });
  const setState = (state: 'published' | 'archived', isDefault: boolean) => act(state === 'published' ? 'Publish' : 'Archive', async () => {
    await publishQaqcPdfTemplate(t.id, { state, isDefault }); onChanged(); setConfirm(null);
    toast({ title: state === 'published' ? (isDefault ? 'Set as default' : 'Published') : 'Archived' });
    if (state === 'archived') onClose();
  });
  const fieldNames = t.fields.map(f => f.name);

  return <Card className="border-primary/40" data-testid="pdf-template-editor">
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
      <div><CardTitle className="text-base">{t.name} - {t.version}</CardTitle>
        <CardDescription>{RT_LABEL[t.reportType]} / {KIND_LABEL[t.kind]} / {t.pages.length} page(s) / {t.fields.length} fillable field(s). Coordinates are PDF points measured from the top-left of the page (pages start at 1).</CardDescription></div>
      <div className="flex flex-wrap gap-2"><Badge className={stateTone(t.state)}>{t.state}</Badge><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></div>
    </CardHeader>
    <CardContent className="space-y-4">
      {!draft && <Alert><AlertTitle>Read-only</AlertTitle><AlertDescription>{t.state === 'published' ? 'Published mappings cannot be edited. Upload a new named version to revise this form.' : 'Archived versions are retained for reference.'}</AlertDescription></Alert>}
      {t.pages.length === 0 && draft && <Alert variant="destructive"><AlertTitle>File not inspected yet</AlertTitle><AlertDescription>Pages and fields are unknown until inspection succeeds. <Button size="sm" variant="outline" className="ml-2" disabled={!!busy} onClick={reinspect}>Retry inspection</Button></AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertTitle>Action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      {draft && suggest.length > 0 && <Alert><AlertTitle>{suggest.length} fillable field(s) match catalog paths exactly</AlertTitle>
        <AlertDescription><p className="mb-2 text-xs">{suggest.map(s => s.source).join(', ')}</p>
          <Button size="sm" onClick={() => { setRows(rs => [...rs, ...suggest]); setSuggest([]); }} data-testid="button-apply-matches"><Wand2 className="mr-2 size-4" />Confirm and add these mappings</Button></AlertDescription></Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Mappings ({rows.length})</p>
        <Button size="sm" variant="ghost" onClick={() => setShowCatalog(s => !s)}>{showCatalog ? 'Hide' : 'Show'} source catalog and examples</Button></div>
      {showCatalog && <div className="max-h-56 overflow-auto rounded-lg border text-xs">
        {catalog.isLoading ? <p className="p-3">Loading catalog...</p> : catalog.error ? <p className="p-3 text-destructive">{errMsg(catalog.error)}</p> :
          <table className="w-full"><thead className="bg-muted text-left"><tr><th className="p-2">Source path</th><th className="p-2">Label</th><th className="p-2">Sample value</th></tr></thead><tbody>
            {sources.map(s => <tr key={s.path} className="border-t"><td className="p-2 font-mono">{s.path}</td><td className="p-2">{s.label}</td><td className="p-2 text-muted-foreground">{s.example}</td></tr>)}</tbody></table>}
      </div>}
      <datalist id={`sources-${t.id}`}>{sources.map(s => <option key={s.path} value={s.path}>{s.label}</option>)}</datalist>

      {rows.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No mappings yet.{draft ? ' Add a mapping to place a data source on the PDF.' : ''}</div>}
      <div className="space-y-2">
        {rows.map((r, i) => <div key={i} className={`rounded-lg border p-3 ${errors[i]?.length ? 'border-destructive/60' : ''}`} data-testid={`row-mapping-${i}`}>
          <div className="grid gap-2 md:grid-cols-[1.4fr_.8fr_1.6fr_auto]">
            <div className="space-y-1"><Label className="text-xs">Source (pick or type a dot-path)</Label>
              <Input list={`sources-${t.id}`} value={r.source} readOnly={!draft} onChange={e => patch(i, { source: e.target.value })} className="font-mono text-xs" placeholder="e.g. totals.issued" data-testid={`input-mapping-source-${i}`} />
              {sources.find(s => s.path === r.source)?.example && <p className="text-[11px] text-muted-foreground">Example: {sources.find(s => s.path === r.source)?.example}</p>}</div>
            <div className="space-y-1"><Label className="text-xs">Target</Label>
              <Select value={r.mode} onValueChange={v => patch(i, { mode: v as Row['mode'] })} disabled={!draft}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="field">Fillable field</SelectItem><SelectItem value="rect">Rectangle</SelectItem></SelectContent></Select></div>
            {r.mode === 'field'
              ? <div className="space-y-1"><Label className="text-xs">PDF field</Label>
                <Select value={r.pdfField} onValueChange={v => patch(i, { pdfField: v })} disabled={!draft}><SelectTrigger><SelectValue placeholder="Choose field" /></SelectTrigger><SelectContent>{fieldNames.length === 0 ? <SelectItem value="__none" disabled>No fillable fields detected</SelectItem> : fieldNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select></div>
              : <div className="grid grid-cols-6 gap-1">{([['page', 'Page'], ['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H'], ['fontSize', 'Font']] as const).map(([k, l]) => <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label><Input type="number" min={0} value={r[k]} readOnly={!draft} onChange={e => patch(i, { [k]: e.target.value } as Partial<Row>)} className="px-1.5" /></div>)}</div>}
            {draft && <div className="flex items-end"><Button size="icon" variant="ghost" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="Delete mapping" data-testid={`button-delete-mapping-${i}`}><Trash2 className="size-4" /></Button></div>}
          </div>
          {errors[i]?.map(m => <p key={m} className="mt-1 text-xs text-destructive">{m}</p>)}
        </div>)}
      </div>
      {draft && <Button variant="outline" size="sm" onClick={() => setRows(rs => [...rs, emptyRow()])} disabled={rows.length >= 500} data-testid="button-add-mapping"><Plus className="mr-2 size-4" />Add mapping</Button>}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" disabled={!!busy || !t.uploaded} onClick={blank} data-testid="button-download-blank"><Download className="mr-2 size-4" />Blank PDF</Button>
        {draft && <>
          <Button disabled={!!busy || !dirty || invalid} onClick={save} data-testid="button-save-mappings"><Save className="mr-2 size-4" />{busy === 'Save' ? 'Saving...' : 'Save mappings'}</Button>
          <Button variant="secondary" disabled={!!busy || dirty || invalid || !t.uploaded} onClick={preview} data-testid="button-preview-pdf"><Eye className="mr-2 size-4" />Preview sample PDF</Button>
          <Button disabled={!!busy || dirty || invalid || !previewed} onClick={() => { setMakeDefault(false); setConfirm('publish'); }} data-testid="button-publish-pdf">Publish</Button>
        </>}
        {t.state === 'published' && !t.isDefault && <Button variant="secondary" disabled={!!busy} onClick={() => setState('published', true)} data-testid="button-make-default">Make default for scheduled exports</Button>}
        {t.state !== 'archived' && <Button variant="destructive" disabled={!!busy} onClick={() => setConfirm('archive')} data-testid="button-archive-pdf">Archive</Button>}
      </div>
      {draft && <p className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes: save before previewing.' : !previewed ? 'Preview the sample PDF (sample data only) to enable Publish.' : 'Saved and previewed. Ready to publish.'}</p>}
    </CardContent>

    <Dialog open={confirm === 'publish'} onOpenChange={o => !o && setConfirm(null)}><DialogContent>
      <DialogHeader><DialogTitle>Publish {t.name} - {t.version}?</DialogTitle><DialogDescription>Published mappings become immutable and available for export selection. To revise, upload a new named version.</DialogDescription></DialogHeader>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={makeDefault} onCheckedChange={v => setMakeDefault(v === true)} />Use as the default for scheduled exports of this type</label>
      <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button disabled={!!busy} onClick={() => setState('published', makeDefault)} data-testid="button-confirm-publish">Publish</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={confirm === 'archive'} onOpenChange={o => !o && setConfirm(null)}><DialogContent>
      <DialogHeader><DialogTitle>Archive {t.name} - {t.version}?</DialogTitle><DialogDescription>Users will no longer be able to select this version for new exports. The version and its mappings are retained.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="destructive" disabled={!!busy} onClick={() => setState('archived', false)} data-testid="button-confirm-archive">Archive</Button></DialogFooter>
    </DialogContent></Dialog>
  </Card>;
}
