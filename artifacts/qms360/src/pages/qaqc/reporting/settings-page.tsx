import { useEffect, useRef, useState } from 'react';
import { useGetQaqcSowContext, useGetQaqcSowDistributionStatus, useUpdateQaqcSowProjectSettings } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsAdmin } from '@/lib/field-controls';
import { useToast } from '@/hooks/use-toast';
import { METRICS, type Obj } from './reporting-types';
import { ErrorBox, Loading, PageFrame, errMsg, useInvalidate } from './shell';

const ROLES: [string, string][] = [['pmId', 'Project manager'], ['peId', 'Project engineer'], ['dcId', 'Document controller'], ['qualityRepresentativeId', 'Quality representative'], ['projectHeadId', 'Project head'], ['buHeadId', 'BU head'], ['corporateQualityManagerId', 'Corporate quality manager'], ['dataGovernanceManagerId', 'Data governance manager'], ['directorId', 'Director']];
const TARGETS = [...METRICS, ['pqi', 'PQI']] as [string, string][];
const DAYS: [number, string][] = Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]);
const NONE = 'none';

export function SettingsPage() {
  const isAdmin = useIsAdmin();
  const { toast } = useToast(); const invalidate = useInvalidate();
  const [projectId, setProjectId] = useState('');
  const params = { projectId: projectId || undefined };
  const ctxQ = useGetQaqcSowContext(params);
  const ctx = (ctxQ.data ?? {}) as Obj;
  const projects: Obj[] = ctx.projects ?? []; const users: Obj[] = ctx.users ?? [];
  const dist = useGetQaqcSowDistributionStatus(params);
  const save = useUpdateQaqcSowProjectSettings();
  const [s, setS] = useState<Obj>({ targets: {}, distributionMemberIds: [], dailyDistributionDays: [] });
  const loaded = useRef('');
  useEffect(() => { if (projectId && ctxQ.data && loaded.current !== projectId) { loaded.current = projectId; const cur = (ctx.settings ?? {}) as Obj; setS({ targets: { ...(ctx.targets ?? {}), ...(cur.targets ?? {}) }, distributionMemberIds: [], dailyDistributionDays: [], ...cur }); } }, [projectId, ctxQ.data, ctx]);
  const toggle = (key: string, v: string | number) => setS(x => { const a: (string | number)[] = x[key] ?? []; return { ...x, [key]: a.includes(v) ? a.filter(i => i !== v) : [...a, v] }; });
  const submit = () => {
    const body: Obj = { targets: Object.fromEntries(Object.entries(s.targets ?? {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])), distributionMemberIds: s.distributionMemberIds ?? [], dailyDistributionDays: s.dailyDistributionDays ?? [] };
    for (const [k] of ROLES) if (s[k]) body[k] = s[k];
    if (s.monthlyDistributionDay) body.monthlyDistributionDay = Number(s.monthlyDistributionDay);
    if (s.reportingStartDate) body.reportingStartDate = s.reportingStartDate;
    save.mutate({ projectId, data: body }, { onSuccess: () => { invalidate(); toast({ title: 'Project reporting settings saved' }); }, onError: e => toast({ title: 'Could not save settings', description: errMsg(e), variant: 'destructive' }) });
  };
  const bad = Object.values(s.targets ?? {}).some(v => v !== '' && v != null && (Number(v) < 0 || Number(v) > 100));
  if (!isAdmin) return <PageFrame title="Reporting settings" description="QA/QC administrators only."><Card><CardContent className="p-8 text-center text-sm text-muted-foreground">You do not have access to reporting settings. Ask a QA/QC administrator to change targets, roles or distribution.</CardContent></Card></PageFrame>;
  return <PageFrame title="Reporting settings" description="Targets, responsible people and distribution for each project. QA/QC administrators only.">
    <Card><CardContent className="p-4"><Label className="text-xs text-muted-foreground">Project</Label><Select value={projectId} onValueChange={setProjectId}><SelectTrigger className="sm:w-96"><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></CardContent></Card>
    {ctxQ.error && <ErrorBox error={ctxQ.error} retry={() => ctxQ.refetch()} />}
    {projectId && (ctxQ.isLoading ? <Loading /> : <>
      <Card><CardHeader><CardTitle className="text-base">Closure targets (%)</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{TARGETS.map(([k, l]) => <div key={k} className="space-y-1"><Label className="text-xs text-muted-foreground">{l}</Label><Input type="number" min={0} max={100} value={s.targets?.[k] ?? ''} onChange={e => setS(x => ({ ...x, targets: { ...x.targets, [k]: e.target.value } }))} /></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Responsible people</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ROLES.map(([k, l]) => <div key={k} className="space-y-1"><Label className="text-xs text-muted-foreground">{l}</Label><Select value={s[k] ?? NONE} onValueChange={v => setS(x => ({ ...x, [k]: v === NONE ? undefined : v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Not assigned</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name ?? u.fullName}</SelectItem>)}</SelectContent></Select></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Distribution</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label className="text-xs text-muted-foreground">Monthly distribution day</Label><Input type="number" min={1} max={31} value={s.monthlyDistributionDay ?? ''} onChange={e => setS(x => ({ ...x, monthlyDistributionDay: e.target.value }))} /></div><div className="space-y-1"><Label className="text-xs text-muted-foreground">Reporting start date</Label><Input type="date" value={s.reportingStartDate ?? ''} onChange={e => setS(x => ({ ...x, reportingStartDate: e.target.value }))} /></div></div>
        <div className="space-y-1"><p className="text-xs text-muted-foreground">Daily report distribution days of the month (1-31). Choose 1 and 15 for a fortnightly send; these are calendar dates, not weekdays.</p><div className="grid grid-cols-7 gap-2 sm:grid-cols-10 lg:grid-cols-16">{DAYS.map(([v, l]) => <label key={v} className="flex items-center gap-1 rounded border px-2 py-1 text-sm"><Checkbox checked={(s.dailyDistributionDays ?? []).includes(v)} onCheckedChange={() => toggle('dailyDistributionDays', v)} />{l}</label>)}</div></div>
        <div className="space-y-1"><p className="text-xs text-muted-foreground">Distribution members</p><div className="grid max-h-56 gap-2 overflow-auto rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">{users.map(u => <label key={u.id} className="flex items-center gap-2 text-sm"><Checkbox checked={(s.distributionMemberIds ?? []).includes(u.id)} onCheckedChange={() => toggle('distributionMemberIds', u.id)} />{u.name ?? u.fullName}</label>)}</div></div>
      </CardContent></Card>
      {bad && <p className="text-sm text-destructive">Targets must be between 0 and 100.</p>}
      <div><Button disabled={save.isPending || bad} onClick={submit}>Save settings</Button></div>
    </>)}
    <Card><CardHeader><CardTitle className="text-base">Scheduled distribution status</CardTitle></CardHeader><CardContent>{dist.isLoading ? <Loading /> : dist.error ? <ErrorBox error={dist.error} retry={() => dist.refetch()} /> : <DistStatus d={dist.data as Obj} />}</CardContent></Card>
  </PageFrame>;
}

function DistStatus({ d }: { d: Obj }) {
  const jobs: Obj[] = d?.scheduledJobs ?? []; const projs: Obj[] = d?.projects ?? []; const runs: Obj[] = d?.recentRuns ?? [];
  const nice = (k: string) => k.replaceAll('_', ' ');
  return <div className="space-y-5 text-sm">
    <div className="grid gap-2 sm:grid-cols-3">{jobs.map(j => <div key={j.kind} className="rounded-md border p-3"><p className="font-medium capitalize">{nice(j.kind)}</p><p className="text-xs text-muted-foreground capitalize">{j.cadence}</p><p className={j.enabled ? 'text-xs text-emerald-700' : 'text-xs text-amber-700'}>{j.enabled ? 'Enabled' : 'Waiting for configuration'}</p></div>)}</div>
    <div className="overflow-x-auto"><table className="w-full"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Project</th><th>Status</th><th>Recipients</th><th>Monthly day</th><th>Daily days</th><th>Missing</th></tr></thead><tbody>
      {projs.map(p => <tr key={p.projectId} className="border-t align-top"><td className="py-2 font-medium">{p.projectName}</td><td>{p.configured ? 'Configured' : 'Incomplete'}</td><td>{p.distributionMemberCount}</td><td>{p.monthlyDistributionDay ?? '-'}</td><td>{(p.dailyDistributionDays ?? []).join(', ') || '-'}</td><td className="text-destructive">{(p.missingConfiguration ?? []).join('; ') || '-'}</td></tr>)}
      {!projs.length && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No projects in scope.</td></tr>}
    </tbody></table></div>
    <div><p className="mb-2 font-medium">Recent delivery runs</p>{runs.length ? <table className="w-full"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Kind</th><th>Status</th><th>Project</th><th>Updated</th></tr></thead><tbody>{runs.map((r, i) => <tr key={i} className="border-t"><td className="py-1 capitalize">{nice(r.kind)}</td><td>{r.status}</td><td>{projs.find(p => p.projectId === r.projectId)?.projectName ?? r.projectId}</td><td>{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '-'}</td></tr>)}</tbody></table> : <p className="text-muted-foreground">No delivery has run yet.</p>}</div>
  </div>;
}
