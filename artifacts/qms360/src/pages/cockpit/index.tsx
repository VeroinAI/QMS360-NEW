import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useGetIntegrationsHealth, useListIntegrationConnectors, useListSyncJobs, useRetrySyncJob, useUpdateIntegrationConnector } from '@workspace/api-client-react';
import type { IntegrationConnector } from '@workspace/api-client-react';
import { Activity, ArrowLeft, Bot, CloudCog, Database, FileSpreadsheet, Mail, RefreshCw, Save, ServerCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const icons = { platform: CloudCog, email: Mail, ai: Bot, oracle_adw: Database, bi: FileSpreadsheet };
const labels = { platform: 'Platform sync', email: 'Email SMTP', ai: 'AI provider', oracle_adw: 'Oracle ADW', bi: 'BI / Excel export' };

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The integration service did not complete the request.';
}

function Status({ value }: { value: string }) {
  const variant = value === 'Connected' || value === 'healthy' || value === 'succeeded' ? 'default' : value === 'Disabled' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{value}</Badge>;
}

export function CockpitPage() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<IntegrationConnector>();
  const connectors = useListIntegrationConnectors({ page: 1, limit: 20 });
  const health = useGetIntegrationsHealth();
  const jobs = useListSyncJobs({ page, limit: 10 });
  const update = useUpdateIntegrationConnector();
  const retry = useRetrySyncJob();
  const client = useQueryClient();
  const { toast } = useToast();
  const refresh = (title: string) => { client.invalidateQueries(); toast({ title }); };
  const fail = (error: unknown) => toast({ title: 'Integration action failed', description: message(error), variant: 'destructive' });
  const configEntries = editing ? Object.entries(editing.config ?? {}).filter(([key]) => !/(secret|password|token|key)/i.test(key)) : [];
  const save = () => {
    if (!editing) return;
    update.mutate({ id: editing.id, data: editing }, { onSuccess: () => { refresh('Connector updated'); setEditing(undefined); }, onError: fail });
  };
  const loading = connectors.isLoading || health.isLoading || jobs.isLoading;
  const error = connectors.error || health.error || jobs.error;

  return <main className="min-h-screen bg-background">
    <header className="bg-primary px-5 py-8 text-primary-foreground md:px-10"><div className="mx-auto max-w-7xl">
      <Link href="/" className="mb-5 inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"><ArrowLeft className="h-4 w-4" />System overview</Link>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest opacity-70">Shared services</p><h1 className="mt-2 font-display text-3xl font-bold">Integration Cockpit</h1><p className="mt-2 max-w-2xl opacity-80">Monitor platform, messaging, AI, warehouse and export connections from one control point.</p></div>{health.data && <div className="rounded-xl bg-card px-5 py-3 text-card-foreground"><p className="text-xs text-muted-foreground">Overall health</p><div className="mt-1 flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /><Status value={health.data.status} /></div></div>}</div>
    </div></header>
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-7 md:px-10">
      {loading && <Card><CardContent className="space-y-3 py-12"><div className="h-6 w-1/3 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Checking connector health…</p></CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="flex items-center gap-4 py-8"><ServerCog className="text-destructive" /><div className="flex-1"><p className="font-semibold">Cockpit data unavailable</p><p className="text-sm text-muted-foreground">{message(error)}</p></div><Button variant="outline" onClick={() => { connectors.refetch(); health.refetch(); jobs.refetch(); }}>Retry</Button></CardContent></Card>}
      {!loading && !error && <>
        <section><div className="mb-3"><h2 className="font-display text-xl font-semibold">Connectors</h2><p className="text-sm text-muted-foreground">Secrets are securely stored and never returned or displayed.</p></div>
          {connectors.data?.items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{connectors.data.items.map(connector => {
            const Icon = icons[connector.family]; return <Card key={connector.id} className="overflow-hidden"><CardHeader><div className="mb-3 flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Icon className="h-5 w-5" /></span><Status value={connector.status} /></div><CardTitle>{connector.name}</CardTitle><CardDescription>{labels[connector.family]}</CardDescription></CardHeader><CardContent><div className="mb-4 flex justify-between text-sm"><span className="text-muted-foreground">Last successful sync</span><span>{connector.lastSuccessfulSyncAt ? new Date(connector.lastSuccessfulSyncAt).toLocaleString() : 'Never'}</span></div><Button variant="outline" className="w-full" onClick={() => setEditing(connector)}>Configure</Button></CardContent></Card>;
          })}</div> : <Card><CardContent className="py-12 text-center"><p className="font-semibold">No connectors configured</p><p className="text-sm text-muted-foreground">Connectors will appear after platform provisioning.</p></CardContent></Card>}</section>
        <Card><CardHeader><CardTitle>Sync jobs</CardTitle><CardDescription>Recent connector runs and retry controls.</CardDescription></CardHeader><CardContent>{jobs.data?.items.length ? <><Table><TableHeader><TableRow><TableHead>Connector</TableHead><TableHead>Started</TableHead><TableHead>Duration</TableHead><TableHead>Records</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{jobs.data.items.map(job => <TableRow key={job.id}><TableCell>{job.connectorId}</TableCell><TableCell>{new Date(job.startedAt).toLocaleString()}</TableCell><TableCell>{job.durationMs != null ? `${Math.round(job.durationMs / 1000)}s` : '—'}</TableCell><TableCell>{job.sourceCount ?? 0} → {job.targetCount ?? 0}</TableCell><TableCell><Status value={job.status} />{job.error && <p className="mt-1 max-w-xs text-xs text-destructive">{job.error}</p>}</TableCell><TableCell>{job.status === 'failed' && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: job.id }, { onSuccess: () => refresh('Retry queued'), onError: fail })}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>}</TableCell></TableRow>)}</TableBody></Table><div className="mt-4 flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil((jobs.data.total ?? 0) / 10))}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * 10 >= (jobs.data.total ?? 0)} onClick={() => setPage(v => v + 1)}>Next</Button></div></div></> : <p className="py-10 text-center text-sm text-muted-foreground">No sync jobs have run yet.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Field mapping</CardTitle><CardDescription>Mapping previews become available when a source connector is selected.</CardDescription></CardHeader><CardContent><div className="grid gap-3 rounded-xl border border-dashed p-6 md:grid-cols-[1fr_auto_1fr] md:items-center"><div className="rounded-lg bg-muted p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Source fields</p><p className="mt-2 text-sm">Select a connector to inspect its schema</p></div><span className="text-center text-muted-foreground">→</span><div className="rounded-lg bg-muted p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">QMS360 fields</p><p className="mt-2 text-sm">Mappings will be validated before activation</p></div></div></CardContent></Card>
      </>}
    </div>
    <Dialog open={!!editing} onOpenChange={open => !open && setEditing(undefined)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Configure {editing?.name}</DialogTitle><DialogDescription>Secret values are masked and cannot be viewed here. Replace them through the secure credential flow.</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><label className="flex items-center justify-between rounded-lg border p-4"><span><b>Connector enabled</b><span className="block text-sm text-muted-foreground">Allow scheduled and manual sync.</span></span><Switch checked={editing.enabled} onCheckedChange={enabled => setEditing({ ...editing, enabled })} /></label>{configEntries.map(([key, value]) => <div key={key}><Label>{key.replaceAll('_', ' ')}</Label><Input value={typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)} onChange={e => setEditing({ ...editing, config: { ...editing.config, [key]: e.target.value } })} /></div>)}<div><Label>Credential</Label><Input type="password" value="••••••••••••" disabled /><p className="mt-1 text-xs text-muted-foreground">Stored secret is masked and never displayed.</p></div></div>}<DialogFooter><Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button><Button onClick={save} disabled={update.isPending}><Save className="mr-2 h-4 w-4" />Save connector</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}