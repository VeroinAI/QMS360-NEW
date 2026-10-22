import { formatDateTime } from '@workspace/spreadsheet-dates';
import { canMaintainMonthlyField, monthlySectionForField, monthlySectionPayload } from '@workspace/field-controls';
import { workflowConfirmationMessage } from "@/lib/workflow-confirmation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
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
import { canEditMetricsDocument } from './metrics-report-policy';
import { MonthlyApprovalPreview, MonthlyApprovalProgress } from './monthly-approval';
import { useMonthlyApproverSelection } from './monthly-approver-selection';
import { jumpToMonthlyIssue, monthlyIssuePath } from './monthly-validation-navigation';
import { useToast } from '@/hooks/use-toast';
import { useFieldControls } from '@/lib/field-controls';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { CsatForm } from './csat-form';
import { CsatDownloadButton } from './csat-download-button';
import { DailyDownloadButton } from './daily-download-button';
import { validateCsat } from './csat-validation';
import { DailyForm } from './daily-form';
import { FormCtx, ReadOnlyValue } from './form-kit';
import { AdditionalMetricsTiles } from './additional-metrics-tiles';
import { editAssessmentData, resetAssessmentReview } from './assessment-editing';
import { MonthlyForm } from './monthly-form';
import { MetricsEntryForm, Tile } from './metrics-entry-form';
import { normaliseMetricsEntry, validateMetricsEntry } from './metrics-entry-validation';
import { exportMonthlyDashboardPdf, exportMonthlyReportPdf } from './monthly-report-download';
import { calcDaily, calcMonthly, defaultData, defaultPeriod, todayIso, zeroFill, type Obj, type ReportType } from './reporting-types';
import { DataTree, ErrorBox, Loading, PageFrame, StateBadge, errMsg, saveFile, REPORT_MODULE, useBusy, useInvalidate } from './shell';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TITLES: Record<ReportType, string> = { monthly: 'Monthly quality report', daily: 'Daily document governance report', csat: 'Customer Satisfaction (CSAT)' };

function normalise(type: ReportType, d: Obj): Obj {
  let out = d;
  if (type === 'csat') out = { ...d, ratings: Object.fromEntries(Object.entries(d.ratings ?? {}).map(([k, v]) => [k, Number(v)])) };
  if (type === 'monthly') out = { ...d, manpower: (d.manpower ?? []).map((r: Obj) => (r.approvalRequired ? r : { ...r, approved: 0, rejected: 0 })) };
  return out;
}
const toBase64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

function PlainCard({ children }: { children: React.ReactNode }) {
  return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Project and period</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
function ProjectTile({ children }: { children: React.ReactNode }) { return <Tile index={1} title="Project Details"><div className="space-y-4">{children}</div></Tile>; }

export function ReportEditor({ reportType, id, metricsEntry = false }: { reportType: ReportType; id?: string; metricsEntry?: boolean }) {
  const search = useSearch();
  const displayOnly = metricsEntry && new URLSearchParams(search).get('mode') === 'view';
  const Wrap = metricsEntry || reportType === 'daily' ? ProjectTile : PlainCard;
  const base = metricsEntry ? '/qaqc/metrics/reports' : `/qaqc/${reportType}`;
  const [, nav] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const { busy, run } = useBusy();
  const me = useGetCurrentUser();
  const cap = useQaqcCapabilities(); const mod = metricsEntry ? 'monthly_reports' : REPORT_MODULE[reportType];
  const canEdit = cap.can(mod, 'create_edit'); const canSubmit = cap.can(mod, 'submit'); const canReview = cap.can(mod, 'approve_reject'); const canDelete = cap.can(mod, 'delete'); const canAi = cap.can(mod, 'ai'); const canImport = cap.can(mod, 'import'); const canExport = cap.can(mod, 'export');
  const fc = useFieldControls('qaqc', 'report-envelope');
  const locked = fc.fieldProps('data').disabled;
  const reportQ = useGetQaqcSowReport(id ?? '', { query: { enabled: !!id, queryKey: getGetQaqcSowReportQueryKey(id ?? '') } });
  const report = reportQ.data;
  const [projectId, setProjectId] = useState('');
  const [period, setPeriod] = useState(defaultPeriod(reportType));
  const pid = report?.projectId ?? projectId;
  const per = report?.period ?? period;
  const ctxParams = { projectId: pid || undefined, reportType, period: reportType === 'csat' && !report ? undefined : per || undefined };
  const ctxQ = useGetQaqcSowContext(ctxParams, { query: { queryKey: getGetQaqcSowContextQueryKey(ctxParams), enabled: !id || !!report, ...(reportType === 'monthly' ? { staleTime: 0, refetchOnMount: 'always' as const } : {}), refetchInterval: reportType === 'monthly' ? 30_000 : false, refetchOnWindowFocus: true } });
  const ctx = (ctxQ.data ?? {}) as Obj;
  useEffect(() => {
    if (reportType === 'csat' && !id && typeof ctx.serverToday === 'string') setPeriod(ctx.serverToday);
  }, [reportType, id, ctx.serverToday]);
  const editableSections: string[] | undefined = reportType === 'monthly' ? ctx.editableSections ?? [] : undefined;
  const canSection = (key: string) => !editableSections || editableSections.includes(key);
  const dirtyFields = useRef(new Set<string>());
  const editorRoot = useRef<HTMLDivElement>(null);
  const canMaintain = reportType !== 'monthly' || (report ? (editableSections?.some(s => s !== 'project') ?? false) : canSection('project'));
  // Refresh the portfolio independently so background updates do not lock the entry form.
  const portfolioParams = { reportType: 'monthly' as const, period: per || undefined };
  const portfolioQ = useGetQaqcSowContext(portfolioParams, { query: {
    queryKey: getGetQaqcSowContextQueryKey(portfolioParams),
    enabled: metricsEntry && !!per && (!id || !!report),
    staleTime: 30_000,
    refetchInterval: metricsEntry ? 60_000 : false,
  } });
  const [data, setData] = useState<Obj>(() => (metricsEntry ? { ...defaultData(reportType), meetings: [{ type: '', lastDate: '', nextDate: '' }], internalAudit: {}, manpower: [{ department: '', departmentSource: 'master' }], training: { trainingCount: 0, attendance: 0, durationMinutes: 0 }, assessmentConfirmationRequired: true, assessmentConfirmed: false } : defaultData(reportType)));
  const initFor = useRef<string | null>(null);
  useEffect(() => { if (report && initFor.current !== report.id) { initFor.current = report.id; setData({ ...defaultData(reportType), ...(report.data as Obj) }); } }, [report, reportType]);

  const create = useCreateQaqcSowReport(); const update = useUpdateQaqcSowReport(); const del = useDeleteQaqcSowReport();
  const submit = useSubmitQaqcSowReport(); const review = useReviewQaqcSowReport(); const importer = useImportQaqcSowWorkbook(); const ai = useDraftQaqcSowBrief();
  const [aiDraft, setAiDraft] = useState(() => (id ? sessionStorage.getItem(`qaqc-ai-${id}`) ?? '' : ''));
  const [aiError, setAiError] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [imports, setImports] = useState<string[]>([]);
  const [legacyApproverId, setLegacyApproverId] = useState(''); const [submitOpen, setSubmitOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [creationError, setCreationError] = useState('');
  useEffect(() => setCreationError(''), [pid, per]);
  const checkingAvailability = !report && reportType === 'monthly' && !!pid && ctxQ.isFetching;
  const [decision, setDecision] = useState<'approve' | 'send_back'>(); const [comments, setComments] = useState('');
  const [nextApproverId, setNextApproverId] = useState('');

  const editable = !displayOnly && (!report || (metricsEntry
    ? canEditMetricsDocument(report.state, canEdit)
    : report.state === 'draft' || report.state === 'sent_back'));
  const blocked = !report && ctx.canStart === false && (reportType !== 'monthly' || !!pid);
  const readOnly = !editable || !canEdit || !canMaintain || blocked || !pid || locked || busy || create.isPending || update.isPending || aiGenerating || (reportType === 'monthly' && (ctxQ.isLoading || !!ctxQ.error));
  const frozen = !!report && !editable;
  const baseline: Obj = (frozen ? report?.baseline : ctx.baseline) ?? {};
  const targets = ctx.targets as Obj | undefined;
  const clean = useMemo(() => normalise(reportType, metricsEntry ? normaliseMetricsEntry(data) : data), [data, reportType, metricsEntry]);
  const monthly = useMemo(() => calcMonthly(clean, baseline, targets), [clean, baseline, targets]);
  const daily = useMemo(() => calcDaily(clean), [clean]);
  const csatIssues = reportType === 'csat' ? validateCsat(clean) : [];
  const metricsIssues = metricsEntry ? validateMetricsEntry(clean, baseline) : [];
  const issues = metricsEntry ? [...metricsIssues, ...(clean.assessmentConfirmed !== true ? ['Review and confirm the quality assessment before submission.'] : [])] : reportType === 'monthly' ? monthly.issues : reportType === 'daily' ? daily.issues : csatIssues;
  const projects: Obj[] = ctx.projects ?? [];
  const approvers: Obj[] = ctx.approvers ?? [];
  const [monthlyApproverId, setMonthlyApproverId] = useMonthlyApproverSelection(
    approvers.map(a => a.id), `${report?.id ?? pid}:${per}:${submitOpen}`,
  );
  const approverId = reportType === 'monthly' ? monthlyApproverId : legacyApproverId;
  const setApproverId = reportType === 'monthly' ? setMonthlyApproverId : setLegacyApproverId;
  const details: Obj = ctx.projectDetails ?? {};
  const assignedReviewer = approvers.find(a => a.id === report?.approverId);
  const approvalWorkflow = report?.approvalWorkflow as Obj | undefined;
  const nextApprovalStage = report?.state === 'submitted' ? approvalWorkflow?.stages?.[approvalWorkflow.currentIndex + 1] : undefined;
  const nextCandidates: Obj[] = approvalWorkflow?.nextCandidates ?? nextApprovalStage?.candidates ?? [];
  const selectedNextApprover = nextCandidates.length === 1 ? nextCandidates[0].id : nextApproverId;
  const isApprover = report?.state === 'submitted' && !!me.data && report.approverId === me.data.id && report.submittedById !== me.data.id;
  const isCreator = !report || report.createdById === me.data?.id;
  const projectName = report?.projectName ?? projects.find(p => p.id === pid)?.name;

  const clearAiSuggestion = () => {
    setAiDraft('');
    setAiError('');
    if (id) sessionStorage.removeItem(`qaqc-ai-${id}`);
  };
  const form = { data, readOnly, editableSections, set: (p: (string | number)[], v: unknown) => {
    if (metricsEntry && readOnly) return;
    if (reportType === 'monthly' && !canMaintainMonthlyField(String(p[0]), editableSections ?? [])) return;
    dirtyFields.current.add(String(p[0]));
    if (p[0] !== 'narrative' && p[0] !== 'assessmentConfirmed') clearAiSuggestion();
    setData(d => editAssessmentData(d, p, v, metricsEntry));
  },
    fc: (key: string) => ({ disabled: locked || (reportType === 'monthly' && !canMaintainMonthlyField(key, editableSections ?? [])), required: false }), departments: (ctx.masterData?.departments ?? ctx.masterData?.qmsDepartments) as (string | { value: string; label?: string })[] | undefined,
    manpowerDisciplines: ctx.masterData?.manpowerDisciplines as { value: string; label?: string }[] | undefined };
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: 'destructive' });
  const saveData = () => {
    if (reportType !== 'monthly') return clean;
    const changedSections = new Set([...dirtyFields.current].map(monthlySectionForField).filter(Boolean));
    return monthlySectionPayload(Object.fromEntries(Object.entries(clean).filter(([key]) =>
      dirtyFields.current.has(key) || changedSections.has(monthlySectionForField(key)))), editableSections ?? []);
  };
  const updateData = () => ({ data: saveData(), expectedUpdatedAt: report?.updatedAt });
  const saved = (r: typeof report) => {
    if (!r) return;
    dirtyFields.current.clear();
    setData({ ...defaultData(reportType), ...(r.data as Obj) });
    qc.setQueryData(getGetQaqcSowReportQueryKey(r.id), r);
  };

  const save = () => {
    if (!report && reportType === 'monthly' && (blocked || checkingAvailability || !!ctxQ.error || !pid)) return;
    if (metricsEntry && readOnly) return;
    if (report) update.mutate({ id: report.id, data: updateData() }, { onSuccess: r => { saved(r); invalidate(); toast({ title: 'Draft saved' }); }, onError: fail('Could not save') });
    else {
      setCreationError('');
      create.mutate({ data: { projectId: pid, reportType, period: per, data: saveData() } }, { onSuccess: r => { dirtyFields.current.clear(); invalidate(); toast({ title: 'Draft created' }); nav(`${base}/${r.id}`); }, onError: e => {
        if (reportType === 'monthly') { setCreationError(errMsg(e)); void ctxQ.refetch(); }
        fail('Could not create')(e);
      } });
    }
  };
  const doSubmit = () => {
    if (!report) return;
    if (metricsEntry && (!editable || !canSubmit || !isCreator || locked || issues.length > 0 || busy || aiGenerating || update.isPending || submit.isPending)) return;
    const send = () => submit.mutate({ id: report.id, data: { approverId } }, { onSuccess: () => { invalidate(); toast({ title: 'Submitted for approval' }); setSubmitOpen(false); }, onError: fail('Could not submit') });
    if (reportType === 'monthly' && !dirtyFields.current.size) { send(); return; }
    update.mutate({ id: report.id, data: updateData() }, { onSuccess: r => { saved(r); send(); }, onError: fail('Could not save before submit') });
  };
  const doReview = () => { if (!report || !decision) return; review.mutate({ id: report.id, data: { decision, comments: comments || undefined, nextApproverId: decision === 'approve' && nextApprovalStage ? selectedNextApprover : undefined } }, { onSuccess: result => { invalidate(); toast({ title: result.state === 'submitted' ? 'Level approved — forwarded to next approver' : result.state === 'approved' ? 'Report approved' : 'Report sent back' }); setDecision(undefined); setComments(''); setNextApproverId(''); }, onError: fail('Review failed') }); };
  const doDelete = () => { if (report) del.mutate({ id: report.id }, { onSuccess: () => { invalidate(); toast({ title: 'Draft deleted' }); nav(metricsEntry ? '/qaqc/metrics' : `/qaqc/${reportType}`); }, onError: fail('Could not delete') }); };
  // Persist the draft first when the report is new, then call the real report id.
  const saveDraftFirst = async (): Promise<string> => {
    if (report) { const r = await update.mutateAsync({ id: report.id, data: updateData() }); saved(r); return report.id; }
    const r = await create.mutateAsync({ data: { projectId: pid, reportType, period: per, data: saveData() } });
    invalidate();
    return r.id;
  };
  const draftAi = () => run(async () => {
    if (readOnly || ai.isPending || !canAi || !canSection('assessment')) return;
    const preflight = metricsEntry ? validateMetricsEntry(clean, baseline, { requireBrief: false }) : [];
    if (preflight.length) {
      setAiError('Complete the required report fields before generating the assessment. The final assessment text can be left blank for this step.');
      toast({ title: 'Report details are incomplete', description: preflight.join(' '), variant: 'destructive' });
      return;
    }
    setAiError('');
    setAiGenerating(true);
    let rid: string | undefined;
    try {
      rid = await saveDraftFirst();
      const r = await ai.mutateAsync({ id: rid, data: { data: reportType === 'monthly' ? monthlySectionPayload(clean, editableSections ?? []) : clean } });
      setAiDraft(r.draft);
      sessionStorage.setItem(`qaqc-ai-${rid}`, r.draft);
    } catch (e) {
      setAiError(errMsg(e));
      fail('VerionAI suggestion unavailable')(e);
    } finally {
      setAiGenerating(false);
      // The draft exists even if generation fails. Reopen it instead of creating
      // a duplicate project/period draft on the next attempt.
      if (!report && rid) nav(`${base}/${rid}`, { replace: true });
    }
  });
  const useAiDraft = () => { if (canSection('assessment')) form.set(['narrative'], aiDraft); };
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file || !pid) return;
    importer.mutate({ data: { reportType, projectId: pid, period: per, workbook: toBase64(await file.arrayBuffer()) } }, {
      onSuccess: r => {
        setImports(r.errors ?? []);
        const imported = reportType === 'monthly' ? monthlySectionPayload(r.data as Obj, editableSections ?? []) : { ...defaultData(reportType), ...(r.data as Obj) };
        Object.keys(imported).forEach(key => dirtyFields.current.add(key));
        setData(d => resetAssessmentReview(reportType === 'monthly' ? { ...d, ...imported } : imported, metricsEntry));
        toast({ title: 'Workbook loaded for review', description: 'Only your authorized sections are loaded. Nothing is saved until you save the draft.' });
      }, onError: fail('Import failed'),
    });
  };

  if (id && reportQ.isLoading) return <PageFrame title={TITLES[reportType]} description="Loading report"><Loading /></PageFrame>;
  if (id && reportQ.error) return <PageFrame title={TITLES[reportType]} description="Report unavailable"><ErrorBox error={reportQ.error} retry={() => reportQ.refetch()} /></PageFrame>;

  return <FormCtx.Provider value={form}><div ref={editorRoot} className="contents">
    <PageFrame title={metricsEntry ? `QA/QC Metrics – Monthly Report${report?.referenceNumber ? ` - ${report.referenceNumber}` : ''}` : report ? `${TITLES[reportType]} ${report.referenceNumber ? `- ${report.referenceNumber}` : ''}` : reportType === 'csat' ? 'New customer satisfaction (CSAT)' : `New ${TITLES[reportType].toLowerCase()}`} description={projectName ? `${projectName} - ${per}` : 'Select a project and period to begin.'}
      actions={<><Link href={metricsEntry ? '/qaqc/metrics' : `/qaqc/${reportType}`}><Button variant="secondary"><ArrowLeft className="mr-2 size-4" />{metricsEntry ? 'Back to QA/QC Metrics' : 'All reports'}</Button></Link>
        {report && canExport && <>{reportType === 'csat' && <Button variant="secondary" disabled={busy} onClick={() => run(async () => { try { saveFile(await exportQaqcSowReport(report.id, undefined, { headers: { Accept: XLSX_MIME } }), `${reportType}-${per}.xlsx`); } catch (e) { fail('Export failed')(e); } })}><FileSpreadsheet className="mr-2 size-4" />XLSX</Button>}
          {reportType === 'csat' ? <CsatDownloadButton report={report} disabled={busy} variant="secondary" /> : reportType === 'daily' ? <><DailyDownloadButton report={report} disabled={busy} variant="secondary" label="Export Report PDF" /><DailyDownloadButton report={report} disabled={busy} variant="secondary" dashboard label="Export Dashboard PDF" /></> : <><Button variant="secondary" disabled={busy} onClick={() => run(async () => { try { saveFile(await exportMonthlyReportPdf(report.id), `${reportType}-${per}.pdf`); } catch (e) { fail('Export failed')(e); } })}><FileText className="mr-2 size-4" />Monthly Report PDF</Button><Button variant="secondary" disabled={busy} onClick={() => run(async () => { try { saveFile(await exportMonthlyDashboardPdf(report.id), `monthly-dashboard-${per}.pdf`); } catch (e) { fail('Export failed')(e); } })}><FileText className="mr-2 size-4" />Monthly Dashboard PDF</Button></>}</>}</>}>
      {report && <div className="flex flex-wrap items-center gap-3"><StateBadge state={report.state} />{report.submittedAt && <span className="text-sm text-muted-foreground">Submitted {formatDateTime(report.submittedAt)}</span>}{frozen && <span className="text-sm text-muted-foreground">Read-only after submission</span>}</div>}
      {report?.state === 'sent_back' && <Alert variant="destructive"><AlertTitle>Sent back for correction</AlertTitle><AlertDescription>{report.reviewComments}</AlertDescription></Alert>}
      <MonthlyApprovalProgress workflow={approvalWorkflow} state={report?.state} approverId={report?.approverId} />
      <Wrap>
        <div className={metricsEntry ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
          <div className="space-y-1"><Label htmlFor="metrics-project" className="text-xs text-muted-foreground">{metricsEntry ? 'Project Name' : 'Project'}{metricsEntry && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}</Label>{report ? <ReadOnlyValue label="" value={projectName} /> : <Select disabled={fc.fieldProps('projectId').disabled || busy || create.isPending} value={projectId} onValueChange={v => { clearAiSuggestion(); setData(d => resetAssessmentReview(d, metricsEntry)); setProjectId(v); }}><SelectTrigger id="metrics-project" aria-required={metricsEntry}><SelectValue placeholder={ctxQ.isLoading ? 'Loading projects' : 'Select project'} /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} - ` : ''}{p.name}</SelectItem>)}</SelectContent></Select>}</div>
          <div className="space-y-1"><Label htmlFor={metricsEntry ? 'metrics-period' : undefined} className="text-xs text-muted-foreground">{metricsEntry ? 'Month / Year' : reportType === 'monthly' ? 'Period (month)' : 'Date'}{metricsEntry && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}</Label>{report ? <ReadOnlyValue label="" value={metricsEntry ? `${per.slice(5, 7)}-${per.slice(0, 4)}` : per} /> : reportType === 'csat' ? <><Input aria-label="Date" type="date" readOnly value={typeof ctx.serverToday === 'string' ? ctx.serverToday : ''} /><p className="text-xs text-muted-foreground">System date from the server (organization time zone).</p></> : reportType !== 'monthly' ? <Input disabled={fc.fieldProps('period').disabled || busy || create.isPending} type="date" max={todayIso()} value={period} onChange={e => setPeriod(e.target.value)} /> : <Input id={metricsEntry ? 'metrics-period' : undefined} aria-required={metricsEntry} disabled={fc.fieldProps('period').disabled || busy || create.isPending} type="month" max={todayIso().slice(0, 7)} value={period.slice(0, 7)} onChange={e => { if (e.target.value) { clearAiSuggestion(); setData(d => resetAssessmentReview(d, metricsEntry)); setPeriod(`${e.target.value}-01`); } }} />}</div>
          <ReadOnlyValue label="Cost centre" value={details.costCentre} />
          {!metricsEntry && <><ReadOnlyValue label="Project manager" value={details.pmName} /><ReadOnlyValue label="Project engineer" value={details.peName} /><ReadOnlyValue label="Document controller" value={details.dcName} /></>}
        </div>
        {ctxQ.error && <ErrorBox error={ctxQ.error} retry={() => ctxQ.refetch()} />}
        {checkingAvailability && <p role="status" className="text-sm text-muted-foreground">Checking monthly report availability for this project and reporting period...</p>}
        {!report && creationError && !blocked && <Alert variant="destructive"><AlertTitle>Could not create monthly report</AlertTitle><AlertDescription>{creationError}</AlertDescription></Alert>}
        {blocked && <Alert variant="destructive"><AlertTitle>Entry is blocked</AlertTitle><AlertDescription>{ctx.blockedReason ?? 'The immediately preceding period must be submitted first.'}</AlertDescription></Alert>}
        {pid && !blocked && !report && reportType !== 'csat' && !baseline?.hasBaseline && <Alert><AlertTitle>First report for this project</AlertTitle><AlertDescription>No earlier submission exists, so the baseline starts from zero.</AlertDescription></Alert>}
        {baseline?.historicalSetup ? <p className="text-xs text-muted-foreground">Opening balances from Historical Balances / Go-live Setup for {String(baseline.historicalSetup.period)}{frozen ? ' (frozen at submission)' : ''}.</p> : baseline?.previousPeriod && <p className="text-xs text-muted-foreground">Baseline taken from the submitted report for {String(baseline.previousPeriod)}{frozen ? ' (frozen at submission)' : ''}.</p>}
      </Wrap>

      {metricsEntry || !readOnly || report ? <>
        {!metricsEntry && editable && pid && !blocked && !locked && canEdit && <div className="flex flex-wrap gap-2">
          {canImport && <><Button variant="outline" size="sm" onClick={() => run(async () => { try { saveFile(await downloadQaqcSowTemplate({ reportType }), `${reportType}-template.xlsx`); } catch (e) { fail('Template download failed')(e); } })}><Download className="mr-2 size-4" />Template</Button>
          <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"><Upload className="size-4" />{importer.isPending ? 'Validating...' : 'Import workbook'}<input type="file" accept=".xlsx" className="hidden" onChange={importFile} /></Label>
          </>}
          {reportType !== 'csat' && <Button variant="outline" size="sm" onClick={() => setData(d => {
            const cleared = zeroFill(reportType, d);
            const allowed = reportType === 'monthly' ? monthlySectionPayload(cleared, editableSections ?? []) : cleared;
            Object.keys(allowed).forEach(key => dirtyFields.current.add(key));
            return resetAssessmentReview({ ...d, ...allowed }, metricsEntry);
          })}><Eraser className="mr-2 size-4" />Zero-fill authorized sections</Button>}
        </div>}
        {imports.length > 0 && <Alert variant="destructive"><AlertTitle>Import validation messages</AlertTitle><AlertDescription><ul className="list-disc pl-5">{imports.map((m, i) => <li key={i}>{m}</li>)}</ul></AlertDescription></Alert>}
        <div className={metricsEntry ? 'grid gap-6' : 'grid gap-6 lg:grid-cols-[1fr_20rem]'}>
          <div>{metricsEntry ? <div className="space-y-6"><MetricsEntryForm calc={monthly.metrics} pqi={pid && (frozen || (!ctxQ.isLoading && !ctxQ.isError)) ? monthly.pqi : undefined}
            portfolio={(portfolioQ.data as Obj | undefined)?.portfolioPqi}
            portfolioLoading={portfolioQ.isLoading} portfolioError={portfolioQ.isError} />
            <AdditionalMetricsTiles Tile={Tile} calc={monthly} baseline={baseline} onDraftAi={draftAi} aiBusy={ai.isPending || aiGenerating || !canAi || !canSection('assessment')} aiDraft={aiDraft} aiError={aiError} onUseDraft={useAiDraft} /></div> : reportType === 'monthly' ? <MonthlyForm calc={monthly} target={targets} onDraftAi={draftAi} aiBusy={ai.isPending || aiGenerating || !canAi || !canSection('assessment')} aiDraft={aiDraft} aiError={aiError} onUseDraft={useAiDraft} />
            : reportType === 'daily' ? <DailyForm calc={daily} baseline={baseline} /> : <CsatForm projectName={projectName} />}</div>
          <aside className={metricsEntry ? 'grid items-start gap-4 md:grid-cols-2' : 'space-y-4 lg:sticky lg:top-4 lg:self-start'}>
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">Validation</CardTitle></CardHeader><CardContent className="text-sm">{issues.length ? <><p className="mb-2 text-xs text-muted-foreground">{metricsEntry ? 'Select an issue to go to its field.' : 'Resolve the issues below before submission.'}</p><ul className="list-disc space-y-1 pl-4 text-destructive">{issues.map((m, i) => { const path = metricsEntry ? monthlyIssuePath(m) : undefined; return <li key={`${i}-${m}`}>{path ? <button type="button" className="text-left underline underline-offset-2 hover:text-destructive/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => { if (editorRoot.current) jumpToMonthlyIssue(editorRoot.current, path); }}>{m}</button> : m}</li>; })}</ul></> : <p className="text-muted-foreground">No issues found in the live preview. The server validates again on submit.</p>}</CardContent></Card>
            {!metricsEntry && reportType !== 'daily' && report && Object.keys(report.computed ?? {}).length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Server calculation</CardTitle></CardHeader><CardContent className="max-h-96 overflow-auto text-sm"><DataTree value={report.computed} level={1} /></CardContent></Card>}
            <Card><CardContent className="space-y-2 p-4">
              <div className={metricsEntry ? 'flex flex-wrap gap-2' : 'space-y-3'}>
              {editable && canEdit && canMaintain && <Button className={metricsEntry ? 'flex-1 basis-44' : 'w-full'} disabled={readOnly || checkingAvailability || create.isPending || update.isPending || !pid || submit.isPending} onClick={save}><Save className="mr-2 size-4" />{report ? 'Save draft' : 'Create draft'}</Button>}
              {editable && report && canSubmit && isCreator && <Button className={metricsEntry ? 'flex-1 basis-44' : 'w-full'} variant="outline" disabled={issues.length > 0 || locked || (metricsEntry && (busy || aiGenerating || update.isPending || submit.isPending || ctxQ.isLoading || !!ctxQ.error))} onClick={() => setSubmitOpen(true)}><Send className="mr-2 size-4" />{metricsEntry ? 'Submit for Approval' : 'Submit for approval'}</Button>}
              </div>
              {metricsEntry && issues.length > 0 && <p className="text-xs text-muted-foreground">Drafts can be saved section by section. All required sections must be complete before submission.</p>}
              {editable && report && issues.length > 0 && <p className="text-xs text-destructive">Resolve {issues.length} open validation issue(s) to enable submission.</p>}
              {editable && report && canDelete && isCreator && <Button className="w-full" variant="outline" onClick={() => setDelOpen(true)}><Trash2 className="mr-2 size-4 text-destructive" />Delete draft</Button>}
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Who can act</p><p>{metricsEntry ? 'Authorized contributors can maintain their assigned sections while the document is Draft. Display mode and all other statuses are read-only on this screen.' : reportType === 'monthly' ? 'Authorized contributors: maintain assigned sections in shared drafts or sent-back reports. Other sections are read-only. Creator retains submission and deletion responsibilities.' : 'Creator: save, submit and delete while draft or sent back.'}{locked ? ' Editing is locked by field controls.' : ''}</p><p>Reviewer: {assignedReviewer ? (assignedReviewer.name ?? assignedReviewer.fullName) : report?.approverId ? 'assigned approver' : 'chosen at submission'} approves or sends back once submitted.</p></div>
              {isApprover && canReview && <><Button className="w-full" onClick={() => setDecision('approve')}>{nextApprovalStage ? 'Approve & forward' : 'Approve'}</Button><Button className="w-full" variant="outline" onClick={() => setDecision('send_back')}>Send back</Button></>}
              {report?.state === 'submitted' && !(isApprover && canReview) && <p className="text-xs text-muted-foreground">Review actions are disabled for you: only the assigned reviewer can act.</p>}
            </CardContent></Card>
          </aside>
        </div></> : null}

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}><DialogContent><DialogHeader><DialogTitle>{workflowConfirmationMessage(report?.state === 'sent_back' ? 'resubmit' : 'submit', 'this QA/QC report').title}</DialogTitle><DialogDescription>{workflowConfirmationMessage(report?.state === 'sent_back' ? 'resubmit' : 'submit', 'this QA/QC report').description} Choose the approver. After submission the report becomes read-only.</DialogDescription></DialogHeader>
        {reportType === 'monthly' && <MonthlyApprovalPreview stages={ctx.approvalStages} errors={ctx.approvalErrors} />}
        <Select value={approverId} onValueChange={setApproverId}><SelectTrigger><SelectValue placeholder={reportType === 'monthly' ? 'Select first-level approver' : 'Select approver'} /></SelectTrigger><SelectContent>{approvers.map(a => <SelectItem key={a.id} value={a.id}>{a.name ?? a.fullName}</SelectItem>)}</SelectContent></Select>
        {approvers.length === 0 && <p className="text-sm text-muted-foreground">{reportType === 'monthly' ? 'Assign a Monthly Reports approval role with an Approval Level and project or organization-wide authorization in QA/QC Settings.' : "No eligible approver is configured. Ask a QA/QC administrator to assign an active reviewer in this project's Reporting settings."}</p>}
        {issues.length > 0 && <p className="text-xs text-destructive">{issues.length} validation issue(s) are open; the server will reject the submission if they remain.</p>}
        <DialogFooter><Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button><Button disabled={!approvers.some(a => a.id === approverId) || (reportType === 'monthly' && !!ctx.approvalErrors?.length) || submit.isPending || update.isPending || (metricsEntry && (issues.length > 0 || locked || aiGenerating))} onClick={doSubmit}>{workflowConfirmationMessage(report?.state === 'sent_back' ? 'resubmit' : 'submit', 'this QA/QC report').confirmLabel}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={delOpen} onOpenChange={setDelOpen}><DialogContent><DialogHeader><DialogTitle>Delete this draft?</DialogTitle><DialogDescription>Only drafts and sent-back reports can be deleted.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDelOpen(false)}>Cancel</Button><Button variant="destructive" onClick={doDelete}>Delete</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!decision} onOpenChange={o => !o && setDecision(undefined)}><DialogContent><DialogHeader><DialogTitle>{decision === 'approve' && nextApprovalStage ? 'Approve this level and forward?' : workflowConfirmationMessage(decision === 'approve' ? 'approve' : 'send_back', 'this QA/QC report').title}</DialogTitle><DialogDescription>{decision === 'approve' && nextApprovalStage ? `The report remains Submitted and moves to Approval Level ${nextApprovalStage.level}.` : workflowConfirmationMessage(decision === 'approve' ? 'approve' : 'send_back', 'this QA/QC report').description} Comments are required when sending back.</DialogDescription></DialogHeader>
        {decision === 'approve' && nextApprovalStage && <div className="space-y-2"><Label>Next approver — Level {nextApprovalStage.level}</Label><Select value={selectedNextApprover} onValueChange={setNextApproverId}><SelectTrigger><SelectValue placeholder="Select next-level approver" /></SelectTrigger><SelectContent>{nextCandidates.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select>{nextCandidates.length === 0 && <p role="alert" className="text-sm text-destructive">No snapshotted reviewer still has approval access at this level. Ask an administrator to restore the reviewer's authorization. Levels cannot be skipped.</p>}</div>}
        <Textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Review comments" /><DialogFooter><Button variant="outline" onClick={() => setDecision(undefined)}>Cancel</Button><Button disabled={review.isPending || (decision === 'send_back' && !comments.trim()) || (decision === 'approve' && !!nextApprovalStage && !nextCandidates.some(candidate => candidate.id === selectedNextApprover))} onClick={doReview}>{decision === 'approve' && nextApprovalStage ? 'Approve & forward' : workflowConfirmationMessage(decision === 'approve' ? 'approve' : 'send_back', 'this QA/QC report').confirmLabel}</Button></DialogFooter></DialogContent></Dialog>
    </PageFrame>
  </div></FormCtx.Provider>;
}
