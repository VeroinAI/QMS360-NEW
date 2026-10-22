import { useState } from 'react';
import { Link } from 'wouter';
import {
  useGetCurrentUser, useGetQaqcSowContext, useGetQaqcSowReport, useSubmitQaqcSowReport,
  getGetQaqcSowContextQueryKey, getGetQaqcSowReportQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useFieldControls } from '@/lib/field-controls';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { workflowConfirmationMessage } from '@/lib/workflow-confirmation';
import { normaliseMetricsEntry, validateMetricsEntry } from './metrics-entry-validation';
import { canSubmitMetricsDocument, metricsDocumentHref } from './metrics-report-policy';
import { ErrorBox, Loading, errMsg, useInvalidate } from './shell';
import type { Obj } from './reporting-types';
import { MonthlyApprovalPreview } from './monthly-approval';
import { useMonthlyApproverSelection } from './monthly-approver-selection';

/** Submit the saved document through the same endpoint as the individual report. */
export function MetricsReportSubmitDialog({ id, onClose, onSubmitted }: {
  id: string; onClose: () => void; onSubmitted: () => void;
}) {
  const [error, setError] = useState('');
  const me = useGetCurrentUser();
  const cap = useQaqcCapabilities();
  const fc = useFieldControls('qaqc', 'report-envelope');
  const reportQ = useGetQaqcSowReport(id, { query: { queryKey: getGetQaqcSowReportQueryKey(id), staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000 } });
  const report = reportQ.data;
  const ctxParams = {
    reportType: 'monthly', projectId: report?.projectId, period: report?.period,
  } as const;
  const ctxQ = useGetQaqcSowContext(ctxParams, { query: { queryKey: getGetQaqcSowContextQueryKey(ctxParams), enabled: !!report && !reportQ.isFetching && !reportQ.error, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000 } });
  const ctx = (ctxQ.data ?? {}) as Obj;
  const submit = useSubmitQaqcSowReport();
  const invalidate = useInvalidate();
  const { toast } = useToast();
  const loading = reportQ.isFetching || ctxQ.isFetching || me.isLoading || cap.isLoading || fc.isLoading;
  const eligible = report?.reportType === 'monthly' && canSubmitMetricsDocument(report.state, cap.can('monthly_reports', 'submit'), report.createdById, me.data?.id);
  const locked = fc.fieldProps('data').disabled;
  const data = normaliseMetricsEntry((report?.data ?? {}) as Obj);
  const issues = report ? [
    ...validateMetricsEntry(data, ctx.baseline ?? {}),
    ...(data.assessmentConfirmed !== true ? ['Review and confirm the quality assessment before submission.'] : []),
  ] : [];
  const approvers = (ctx.approvers ?? []) as { id: string; name?: string; fullName?: string }[];
  const candidates = approvers.filter(a => a.id !== me.data?.id);
  const [approverId, setApproverId] = useMonthlyApproverSelection(candidates.map(a => a.id), id);
  const ready = !!report && eligible && !loading && !reportQ.error && !ctxQ.error && !me.error && !locked &&
    issues.length === 0 && !(ctx.approvalErrors?.length) && candidates.some(a => a.id === approverId) && !submit.isPending;
  const message = workflowConfirmationMessage('submit', 'this QA/QC report');
  const send = () => {
    if (!ready) return;
    setError('');
    submit.mutate({ id, data: { approverId } }, {
      onSuccess: () => {
        invalidate();
        toast({ title: 'Submitted for approval' });
        onSubmitted();
      },
      onError: e => setError(errMsg(e)),
    });
  };

  return <Dialog open onOpenChange={open => { if (!open && !submit.isPending) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{message.title}</DialogTitle>
        <DialogDescription>{message.description} Choose the first-level approver. After submission the report becomes read-only. This submits the saved report.</DialogDescription>
      </DialogHeader>
      {loading ? <Loading /> : reportQ.error || ctxQ.error || me.error ?
        <ErrorBox error={reportQ.error ?? ctxQ.error ?? me.error} retry={() => { void reportQ.refetch(); void ctxQ.refetch(); }} /> :
        <>
          <p className="text-sm font-medium">{report?.projectName ?? report?.projectId} · {report?.period?.slice(0, 7)}</p>
          {!eligible && <p role="alert" className="text-sm text-destructive">Only your draft monthly reports can be submitted with Monthly Reports submit permission.</p>}
          {locked && <p role="alert" className="text-sm text-destructive">This report is locked by field controls.</p>}
          {issues.length > 0 && <div role="alert" className="space-y-2 text-sm">
            <p className="font-medium text-destructive">Resolve these issues in the report before submitting:</p>
            <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
          </div>}
          <Link href={metricsDocumentHref(id, report?.state ?? '', cap.can('monthly_reports', 'create_edit'))} aria-disabled={submit.isPending} onClick={e => { if (submit.isPending) e.preventDefault(); else onClose(); }} className="text-sm text-primary underline">Open monthly report</Link>
          <Label htmlFor="monthly-row-approver">Approver</Label>
          <MonthlyApprovalPreview stages={ctx.approvalStages} errors={ctx.approvalErrors} />
          <Select value={approverId} onValueChange={v => { setApproverId(v); setError(''); }} disabled={submit.isPending || !eligible}>
            <SelectTrigger id="monthly-row-approver"><SelectValue placeholder="Select approver" /></SelectTrigger>
            <SelectContent>{candidates.map(a => <SelectItem key={a.id} value={a.id}>{a.name ?? a.fullName ?? a.id}</SelectItem>)}</SelectContent>
          </Select>
          {candidates.length === 0 && <p className="text-sm text-muted-foreground">Ask a QA/QC administrator to assign a role with Monthly Reports approval permission, an Approval Level, and authorization for this project or the organization.</p>}
        </>}
      {error && <p role="alert" className="text-sm text-destructive">Could not submit: {error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={submit.isPending} onClick={onClose}>Cancel</Button>
        <Button disabled={!ready} onClick={send}>{submit.isPending ? 'Submitting...' : message.confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
