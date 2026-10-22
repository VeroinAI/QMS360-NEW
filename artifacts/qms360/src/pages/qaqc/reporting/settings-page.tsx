import { useState } from 'react';
import { useGetQaqcSowContext } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsAdmin } from '@/lib/field-controls';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { Link } from 'wouter';
import { METRICS, type Obj } from './reporting-types';
import { ErrorBox, Loading, PageFrame } from './shell';

const TARGETS = [...METRICS, ['pqi', 'PQI']] as [string, string][];

export function SettingsPage() {
  const cap = useQaqcCapabilities();
  const isAdmin = useIsAdmin() || cap.canTask('configure_masters');
  const canHist = cap.can('historical_balances', 'view_all');
  const histLink = canHist ? <Card><CardContent className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"><div><p className="font-medium">Historical Balances / Go-live Setup</p><p className="text-sm text-muted-foreground">Opening balances by project and month for go-live and historical corrections.</p></div><Button asChild variant="outline"><Link href="/qaqc/settings/historical-balances">Open historical balances</Link></Button></CardContent></Card> : null;
  const [projectId, setProjectId] = useState('');
  const params = { projectId: projectId || undefined };
  const ctxQ = useGetQaqcSowContext(params);
  const ctx = (ctxQ.data ?? {}) as Obj;
  const projects: Obj[] = ctx.projects ?? [];
  const targets = (ctx.targets ?? {}) as Obj;
  if (!isAdmin) return <PageFrame title="Reporting settings" description="QA/QC administrators only.">{histLink}<Card><CardContent className="p-8 text-center text-sm text-muted-foreground">You do not have access to reporting settings. Ask a QA/QC administrator for help.</CardContent></Card></PageFrame>;
  return <PageFrame title="Reporting settings" description="Closure targets in effect for each project. QA/QC administrators only.">
    {histLink}
    <Card><CardContent className="p-4"><Label htmlFor="reporting-settings-project" className="text-xs text-muted-foreground">Project</Label><Select value={projectId} onValueChange={setProjectId}><SelectTrigger id="reporting-settings-project" className="sm:w-96" data-testid="select-reporting-settings-project"><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></CardContent></Card>
    {ctxQ.error && <ErrorBox error={ctxQ.error} retry={() => ctxQ.refetch()} />}
    {projectId && (ctxQ.isLoading ? <Loading /> : !ctxQ.error && <Card data-testid="tile-closure-target-readonly">
      <CardHeader><CardTitle className="text-base">Closure Target (%)</CardTitle><CardDescription>Read-only. Closure targets are maintained in Integration cockpit, Project Master, Additional Data.</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{TARGETS.map(([k, l]) => { const v = targets[k]; return <div key={k} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="mt-1 text-lg font-semibold tabular-nums" data-testid={`text-closure-target-${k}`}>{v === null || v === undefined || v === '' ? 'Not set' : `${v}%`}</dd></div>; })}</dl></CardContent>
    </Card>)}
  </PageFrame>;
}
