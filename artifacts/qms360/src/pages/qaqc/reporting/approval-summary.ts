import type { QaqcSowReport } from '@workspace/api-client-react';

export function isReportAssignedToUser(report: Pick<QaqcSowReport, 'state' | 'approverId'>, userId?: string | null): boolean {
  return !!userId && report.state === 'submitted' && report.approverId === userId;
}

export function pendingReportApproval(report: Pick<QaqcSowReport, 'state' | 'approverId' | 'approverName' | 'approvalWorkflow'>) {
  if (report.state !== 'submitted') return { level: '—', approver: '—' };
  const workflow = report.approvalWorkflow;
  const stages = Array.isArray(workflow?.stages) ? workflow.stages as { level: number; candidates?: { id: string; name?: string }[] }[] : [];
  const stage = stages[typeof workflow?.currentIndex === 'number' ? workflow.currentIndex : -1];
  const candidate = stage?.candidates?.find(item => item.id === report.approverId);
  return {
    level: stage ? `Level ${stage.level}` : workflow ? 'Not available' : 'Single-stage (legacy)',
    approver: report.approverName?.trim() || candidate?.name?.trim() || 'Not available',
  };
}
