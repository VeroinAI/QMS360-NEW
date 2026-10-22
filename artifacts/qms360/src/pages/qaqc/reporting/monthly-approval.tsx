import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Obj } from './reporting-types';

export function MonthlyApprovalPreview({ stages = [], errors = [], reportType = 'monthly' }: { stages?: Obj[]; errors?: string[]; reportType?: 'monthly' | 'daily' }) {
  return <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
    <p className="font-medium">Sequential {reportType} approval</p>
    <p className="text-muted-foreground">Select a reviewer at the first level. Each approver selects the next level’s reviewer. Only the last level completes approval. Sending back restarts approval after correction.</p>
    {stages.map(stage => <p key={stage.level}><strong>Level {stage.level}:</strong> {stage.candidates.map((candidate: Obj) => candidate.name).join(', ') || 'No eligible reviewer'}</p>)}
    {errors.map(error => <p key={error} role="alert" className="text-destructive">{error}</p>)}
  </div>;
}

export function MonthlyApprovalProgress({ workflow, state, approverId }: { workflow?: Obj; state?: string; approverId?: string | null }) {
  if (!workflow?.stages?.length) return null;
  const current = workflow.stages[workflow.currentIndex];
  const reviewer = current?.candidates.find((candidate: Obj) => candidate.id === approverId);
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">Approval progress</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p>{state === 'approved' ? 'All approval levels completed.' : state === 'sent_back' ? 'Sent back for correction. All levels restart on resubmission.' : `Awaiting Level ${current?.level ?? '—'} approval${reviewer ? ` — ${reviewer.name}` : ''}.`}</p>
    <ol className="space-y-1">{workflow.stages.map((stage: Obj, index: number) => <li key={stage.level}>
      Level {stage.level} — {state === 'approved' || index < workflow.currentIndex ? 'Completed' : state === 'submitted' && index === workflow.currentIndex ? 'Awaiting review' : 'Pending'}
    </li>)}</ol>
    {workflow.history?.length > 0 && <details><summary className="cursor-pointer font-medium">Approval history</summary><ol className="mt-2 space-y-2">{workflow.history.map((event: Obj, index: number) => {
      const candidate = workflow.stages.flatMap((stage: Obj) => stage.candidates).find((item: Obj) => item.id === event.userId);
      return <li key={index} className="border-t pt-2">
        Cycle {event.cycle} · Level {event.level} · {event.decision === 'submitted' ? 'Submitted' : event.decision === 'approve' ? 'Approved' : 'Sent back'}{candidate ? ` — ${candidate.name}` : ''}
        {event.comments && <p className="whitespace-pre-wrap text-muted-foreground">{event.comments}</p>}
      </li>;
    })}</ol></details>}
  </CardContent></Card>;
}
