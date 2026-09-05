import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { getGetConnectorFieldMappingsQueryKey, useGetConnectorFieldMappings, useGetIntegrationsHealth, useListIntegrationConnectors, useListSyncJobs, useRetrySyncJob, useSaveConnectorFieldMappings, useSendConnectorTestEmail, useUpdateIntegrationConnector } from '@workspace/api-client-react';
import type { IntegrationConnector } from '@workspace/api-client-react';
import { Activity, ArrowLeft, Bot, CloudCog, Database, FileSpreadsheet, Mail, Plus, RefreshCw, Save, ServerCog, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

const MAPPABLE_FAMILIES = new Set(['platform', 'oracle_adw', 'bi']);

function FieldMappingCard({ connectors, onSaved }: { connectors: IntegrationConnector[]; onSaved: (title: string) => void }) {
  const { toast } = useToast();
  const mappable = connectors.filter((c) => MAPPABLE_FAMILIES.has(c.family));
  const [connectorId, setConnectorId] = useState('');
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<Array<{ sourceField: string; targetField: string }>>([]);
  const [active, setActive] = useState(false);
  const workspace = useGetConnectorFieldMappings(connectorId, { query: { enabled: !!connectorId, queryKey: getGetConnectorFieldMappingsQueryKey(connectorId) } });
  const saveMappings = useSaveConnectorFieldMappings();
  const catalog = workspace.data?.entities ?? [];
  const selectedEntity = catalog.find((entry) => entry.entity === entity) ?? catalog[0];
  const entityKey = selectedEntity?.entity ?? '';

  // Hydrate the editor only when the connector/entity selection changes, so a
  // background refetch never discards unsaved edits.
  const viewKey = `${connectorId}:${entityKey}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    if (!workspace.data || viewKey === loadedKey) return;
    const saved = workspace.data.mappings.filter((m) => m.entity === entityKey);
    setRows(saved.map((m) => ({ sourceField: m.sourceField, targetField: m.targetField })));
    setActive(saved.length > 0 && saved.every((m) => m.active));
    setLoadedKey(viewKey);
  }, [workspace.data, viewKey, loadedKey, entityKey]);

  const missingRequired = (selectedEntity?.targetFields ?? []).filter((f) => f.required && !rows.some((r) => r.targetField === f.key));
  const save = () => {
    if (!connectorId || !selectedEntity) return;
    const mappings = rows.filter((r) => r.sourceField.trim() && r.targetField);
    saveMappings.mutate({ id: connectorId, data: { entity: selectedEntity.entity, active, mappings } }, {
      onSuccess: () => onSaved('Field mappings saved'),
      onError: (error) => toast({ title: 'Could not save mappings', description: message(error), variant: 'destructive' }),
    });
  };

  return <Card><CardHeader><CardTitle>Field mapping</CardTitle><CardDescription>Map source connector fields to QMS360 fields. Mappings are validated before activation; sync jobs use the active version.</CardDescription></CardHeader><CardContent className="space-y-4">
    {mappable.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No sync-capable connectors are configured yet.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Source connector</Label>
          <Select value={connectorId} onValueChange={setConnectorId}><SelectTrigger><SelectValue placeholder="Select a connector" /></SelectTrigger><SelectContent>{mappable.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        </div>
        {connectorId && catalog.length > 0 && <div><Label>Entity</Label>
          <Select value={entityKey} onValueChange={setEntity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{catalog.map((e) => <SelectItem key={e.entity} value={e.entity}>{e.label}</SelectItem>)}</SelectContent></Select>
        </div>}
      </div>
      {connectorId && workspace.isLoading && <p className="text-sm text-muted-foreground">Loading mapping workspace…</p>}
      {connectorId && workspace.error && <p className="text-sm text-destructive">{message(workspace.error)}</p>}
      {connectorId && selectedEntity && !workspace.isLoading && !workspace.error && <>
        <datalist id="source-field-suggestions">{selectedEntity.sourceSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
        <Table><TableHeader><TableRow><TableHead>Source field</TableHead><TableHead className="w-10" /><TableHead>QMS360 field</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>
          {rows.map((row, index) => <TableRow key={index}>
            <TableCell><Input list="source-field-suggestions" placeholder="e.g. project_code" value={row.sourceField} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, sourceField: e.target.value } : r))} /></TableCell>
            <TableCell className="text-center text-muted-foreground">→</TableCell>
            <TableCell><Select value={row.targetField} onValueChange={(value) => setRows(rows.map((r, i) => i === index ? { ...r, targetField: value } : r))}><SelectTrigger><SelectValue placeholder="Choose target" /></SelectTrigger><SelectContent>{selectedEntity.targetFields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>)}</SelectContent></Select></TableCell>
            <TableCell><Button variant="ghost" size="icon" aria-label="Remove mapping" onClick={() => setRows(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></TableCell>
          </TableRow>)}
          {rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No mappings yet for {selectedEntity.label}.</TableCell></TableRow>}
        </TableBody></Table>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => setRows([...rows, { sourceField: '', targetField: '' }])}><Plus className="mr-2 h-4 w-4" />Add mapping</Button>
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} />Active — sync jobs use these mappings</label>
        </div>
        {active && missingRequired.length > 0 && <p className="text-sm text-destructive">Required before activation: {missingRequired.map((f) => f.label).join(', ')}</p>}
        <div className="flex justify-end"><Button onClick={save} disabled={saveMappings.isPending || (active && missingRequired.length > 0)}><Save className="mr-2 h-4 w-4" />Save mappings</Button></div>
        <p className="text-xs text-muted-foreground">* Required QMS360 fields must be mapped before the mapping set can be activated. Saving replaces the {selectedEntity.label} mapping set for this connector and bumps its mapping version.</p>
      </>}
    </>}
  </CardContent></Card>;
}

export function CockpitPage() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<IntegrationConnector>();
  const [password, setPassword] = useState('');
  const connectors = useListIntegrationConnectors({ page: 1, limit: 20 });
  const health = useGetIntegrationsHealth();
  const jobs = useListSyncJobs({ page, limit: 10 });
  const update = useUpdateIntegrationConnector();
  const retry = useRetrySyncJob();
  const testEmail = useSendConnectorTestEmail();
  const client = useQueryClient();
  const { toast } = useToast();
  const refresh = (title: string) => { client.invalidateQueries(); toast({ title }); };
  const fail = (error: unknown) => toast({ title: 'Integration action failed', description: message(error), variant: 'destructive' });
  const isEmail = editing?.family === 'email';
  const smtpKeys = new Set(['host', 'port', 'secure', 'username', 'user', 'password', 'pass', 'fromAddress', 'from', 'fromName']);
  const configEntries = editing
    ? Object.entries(editing.config ?? {}).filter(([key]) => !/(secret|password|token|key)/i.test(key) && key !== 'status' && (!isEmail || !smtpKeys.has(key)))
    : [];
  const setSmtp = (key: string, value: unknown) => editing && setEditing({ ...editing, config: { ...editing.config, [key]: value } });
  const smtpValue = (key: string) => String(editing?.config?.[key] ?? '');
  const save = () => {
    if (!editing) return;
    // Only send the password when the admin typed a replacement — the backend
    // encrypts it at rest and keeps the stored secret when the field is blank.
    const config = { ...(editing.config ?? {}) };
    if (isEmail && password) config.password = password;
    update.mutate({ id: editing.id, data: { ...editing, config } }, { onSuccess: () => { refresh('Connector updated'); setEditing(undefined); setPassword(''); }, onError: fail });
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
            const Icon = icons[connector.family]; return <Card key={connector.id} className="overflow-hidden"><CardHeader><div className="mb-3 flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Icon className="h-5 w-5" /></span><Status value={connector.status} /></div><CardTitle>{connector.name}</CardTitle><CardDescription>{labels[connector.family]}</CardDescription></CardHeader><CardContent><div className="mb-4 flex justify-between text-sm"><span className="text-muted-foreground">Last successful sync</span><span>{connector.lastSuccessfulSyncAt ? new Date(connector.lastSuccessfulSyncAt).toLocaleString() : 'Never'}</span></div>            <div className="space-y-2">{connector.family === 'email' && <Button variant="secondary" className="w-full" disabled={testEmail.isPending} onClick={() => testEmail.mutate({ id: connector.id }, { onSuccess: (r) => refresh(r.message || 'Test email sent'), onError: fail })}><Mail className="mr-2 h-4 w-4" />Send test email</Button>}<Button variant="outline" className="w-full" onClick={() => { setPassword(''); setEditing(connector); }}>Configure</Button></div></CardContent></Card>;
          })}</div> : <Card><CardContent className="py-12 text-center"><p className="font-semibold">No connectors configured</p><p className="text-sm text-muted-foreground">Connectors will appear after platform provisioning.</p></CardContent></Card>}</section>
        <Card><CardHeader><CardTitle>Sync jobs</CardTitle><CardDescription>Recent connector runs and retry controls.</CardDescription></CardHeader><CardContent>{jobs.data?.items.length ? <><Table><TableHeader><TableRow><TableHead>Connector</TableHead><TableHead>Started</TableHead><TableHead>Duration</TableHead><TableHead>Records</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{jobs.data.items.map(job => <TableRow key={job.id}><TableCell>{job.connectorId}</TableCell><TableCell>{new Date(job.startedAt).toLocaleString()}</TableCell><TableCell>{job.durationMs != null ? `${Math.round(job.durationMs / 1000)}s` : '—'}</TableCell><TableCell>{job.sourceCount ?? 0} → {job.targetCount ?? 0}</TableCell><TableCell><Status value={job.status} />{job.error && <p className="mt-1 max-w-xs text-xs text-destructive">{job.error}</p>}</TableCell><TableCell>{job.status === 'failed' && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: job.id }, { onSuccess: (job2) => refresh(job2.status === 'succeeded' ? 'Email resent successfully' : 'Retry attempted — delivery still failing'), onError: fail })}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>}</TableCell></TableRow>)}</TableBody></Table><div className="mt-4 flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil((jobs.data.total ?? 0) / 10))}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * 10 >= (jobs.data.total ?? 0)} onClick={() => setPage(v => v + 1)}>Next</Button></div></div></> : <p className="py-10 text-center text-sm text-muted-foreground">No sync jobs have run yet.</p>}</CardContent></Card>
        <FieldMappingCard connectors={connectors.data?.items ?? []} onSaved={refresh} />
      </>}
    </div>
    <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(undefined); setPassword(''); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Configure {editing?.name}</DialogTitle><DialogDescription>{isEmail ? 'SMTP settings for outbound escalation and workflow email. The password is write-only: enter a new one to replace it, or leave blank to keep the stored secret.' : 'Secret values are masked and cannot be viewed here. Replace them through the secure credential flow.'}</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><label className="flex items-center justify-between rounded-lg border p-4"><span><b>Connector enabled</b><span className="block text-sm text-muted-foreground">Allow scheduled and manual sync.</span></span><Switch checked={editing.enabled} onCheckedChange={enabled => setEditing({ ...editing, enabled })} /></label>{isEmail && <><div className="grid gap-3 sm:grid-cols-[2fr_1fr]"><div><Label>SMTP host</Label><Input placeholder="smtp.example.com" value={smtpValue('host')} onChange={e => setSmtp('host', e.target.value)} /></div><div><Label>Port</Label><Input inputMode="numeric" placeholder="587" value={smtpValue('port')} onChange={e => setSmtp('port', e.target.value.replace(/[^0-9]/g, ''))} /></div></div><div><Label>Security</Label><select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm" value={editing.config?.secure === true || editing.config?.secure === 'true' ? 'tls' : 'starttls'} onChange={e => setSmtp('secure', e.target.value === 'tls')}><option value="starttls">STARTTLS (upgrade after connect)</option><option value="tls">Implicit TLS from connect (port 465)</option></select></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>Username</Label><Input autoComplete="off" value={smtpValue('username')} onChange={e => setSmtp('username', e.target.value)} /></div><div><Label>Password</Label><Input type="password" autoComplete="new-password" placeholder="Leave blank to keep current" value={password} onChange={e => setPassword(e.target.value)} /></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>From address</Label><Input placeholder="qms360@example.com" value={smtpValue('fromAddress')} onChange={e => setSmtp('fromAddress', e.target.value)} /></div><div><Label>From name</Label><Input placeholder="QMS360" value={smtpValue('fromName')} onChange={e => setSmtp('fromName', e.target.value)} /></div></div><p className="text-xs text-muted-foreground">Credentials are encrypted at rest and never displayed after saving. Hosts resolving to private network addresses are rejected unless the platform allows an internal relay.</p></>}{configEntries.map(([key, value]) => <div key={key}><Label>{key.replaceAll('_', ' ')}</Label><Input value={typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)} onChange={e => setEditing({ ...editing, config: { ...editing.config, [key]: e.target.value } })} /></div>)}{!isEmail && <div><Label>Credential</Label><Input type="password" value="••••••••••••" disabled /><p className="mt-1 text-xs text-muted-foreground">Stored secret is masked and never displayed.</p></div>}</div>}<DialogFooter><Button variant="outline" onClick={() => { setEditing(undefined); setPassword(''); }}>Cancel</Button><Button onClick={save} disabled={update.isPending}><Save className="mr-2 h-4 w-4" />Save connector</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}