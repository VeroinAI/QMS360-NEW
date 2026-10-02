import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileSpreadsheet, FileText, Save, Send, Trash2, Upload, Eraser } from 'lucide-react';
import {
  getGetQaqcSowContextQueryKey, getGetQaqcSowReportQueryKey, downloadQaqcSowTemplate, exportQaqcSowReport,
  useCreateQaqcSowReport, useDeleteQaqcSowReport, useDraftQaqcSowBrief, useGetCurrentUser, useGetQaqcSowContext,
  useGetQaqcSowReport, useImportQaqcSowWorkbook, useReviewQaqcSowReport, useSubmitQaqcSowReport, useUpdateQaqcSowReport,
} from '@workspace/api-client-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useFieldControls } from '@/lib/field-controls';
import { CsatForm } from './csat-form';
import { DailyForm } from './daily-form';
import { FormCtx, ReadOnlyValue, setIn } from './form-kit';
import { MonthlyForm } from './monthly-form';
import { calcDaily, calcMonthly, defaultData, defaultPeriod, todayIso, zeroFill, type Obj, type ReportType } from './reporting-types';
import { DataTree, ErrorBox, Loading, PageFrame, StateBadge, errMsg, saveFile, useBusy, useInvalidate } from './shell';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TITLES: Record<ReportType, string> = { monthly: 'Monthly quality report', daily: 'Daily document governance report', csat: 'Customer satisfaction survey' };

function normalise(type: ReportType, d: Obj): Obj {
  let out = d;
  if (type === 'csat') out = { ...d, ratings: Object.fromEntries(Object.entries(d.ratings ?? {}).map(([k, v]) => [k, Number(v)])) };
  if (type === 'monthly') out = { ...d, manpower: (d.manpower ?? []).map((r: Obj) => (r.approvalRequired ? r : { ...r, approved: 0, rejected: 0 })) };
  return out;
}
const toBase64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export function ReportEditor({ reportType, id }: { reportType: ReportType; id?: string }) {
  const [, nav] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const { busy, run } = useBusy();
  const me = useGetCurrentUser();
  const fc = useFieldControls('qaqc', 'report-envelope');
  const locked = fc.fieldProps('data').disabled;
  const reportQ = useGetQaqcSowReport(id ?? '', { query: { enabled: !!id, queryKey: getGetQaqcSowReportQueryKey(id ?? '') } });
  const report = reportQ.data;
  const [projectId, setProjectId] = useState('');
  const [period, setPeriod] = useState(defaultPeriod(reportType));
  const pid = report?.projectId ?? projectId;
  const per = report?.period ?? period;
  const ctxParams = { projectId: pid || undefined, reportType, period: per || undefined };
  const ctxQ = useGetQaqcSowContext(ctxParams, { query: { queryKey: getGetQaqcSowContextQueryKey(ctxParams), enabled: !id || !!report } });
  const ctx = (ctxQ.data ?? {}) as Obj;
  const [data, setData] = useState<Obj>(() => defaultData(reportType));
  const initFor = useRef<string | null>(null);
  useEffect(() => { if (report && initFor.current !== report.id) { initFor.current = report.id; setData({ ...defaultData(reportType), ...(report.data as Obj) }); } }, [report, reportType]);

  const create = useCreateQaqcSowReport(); const update = useUpdateQaqcSowReport(); const del = useDeleteQaqcSowReport();
  const submit = useSubmitQaqcSowReport(); const review = useReviewQaqcSowReport(); const importer = useImportQaqcSowWorkbook(); const ai = useDraftQaqcSowBrief();
  const [aiDraft, setAiDraft] = useState(() => (id ? sessionStorage.getItem(`qaqc-ai-${id}`) ?? '' : ''));
  const [imports, setImports] = useState<string[]>([]);
  const [approverId, setApproverId] = useState(''); const [submitOpen, setSubmitOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'send_back'>(); const [comments, setComments] = useState('');

  const editable = !report || report.state === 'draft' || report.state === 'sent_back';
  const blocked = !report && ctx.canStart === false;
  const readOnly = !editable || blocked || !pid || locked;
  const frozen = !!report && !editable;
  const baseline: Obj = (frozen ? report?.baseline : ctx.baseline) ?? {};
  const targets = ctx.targets as Obj | undefined;
  const clean = useMemo(() => normalise(reportType, data), [data, reportType]);
  const monthly = useMemo(() => calcMonthly(clean, baseline, targets), [clean, baseline, targets]);
  const daily = useMemo(() => calcDaily(clean), [clean]);
  const csatIssues = reportType === 'csat' ? [
    ...['quality', 'timeline', 'communication', 'professionalism', 'valueForMoney', 'issueHandling'].filter(k => !(Number(clean.ratings?.[k]) >= 1 && Number(clean.ratings?.[k]) <= 5)).map(k => `Rating "${k}" must be 1 to 5.`),
    ...(['expectations', 'recommend'] as const).filter(k => !['Yes', 'No', 'Partially'].includes(clean[k])).map(k => `Answer "${k}" is required.`),
  ] : [];
  const issues = reportType === 'monthly' ? monthly.issues : reportType === 'daily' ? daily.issues : csatIssues;
  const projects: Obj[] = ctx.projects ?? [];
  const approvers: Obj[] = ctx.approvers ?? [];
  const details: Obj = ctx.projectDetails ?? {};
  const assignedReviewer = approvers.find(a => a.id === report?.approverId);
  const isApprover = report?.state === 'submitted' && !!me.data && report.approverId === me.data.id && report.submittedById !== me.data.id;
  const projectName = report?.projectName ?? projects.find(p => p.id === pid)?.name;

  const form = { data, readOnly, set: (p: (string | number)[], v: unknown) => setData(d => {
    const updated = setIn(d, p, v);
    // Zero-fill is a starting point: later numeric edits must not be erased on save.
    return typeof v === 'number' && v !== 0 ? { ...updated, noUpdates: false } : updated;
  }), fc: () => ({ disabled: locked, required: false }), departments: (ctx.masterData?.departments ?? ctx.masterData?.qmsDepartments) as (string | { value: string; label?: string })[] | undefined };
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: 'destructive' });

  const save = () => {
    if (report) update.mutate({ id: report.id, data: { data: clean } }, { onSuccess: r => { qc.setQueryData(getGetQaqcSowReportQueryKey(report.id), r); invalidate(); toast({ title: 'Draft saved' }); }, onError: fail('Could not save') });
    else create.mutate({ data: { projectId: pid, reportType, period: per, data: clean } }, { onSuccess: r => { invalidate(); toast({ title: 'Draft created' }); nav(`/qaqc/${reportType}/${r.id}`); }, onError: fail('Could not create') });
  };
  const doSubmit = () => {
    if (!report) return;
    const send = () => submit.mutate({ id: report.id, data: { approverId } }, { onSuccess: () => { invalidate(); toast({ title: 'Submitted for approval' }); setSubmitOpen(false); }, onError: fail('Could not submit') });
    update.mutate({ id: report.id, data: { data: clean } }, { onSuccess: send, onError: fail('Could not save before submit') });
  };
  const doReview = () => { if (!report || !decision) return; review.mutate({ id: report.id, data: { decision, comments: comments || undefined } }, { onSuccess: () => { invalidate(); toast({ title: decision === 'approve' ? 'Report approved' : 'Report sent back' }); setDecision(undefined); setComments(''); }, onError: fail('Review failed') }); };
  const doDelete = () => { if (report) del.mutate({ id: report.id }, { onSuccess: () => { invalidate(); toast({ title: 'Draft deleted' }); nav(`/qaqc/${reportType}`); }, onError: fail('Could not delete') }); };
  // Persist the draft first when the report is new, then call the real report id.
  const saveDraftFirst = async (): Promise<string> => {
    if (report) { const r = await update.mutateAsync({ id: report.id, data: { data: clean } }); qc.setQueryData(getGetQaqcSowReportQueryKey(report.id), r); return report.id; }
    const r = await create.mutateAsync({ data: { projectId: pid, reportType, period: per, data: clean } });
    invalidate();
    return r.id;
  };
  const draftAi = () => run(async () => {
    try {
      const rid = await saveDraftFirst();
      const r = await ai.mutateAsync({ id: rid, data: { data: clean } });
      setAiDraft(r.draft);
      sessionStorage.setItem(`qaqc-ai-${rid}`, r.draft);
      if (!report) nav(`/qaqc/${reportType}/${rid}`, { replace: true });
    } catch (e) { fail('AI draft unavailable')(e); }
  });
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file || !pid) return;
    importer.mutate({ data: { reportType, projectId: pid, period: per, workbook: toBase64(await file.arrayBuffer()) } }, {
      onSuccess: r => { setImports(r.errors ?? []); setData({ ...defaultData(reportType), ...(r.data as Obj) }); toast({ title: 'Workbook loaded for review', description: 'Nothing is saved until you save the draft.' }); }, onError: fail('Import failed'),
    });
  };

  if (id && reportQ.isLoading) return <PageFrame title={TITLES[reportType]} description="Loading report"><Loading /></PageFrame>;
  if (id && reportQ.error) return <PageFrame title={TITLES[reportType]} description="Report unavailable"><ErrorBox error={reportQ.error} retry={() => reportQ.refetch()} /></PageFrame>;

  return <FormCtx.Provider value={form}>
    <PageFrame title={report ? `${TITLES[reportType]} ${report.referenceNumber ? `- ${report.referenceNumber}` : ''}` : `New ${TITLES[reportType].toLowerCase()}`} description={projectName ? `${projectName} - ${per}` : 'Select a project and period to begin.'}
      actions={<><Link href={`/qaqc/${reportType}`}><Button variant="secondary"><ArrowLeft className="mr-2 size-4" />All reports</Button></Link>
        {report && <><Button variant="secondary" disabled={busy} onClick={() => run(async () => { try { saveFile(await exportQaqcSowReport(report.id, { headers: { Accept: XLSX_MIME } }), `${reportType}-${per}.xlsx`); } catch (e) { fail('Export failed')(e); } })}><FileSpreadsheet className="mr-2 size-4" />XLSX</Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(async () => { try { saveFile(await exportQaqcSowReport(report.id, { headers: { Accept: 'application/pdf' } }), `${reportType}-${per}.pdf`); } catch (e) { fail('Export failed')(e); } })}><FileText className="mr-2 size-4" />PDF</Button></>}</>}>
      {report && <div className="flex flex-wrap items-center gap-3"><StateBadge state={report.state} />{report.submittedAt && <span className="text-sm text-muted-foreground">Submitted {new Date(report.submittedAt).toLocaleString()}</span>}{frozen && <span className="text-sm text-muted-foreground">Read-only after submission</span>}</div>}
      {report?.state === 'sent_back' && <Alert variant="destructive"><AlertTitle>Sent back for correction</AlertTitle><AlertDescription>{report.reviewComments}</AlertDescription></Alert>}
      <Card><CardHeader className="pb-3"><CardTitle className="text-base">Project and period</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Project</Label>{report ? <ReadOnlyValue label="" value={projectName} /> : <Select disabled={fc.fieldProps('projectId').disabled} value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue placeholder={ctxQ.isLoading ? 'Loading projects' : 'Select project'} /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} - ` : ''}{p.name}</SelectItem>)}</SelectContent></Select>}</div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">{reportType === 'monthly' ? 'Period (month)' : 'Date'}</Label>{report ? <ReadOnlyValue label="" value={per} /> : reportType !== 'monthly' ? <Input disabled={fc.fieldProps('period').disabled} type="date" max={todayIso()} value={period} onChange={e => setPeriod(e.target.value)} /> : <Input disabled={fc.fieldProps('period').disabled} type="month" max={todayIso().slice(0, 7)} value={period.slice(0, 7)} onChange={e => e.target.value && setPeriod(`${e.target.value}-01`)} />}</div>
          <ReadOnlyValue label="Cost centre" value={details.costCentre} /><ReadOnlyValue label="Project manager" value={details.pmName} />
          <ReadOnlyValue label="Project engineer" value={details.peName} /><ReadOnlyValue label="Document controller" value={details.dcName} />
        </div>
        {ctxQ.error && <ErrorBox error={ctxQ.error} retry={() => ctxQ.refetch()} />}
        {blocked && <Alert variant="destructive"><AlertTitle>Entry is blocked</AlertTitle><AlertDescription>{ctx.blockedReason ?? 'The immediately preceding period must be submitted first.'}</AlertDescription></Alert>}
        {pid && !blocked && !report && reportType !== 'csat' && !baseline?.hasBaseline && <Alert><AlertTitle>First report for this project</AlertTitle><AlertDescription>No earlier submission exists, so the baseline starts from zero.</AlertDescription></Alert>}
        {baseline?.previousPeriod && <p className="text-xs text-muted-foreground">Baseline taken from the submitted report for {String(baseline.previousPeriod)}{frozen ? ' (frozen at submission)' : ''}.</p>}
      </CardContent></Card>

      {!readOnly || report ? <>
        {editable && pid && !blocked && !locked && <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => run(async () => { try { saveFile(await downloadQaqcSowTemplate({ reportType }), `${reportType}-template.xlsx`); } catch (e) { fail('Template download failed')(e); } })}><Download className="mr-2 size-4" />Template</Button>
          <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"><Upload className="size-4" />{importer.isPending ? 'Validating...' : 'Import workbook'}<input type="file" accept=".xlsx" className="hidden" onChange={importFile} /></Label>
          {reportType !== 'csat' && <Button variant="outline" size="sm" onClick={() => setData(d => zeroFill(reportType, d))}><Eraser className="mr-2 size-4" />Zero-fill</Button>}
        </div>}
        {imports.length > 0 && <Alert variant="destructive"><AlertTitle>Import validation messages</AlertTitle><AlertDescription><ul className="list-disc pl-5">{imports.map((m, i) => <li key={i}>{m}</li>)}</ul></AlertDescription></Alert>}
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div>{reportType === 'monthly' ? <MonthlyForm calc={monthly} target={targets} onDraftAi={draftAi} aiBusy={ai.isPending || busy} aiDraft={aiDraft} onUseDraft={() => setData(d => ({ ...d, narrative: aiDraft }))} />
            : reportType === 'daily' ? <DailyForm calc={daily} baseline={baseline} /> : <CsatForm />}</div>
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Validation</CardTitle></CardHeader><CardContent className="text-sm">{issues.length ? <ul className="list-disc space-y-1 pl-4 text-destructive">{issues.map((m, i) => <li key={i}>{m}</li>)}</ul> : <p className="text-muted-foreground">No issues found in the live preview. The server validates again on submit.</p>}</CardContent></Card>
            {report && Object.keys(report.computed ?? {}).length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Server calculation</CardTitle></CardHeader><CardContent className="max-h-96 overflow-auto text-sm"><DataTree value={report.computed} level={1} /></CardContent></Card>}
            <Card><CardContent className="space-y-2 p-4">
              {editable && <Button className="w-full" disabled={readOnly || create.isPending || update.isPending} onClick={save}><Save className="mr-2 size-4" />{report ? 'Save draft' : 'Create draft'}</Button>}
              {editable && report && <Button className="w-full" variant="outline" disabled={issues.length > 0 || locked} onClick={() => setSubmitOpen(true)}><Send className="mr-2 size-4" />Submit for approval</Button>}
              {editable && report && issues.length > 0 && <p className="text-xs text-destructive">Resolve {issues.length} open validation issue(s) to enable submission.</p>}
              {editable && report && <Button className="w-full" variant="outline" onClick={() => setDelOpen(true)}><Trash2 className="mr-2 size-4 text-destructive" />Delete draft</Button>}
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Who can act</p><p>Creator: save, submit and delete while draft or sent back{locked ? ' (editing is locked by field controls)' : ''}.</p><p>Reviewer: {assignedReviewer ? (assignedReviewer.name ?? assignedReviewer.fullName) : report?.approverId ? 'assigned approver' : 'chosen at submission'} approves or sends back once submitted.</p></div>
              {isApprover && <><Button className="w-full" onClick={() => setDecision('approve')}>Approve</Button><Button className="w-full" variant="outline" onClick={() => setDecision('send_back')}>Send back</Button></>}
              {report?.state === 'submitted' && !isApprover && <p className="text-xs text-muted-foreground">Review actions are disabled for you: only the assigned reviewer can act.</p>}
            </CardContent></Card>
          </aside>
        </div></> : null}

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}><DialogContent><DialogHeader><DialogTitle>Submit for approval</DialogTitle><DialogDescription>Choose the approver. After submission the report becomes read-only.</DialogDescription></DialogHeader>
        <Select value={approverId} onValueChange={setApproverId}><SelectTrigger><SelectValue placeholder="Select approver" /></SelectTrigger><SelectContent>{approvers.map(a => <SelectItem key={a.id} value={a.id}>{a.name ?? a.fullName}</SelectItem>)}</SelectContent></Select>
        {approvers.length === 0 && <p className="text-sm text-muted-foreground">No eligible approver is configured. Ask a QA/QC administrator to assign an active reviewer in this project's Reporting settings.</p>}
        {issues.length > 0 && <p className="text-xs text-destructive">{issues.length} validation issue(s) are open; the server will reject the submission if they remain.</p>}
        <DialogFooter><Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button><Button disabled={!approverId || submit.isPending || update.isPending} onClick={doSubmit}>Submit</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={delOpen} onOpenChange={setDelOpen}><DialogContent><DialogHeader><DialogTitle>Delete this draft?</DialogTitle><DialogDescription>Only drafts and sent-back reports can be deleted.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDelOpen(false)}>Cancel</Button><Button variant="destructive" onClick={doDelete}>Delete</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!decision} onOpenChange={o => !o && setDecision(undefined)}><DialogContent><DialogHeader><DialogTitle>{decision === 'approve' ? 'Approve report' : 'Send report back'}</DialogTitle><DialogDescription>Comments are required when sending back.</DialogDescription></DialogHeader><Textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Review comments" /><DialogFooter><Button variant="outline" onClick={() => setDecision(undefined)}>Cancel</Button><Button disabled={review.isPending || (decision === 'send_back' && !comments.trim())} onClick={doReview}>Confirm</Button></DialogFooter></DialogContent></Dialog>
    </PageFrame>
  </FormCtx.Provider>;
}
