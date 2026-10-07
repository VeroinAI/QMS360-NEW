import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetConnectorFieldMappingsQueryKey, useCreateImportTemplate, useCreateIntegrationConnector,
  useDeleteImportTemplate, useDeleteIntegrationConnector,
  useGetConnectorFieldMappings, useGetIntegrationsHealth, useListImportTemplates,
  useListIntegrationConnectors, useListSyncJobs, usePullConnectorData, useRetrySyncJob,
  useSaveConnectorFieldMappings, useSendConnectorTestEmail, useTestConnectorConnection,
  useUpdateImportTemplate, useUpdateIntegrationConnector, useGetCurrentUser,
} from '@workspace/api-client-react';
import type { ImportTemplate, ImportTemplateColumn, IntegrationConnector, PullResult } from '@workspace/api-client-react';
import { Activity, ArrowLeft, Bot, CloudCog, Copy, Database, Download, FileSpreadsheet, FileUp, Mail, PlugZap, Plus, RefreshCw, Save, ServerCog, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

import { EmailRulesTab } from './email-rules-tab';
import { EmailQueueTab } from './email-queue-tab';
import { ProjectMasterTab } from './project-master-tab';

const icons = { platform: CloudCog, email: Mail, ai: Bot, oracle_adw: Database, bi: FileSpreadsheet, source_api: PlugZap } as Record<string, typeof CloudCog>;
const labels = { platform: 'Platform sync', email: 'Email SMTP', ai: 'AI provider', oracle_adw: 'Oracle ADW', bi: 'BI / Excel export', source_api: 'Source system API' } as Record<string, string>;

const ENTITY_LABELS: Record<string, string> = { projects: 'Project details', users: 'User details' };
// Field options shown in template/mapping editors; custom.* values are stored
// in the entity's custom fields (that is how new template columns become data fields).
const TARGET_FIELDS: Record<string, Array<{ key: string; label: string; required: boolean }>> = {
  projects: [
    { key: 'code', label: 'Project code', required: true },
    { key: 'name', label: 'Project name', required: true },
    { key: 'location', label: 'Location', required: false },
    { key: 'status', label: 'Status (active/inactive)', required: false },
    { key: 'externalId', label: 'External reference', required: false },
  ],
  users: [
    { key: 'email', label: 'Email', required: true },
    { key: 'fullName', label: 'Full name', required: true },
    { key: 'username', label: 'Username', required: false },
    { key: 'projectCode', label: 'Project code (links user to project)', required: false },
  ],
};
const DEFAULT_MAPPINGS: Record<string, Array<{ sourceField: string; targetField: string }>> = {
  projects: [
    { sourceField: 'project_code', targetField: 'code' },
    { sourceField: 'project_name', targetField: 'name' },
    { sourceField: 'location', targetField: 'location' },
    { sourceField: 'status', targetField: 'status' },
    { sourceField: 'external_id', targetField: 'externalId' },
  ],
  users: [
    { sourceField: 'email', targetField: 'email' },
    { sourceField: 'full_name', targetField: 'fullName' },
    { sourceField: 'username', targetField: 'username' },
    { sourceField: 'project_code', targetField: 'projectCode' },
  ],
};

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The integration service did not complete the request.';
}

function Status({ value }: { value: string }) {
  const variant = value === 'Connected' || value === 'healthy' || value === 'succeeded' ? 'default' : value === 'Disabled' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{value}</Badge>;
}

const MAPPABLE_FAMILIES = new Set(['platform', 'oracle_adw', 'bi', 'source_api']);

// ---------------------------------------------------------------------------
// Add-connection wizard: source system → connection → endpoints → mapping.

type WizardDraft = {
  name: string; systemType: string; enabled: boolean;
  baseUrl: string; authType: string; token: string; apiKey: string; apiKeyHeader: string; username: string; password: string;
  projectsPath: string; projectsRoot: string; usersPath: string; usersRoot: string;
  mappings: Record<string, Array<{ sourceField: string; targetField: string }>>;
};
const blankWizard = (): WizardDraft => ({
  name: '', systemType: 'erp', enabled: true,
  baseUrl: '', authType: 'none', token: '', apiKey: '', apiKeyHeader: 'x-api-key', username: '', password: '',
  projectsPath: '', projectsRoot: '', usersPath: '', usersRoot: '',
  mappings: { projects: DEFAULT_MAPPINGS.projects.map((m) => ({ ...m })), users: DEFAULT_MAPPINGS.users.map((m) => ({ ...m })) },
});

function AddConnectionWizard({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (title: string) => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(blankWizard());
  const create = useCreateIntegrationConnector();
  const saveMappings = useSaveConnectorFieldMappings();
  const set = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const close = () => { setStep(0); setDraft(blankWizard()); onClose(); };
  const stepValid = [
    draft.name.trim().length > 0,
    /^https?:\/\/.+/.test(draft.baseUrl.trim()),
    draft.projectsPath.trim() !== '' || draft.usersPath.trim() !== '',
    true,
  ][step];
  const finish = async () => {
    try {
      const connector = await create.mutateAsync({
        data: {
          name: draft.name.trim(), family: 'source_api', enabled: draft.enabled,
          config: {
            baseUrl: draft.baseUrl.trim(), authType: draft.authType,
            ...(draft.authType === 'bearer' ? { token: draft.token } : {}),
            ...(draft.authType === 'api_key' ? { apiKey: draft.apiKey, apiKeyHeader: draft.apiKeyHeader || 'x-api-key' } : {}),
            ...(draft.authType === 'basic' ? { username: draft.username, password: draft.password } : {}),
            direction: 'pull',
            endpoints: {
              ...(draft.projectsPath.trim() ? { projects: { path: draft.projectsPath.trim(), rootPath: draft.projectsRoot.trim() } } : {}),
              ...(draft.usersPath.trim() ? { users: { path: draft.usersPath.trim(), rootPath: draft.usersRoot.trim() } } : {}),
            },
          },
        },
      });
      for (const entity of ['projects', 'users'] as const) {
        const path = entity === 'projects' ? draft.projectsPath : draft.usersPath;
        const mappings = draft.mappings[entity].filter((m) => m.sourceField.trim() && m.targetField);
        if (path.trim() && mappings.length) {
          await saveMappings.mutateAsync({ id: connector.id, data: { entity, active: true, mappings } });
        }
      }
      onSaved('Connection created — use Pull now on the card to sync data');
      close();
    } catch (error) {
      toast({ title: 'Could not create connection', description: message(error), variant: 'destructive' });
    }
  };
  const busy = create.isPending || saveMappings.isPending;
  const stepTitles = ['Source system', 'Connection', 'Data endpoints', 'Field mapping'];
  return <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Add source connection</DialogTitle><DialogDescription>Step {step + 1} of 4 — {stepTitles[step]}. Pulls project and user details from an ERP or custom application API. Outbound push can be added later; the configuration is ready for it.</DialogDescription></DialogHeader>
    <div className="min-h-[260px]">
      {step === 0 && <div className="space-y-4">
        <div><Label>Connection name</Label><Input placeholder="e.g. Algihaz ERP" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div><Label>Source system type</Label><Select value={draft.systemType} onValueChange={(v) => set({ systemType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="erp">ERP system (SAP, Oracle, …)</SelectItem>
          <SelectItem value="custom">Custom application API</SelectItem>
          <SelectItem value="other">Other REST source</SelectItem>
        </SelectContent></Select></div>
        <label className="flex items-center justify-between rounded-lg border p-4"><span><b>Enabled</b><span className="block text-sm text-muted-foreground">Allow pulls from this source.</span></span><Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} /></label>
      </div>}
      {step === 1 && <div className="space-y-4">
        <div><Label>Base URL</Label><Input placeholder="https://erp.algihaz.com" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Internal (private-network) hosts must be allowlisted by the platform team before pulls work.</p></div>
        <div><Label>Authentication</Label><Select value={draft.authType} onValueChange={(v) => set({ authType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="none">None</SelectItem><SelectItem value="bearer">Bearer token</SelectItem><SelectItem value="api_key">API key header</SelectItem><SelectItem value="basic">Basic (username + password)</SelectItem>
        </SelectContent></Select></div>
        {draft.authType === 'bearer' && <div><Label>Bearer token</Label><Input type="password" autoComplete="new-password" value={draft.token} onChange={(e) => set({ token: e.target.value })} /></div>}
        {draft.authType === 'api_key' && <div className="grid gap-3 sm:grid-cols-2"><div><Label>API key</Label><Input type="password" autoComplete="new-password" value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} /></div><div><Label>Header name</Label><Input placeholder="x-api-key" value={draft.apiKeyHeader} onChange={(e) => set({ apiKeyHeader: e.target.value })} /></div></div>}
        {draft.authType === 'basic' && <div className="grid gap-3 sm:grid-cols-2"><div><Label>Username</Label><Input autoComplete="off" value={draft.username} onChange={(e) => set({ username: e.target.value })} /></div><div><Label>Password</Label><Input type="password" autoComplete="new-password" value={draft.password} onChange={(e) => set({ password: e.target.value })} /></div></div>}
        <p className="text-xs text-muted-foreground">Credentials are encrypted at rest and never displayed after saving.</p>
      </div>}
      {step === 2 && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Relative paths against the base URL. Root path is the JSON key holding the record array (e.g. <code>data.items</code>) — leave blank when the response is already an array.</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]"><div><Label>Projects endpoint path</Label><Input placeholder="/api/projects" value={draft.projectsPath} onChange={(e) => set({ projectsPath: e.target.value })} /></div><div><Label>Root path</Label><Input placeholder="data.items" value={draft.projectsRoot} onChange={(e) => set({ projectsRoot: e.target.value })} /></div></div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]"><div><Label>Users endpoint path</Label><Input placeholder="/api/employees" value={draft.usersPath} onChange={(e) => set({ usersPath: e.target.value })} /></div><div><Label>Root path</Label><Input placeholder="data.items" value={draft.usersRoot} onChange={(e) => set({ usersRoot: e.target.value })} /></div></div>
      </div>}
      {step === 3 && <div className="space-y-5 max-h-[320px] overflow-y-auto pr-1">
        {(['projects', 'users'] as const).filter((entity) => (entity === 'projects' ? draft.projectsPath : draft.usersPath).trim()).map((entity) => <div key={entity}>
          <p className="mb-2 font-medium">{ENTITY_LABELS[entity]} — source field → QMS360 field</p>
          <Table><TableBody>{draft.mappings[entity].map((m, i) => <TableRow key={i}>
            <TableCell><Input value={m.sourceField} onChange={(e) => set({ mappings: { ...draft.mappings, [entity]: draft.mappings[entity].map((r, j) => j === i ? { ...r, sourceField: e.target.value } : r) } })} /></TableCell>
            <TableCell className="w-10 text-center text-muted-foreground">→</TableCell>
            <TableCell><Select value={m.targetField} onValueChange={(v) => set({ mappings: { ...draft.mappings, [entity]: draft.mappings[entity].map((r, j) => j === i ? { ...r, targetField: v } : r) } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TARGET_FIELDS[entity].map((f) => <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>)}</SelectContent></Select></TableCell>
            <TableCell className="w-10"><Button variant="ghost" size="icon" aria-label="Remove mapping" onClick={() => set({ mappings: { ...draft.mappings, [entity]: draft.mappings[entity].filter((_, j) => j !== i) } })}><Trash2 className="h-4 w-4" /></Button></TableCell>
          </TableRow>)}</TableBody></Table>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => set({ mappings: { ...draft.mappings, [entity]: [...draft.mappings[entity], { sourceField: '', targetField: '' }] } })}><Plus className="mr-2 h-4 w-4" />Add mapping</Button>
        </div>)}
      </div>}
    </div>
    <DialogFooter className="flex justify-between sm:justify-between">
      <Button variant="outline" onClick={() => (step === 0 ? close() : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</Button>
      {step < 3 ? <Button disabled={!stepValid} onClick={() => setStep(step + 1)}>Continue</Button> : <Button disabled={busy} onClick={finish}><Save className="mr-2 h-4 w-4" />Create connection</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}

// ---------------------------------------------------------------------------
// Field-mapping editor for existing connectors (unchanged behavior).

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
  return <Card><CardHeader><CardTitle>Field mapping</CardTitle><CardDescription>Map source connector fields to QMS360 fields. Mappings are validated before activation; pull jobs use the active version.</CardDescription></CardHeader><CardContent className="space-y-4">
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
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} />Active — pull jobs use these mappings</label>
        </div>
        {active && missingRequired.length > 0 && <p className="text-sm text-destructive">Required before activation: {missingRequired.map((f) => f.label).join(', ')}</p>}
        <div className="flex justify-end"><Button onClick={save} disabled={saveMappings.isPending || (active && missingRequired.length > 0)}><Save className="mr-2 h-4 w-4" />Save mappings</Button></div>
        <p className="text-xs text-muted-foreground">* Required QMS360 fields must be mapped before the mapping set can be activated. Saving replaces the {selectedEntity.label} mapping set for this connector and bumps its mapping version.</p>
      </>}
    </>}
  </CardContent></Card>;
}

// ---------------------------------------------------------------------------
// Data import tab: Excel templates + file drop.

function TemplateEditor({ entity, template, onClose, onSaved }: { entity: string; template: ImportTemplate | null; onClose: () => void; onSaved: (title: string) => void }) {
  const { toast } = useToast();
  const isNew = template === null;
  const [name, setName] = useState(template?.name ?? '');
  const [columns, setColumns] = useState<ImportTemplateColumn[]>(template?.columns.map((c) => ({ ...c })) ?? []);
  const create = useCreateImportTemplate();
  const update = useUpdateImportTemplate();
  const fail = (error: unknown) => toast({ title: 'Could not save template', description: message(error), variant: 'destructive' });
  const save = () => {
    const payload = { entity: entity as 'projects' | 'users', name: name.trim(), columns };
    if (isNew) create.mutate({ data: payload }, { onSuccess: () => { onSaved('Template created'); onClose(); }, onError: fail });
    else update.mutate({ id: template.id, data: payload }, { onSuccess: () => { onSaved('Template updated'); onClose(); }, onError: fail });
  };
  const setCol = (index: number, patch: Partial<ImportTemplateColumn>) => setColumns(columns.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{isNew ? 'New template' : `Edit ${template.name}`}</DialogTitle><DialogDescription>{ENTITY_LABELS[entity]} — each column maps a spreadsheet header to a QMS360 field. Choose “Custom field” to add a brand-new data field; it will be stored with the record on import. Removed columns are simply ignored on future imports.</DialogDescription></DialogHeader>
    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
      <div><Label>Template name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ERP extract — projects" /></div>
      <Table><TableHeader><TableRow><TableHead>Spreadsheet column</TableHead><TableHead>QMS360 field</TableHead><TableHead className="w-20">Required</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>
        {columns.map((column, index) => <TableRow key={index}>
          <TableCell><Input value={column.header} onChange={(e) => setCol(index, { header: e.target.value })} placeholder="e.g. Project Code" /></TableCell>
          <TableCell>{column.field.startsWith('custom.')
            ? <div className="flex gap-2"><span className="mt-2 text-xs text-muted-foreground">custom.</span><Input value={column.field.slice(7)} onChange={(e) => setCol(index, { field: `custom.${e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase()}` })} placeholder="field_name" /></div>
            : <Select value={column.field} onValueChange={(v) => setCol(index, { field: v === '__custom__' ? 'custom.' : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TARGET_FIELDS[entity].map((f) => <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>)}<SelectItem value="__custom__">Custom field…</SelectItem></SelectContent></Select>}</TableCell>
          <TableCell><Checkbox checked={column.required} onCheckedChange={(v) => setCol(index, { required: v === true })} /></TableCell>
          <TableCell><Button variant="ghost" size="icon" aria-label="Remove column" onClick={() => setColumns(columns.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></TableCell>
        </TableRow>)}
      </TableBody></Table>
      <Button variant="outline" size="sm" onClick={() => setColumns([...columns, { header: '', field: TARGET_FIELDS[entity][0].key, required: false }])}><Plus className="mr-2 h-4 w-4" />Add column</Button>
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!name.trim() || !columns.length || create.isPending || update.isPending} onClick={save}><Save className="mr-2 h-4 w-4" />Save template</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function ImportTab() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [entity, setEntity] = useState<'projects' | 'users'>('projects');
  const templates = useListImportTemplates({ entity });
  const create = useCreateImportTemplate();
  const remove = useDeleteImportTemplate();
  const [editing, setEditing] = useState<ImportTemplate | null | 'new'>(null);
  const [file, setFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<PullResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = (title: string) => { client.invalidateQueries({ queryKey: ['/api/integrations/import-templates'] }); toast({ title }); };
  const fail = (error: unknown) => toast({ title: 'Import action failed', description: message(error), variant: 'destructive' });
  const list = templates.data ?? [];
  const selected = list.find((t) => t.id === templateId) ?? list[0];
  const copyTemplate = (template: ImportTemplate) => create.mutate(
    { data: { entity: template.entity, name: `${template.name.replace(/^Default — /, '')} (copy)`, columns: template.columns.map((c) => ({ ...c })) } },
    { onSuccess: () => refresh('Template copied — edit it to add or remove columns'), onError: fail },
  );
  const downloadTemplate = async (template: ImportTemplate) => {
    try {
      const token = localStorage.getItem('qms360_token');
      const response = await fetch(`/api/integrations/import-templates/${template.id}/download`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `Download failed (${response.status})`);
      const bytes = Uint8Array.from(atob(body.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url; link.download = body.fileName; link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      fail(error);
    }
  };
  const runImport = async () => {
    if (!file || !selected) return;
    setImporting(true); setResult(null);
    try {
      const token = localStorage.getItem('qms360_token');
      const response = await fetch(`/api/integrations/import-templates/${selected.id}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: file,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `Import failed (${response.status})`);
      setResult(body as PullResult);
      setFile(null);
      client.invalidateQueries({ queryKey: ['/api/integrations/sync-jobs'] });
    } catch (error) {
      toast({ title: 'Import failed', description: message(error), variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };
  return <div className="space-y-6">
    <Tabs value={entity} onValueChange={(v) => { setEntity(v as 'projects' | 'users'); setTemplateId(''); setResult(null); setFile(null); }}>
      <TabsList><TabsTrigger value="projects">Project details</TabsTrigger><TabsTrigger value="users">User details</TabsTrigger></TabsList>
    </Tabs>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Import templates</CardTitle><CardDescription>The default template is always available as a fallback. Copy it to create your own — added columns become new data fields on the records, removed columns are ignored.</CardDescription></div><Button variant="outline" onClick={() => setEditing('new')}> <Plus className="mr-2 h-4 w-4" />New template</Button></CardHeader><CardContent>
      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}
      {templates.error && <p className="text-sm text-destructive">{message(templates.error)}</p>}
      {list.length > 0 && <Table><TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Columns</TableHead><TableHead>Updated</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {list.map((template) => <TableRow key={template.id}>
          <TableCell><span className="font-medium">{template.name}</span>{template.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{template.columns.map((c) => c.header).join(', ')}</TableCell>
          <TableCell className="text-sm">{new Date(template.updatedAt).toLocaleDateString()}</TableCell>
          <TableCell><div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" title="Download Excel template" onClick={() => downloadTemplate(template)}><Download className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" title="Copy template" onClick={() => copyTemplate(template)}><Copy className="h-4 w-4" /></Button>
            {!template.isDefault && <Button variant="ghost" size="icon" title="Edit columns" onClick={() => setEditing(template)}><Save className="h-4 w-4" /></Button>}
            {!template.isDefault && <Button variant="ghost" size="icon" title="Delete template" onClick={() => remove.mutate({ id: template.id }, { onSuccess: () => refresh('Template deleted'), onError: fail })}><Trash2 className="h-4 w-4" /></Button>}
          </div></TableCell>
        </TableRow>)}
      </TableBody></Table>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>File drop</CardTitle><CardDescription>Drop an Excel workbook that follows the selected template. Rows are matched by project code / email and upserted; row-level problems are reported without blocking the rest.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Template</Label><Select value={selected?.id ?? ''} onValueChange={setTemplateId}><SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger><SelectContent>{list.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div
        role="button" tabIndex={0} aria-label="Drop Excel file here"
        className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const dropped = e.dataTransfer.files?.[0]; if (dropped) { setFile(dropped); setResult(null); } }}
      >
        <FileUp className="mb-2 h-6 w-6 text-muted-foreground" />
        {file ? <p className="font-medium">{file.name} <span className="text-muted-foreground">({Math.round(file.size / 1024)} KB)</span></p> : <p className="text-sm text-muted-foreground">Drag &amp; drop the .xlsx file here, or click to browse</p>}
        <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const picked = e.target.files?.[0]; if (picked) { setFile(picked); setResult(null); } e.target.value = ''; }} />
      </div>
      <div className="flex justify-end"><Button disabled={!file || !selected || importing} onClick={runImport}>{importing ? 'Importing…' : 'Import file'}</Button></div>
      {result && <div className={`rounded-lg border p-4 ${result.errorCount ? 'border-amber-500/50' : 'border-emerald-500/50'}`}>
        <p className="font-medium">Import {result.status === 'succeeded' ? 'completed' : 'failed'}: {result.targetCount} of {result.sourceCount} row(s) upserted{result.errorCount ? `, ${result.errorCount} failed` : ''}.</p>
        {result.errors.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-destructive">{result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
      </div>}
    </CardContent></Card>
    {editing !== null && <TemplateEditor entity={entity} template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
  </div>;
}

// ---------------------------------------------------------------------------

export function CockpitPage() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<IntegrationConnector>();
  const [password, setPassword] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const connectors = useListIntegrationConnectors({ page: 1, limit: 50 });
  const currentUser = useGetCurrentUser();
  const health = useGetIntegrationsHealth();
  const jobs = useListSyncJobs({ page, limit: 10 });
  const update = useUpdateIntegrationConnector();
  const remove = useDeleteIntegrationConnector();
  const retry = useRetrySyncJob();
  const testEmail = useSendConnectorTestEmail();
  const testConnection = useTestConnectorConnection();
  const pull = usePullConnectorData();
  const client = useQueryClient();
  const { toast } = useToast();
  const refresh = (title: string) => { client.invalidateQueries(); toast({ title }); };
  const fail = (error: unknown) => toast({ title: 'Integration action failed', description: message(error), variant: 'destructive' });
  const isEmail = editing?.family === 'email';
  const smtpKeys = new Set(['host', 'port', 'secure', 'username', 'user', 'password', 'pass', 'fromAddress', 'from', 'fromName']);
  const configEntries = editing
    ? Object.entries(editing.config ?? {}).filter(([key]) => !/(secret|password|token|key)/i.test(key) && key !== 'status' && key !== 'endpoints' && (!isEmail || !smtpKeys.has(key)))
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
  const connectorName = (id: string) => connectors.data?.items.find((c) => c.id === id)?.name ?? (id ? id.slice(0, 8) : 'Excel import');
  const loading = connectors.isLoading || health.isLoading || jobs.isLoading;
  const error = connectors.error || health.error || jobs.error;

  return <main className="min-h-screen bg-background">
    <header className="bg-primary px-5 py-8 text-primary-foreground md:px-10"><div className="mx-auto max-w-7xl">
      <Link href="/" className="mb-5 inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"><ArrowLeft className="h-4 w-4" />System overview</Link>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest opacity-70">Shared services</p><h1 className="mt-2 font-display text-3xl font-bold">Integration Cockpit</h1><p className="mt-2 max-w-2xl opacity-80">Connect source systems (ERP, custom apps) to pull project and user details, or fall back to Excel file drops — all from one control point.</p></div>{health.data && <div className="rounded-xl bg-card px-5 py-3 text-card-foreground"><p className="text-xs text-muted-foreground">Overall health</p><div className="mt-1 flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /><Status value={health.data.status} /></div></div>}</div>
    </div></header>
    <div className="mx-auto max-w-7xl px-5 py-7 md:px-10">
      {loading && <Card><CardContent className="space-y-3 py-12"><div className="h-6 w-1/3 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Checking connector health…</p></CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="flex items-center gap-4 py-8"><ServerCog className="text-destructive" /><div className="flex-1"><p className="font-semibold">Cockpit data unavailable</p><p className="text-sm text-muted-foreground">{message(error)}</p></div><Button variant="outline" onClick={() => { connectors.refetch(); health.refetch(); jobs.refetch(); }}>Retry</Button></CardContent></Card>}
      {!loading && !error && <Tabs defaultValue="connections" className="space-y-6">
        <TabsList>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="email">Email rules</TabsTrigger>
          {currentUser.data?.platformRole === 'Super Admin' && <TabsTrigger value="email-queue">Email queue</TabsTrigger>}
          <TabsTrigger value="import">Data import</TabsTrigger>
          <TabsTrigger value="project-master">Project master</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-6">
          <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">Connectors</h2><p className="text-sm text-muted-foreground">Secrets are securely stored and never returned or displayed.</p></div><Button onClick={() => setWizardOpen(true)}><Plus className="mr-2 h-4 w-4" />Add connection</Button></div>
            {connectors.data?.items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{connectors.data.items.filter(c => c.family !== 'email').map(connector => {
              const Icon = icons[connector.family] ?? CloudCog;
              return <Card key={connector.id} className="overflow-hidden"><CardHeader><div className="mb-3 flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Icon className="h-5 w-5" /></span><Status value={connector.status} /></div><CardTitle>{connector.name}</CardTitle><CardDescription>{labels[connector.family] ?? connector.family}</CardDescription></CardHeader><CardContent><div className="mb-4 flex justify-between text-sm"><span className="text-muted-foreground">Last successful sync</span><span>{connector.lastSuccessfulSyncAt ? new Date(connector.lastSuccessfulSyncAt).toLocaleString() : 'Never'}</span></div>
                <div className="space-y-2">
                  {connector.family === 'source_api' && <>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" disabled={pull.isPending} onClick={() => pull.mutate({ id: connector.id, data: { entity: 'projects' } }, { onSuccess: (r) => refresh(`Projects pulled: ${r.targetCount}/${r.sourceCount} upserted${r.errorCount ? `, ${r.errorCount} failed` : ''}`), onError: fail })}><Download className="mr-2 h-4 w-4" />Pull projects</Button>
                      <Button variant="secondary" disabled={pull.isPending} onClick={() => pull.mutate({ id: connector.id, data: { entity: 'users' } }, { onSuccess: (r) => refresh(`Users pulled: ${r.targetCount}/${r.sourceCount} upserted${r.errorCount ? `, ${r.errorCount} failed` : ''}`), onError: fail })}><Download className="mr-2 h-4 w-4" />Pull users</Button>
                    </div>
                    <Button variant="outline" className="w-full" disabled={testConnection.isPending} onClick={() => testConnection.mutate({ id: connector.id }, { onSuccess: (r) => toast({ title: r.ok ? 'Connection OK' : 'Connection failed', description: r.message, variant: r.ok ? 'default' : 'destructive' }), onError: fail })}><PlugZap className="mr-2 h-4 w-4" />Test connection</Button>
                  </>}
                  <div className="grid grid-cols-[1fr_auto] gap-2"><Button variant="outline" className="w-full" onClick={() => { setPassword(''); setEditing(connector); }}>Configure</Button><Button variant="ghost" size="icon" aria-label="Delete connector" onClick={() => remove.mutate({ id: connector.id }, { onSuccess: () => refresh('Connector deleted'), onError: fail })}><Trash2 className="h-4 w-4" /></Button></div>
                </div></CardContent></Card>;
            })}</div> : <Card><CardContent className="py-12 text-center"><p className="font-semibold">No connectors configured</p><p className="mb-4 text-sm text-muted-foreground">Add a source-system connection to start pulling project and user data.</p><Button onClick={() => setWizardOpen(true)}><Plus className="mr-2 h-4 w-4" />Add connection</Button></CardContent></Card>}
          </section>
          <FieldMappingCard connectors={connectors.data?.items ?? []} onSaved={refresh} />
        </TabsContent>

        <TabsContent value="email">
          <EmailRulesTab connectors={connectors.data?.items ?? []} onEditConnector={(c) => { setPassword(''); setEditing(c); }} />
        </TabsContent>
        {currentUser.data?.platformRole === 'Super Admin' && <TabsContent value="email-queue"><EmailQueueTab /></TabsContent>}

        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="project-master"><ProjectMasterTab /></TabsContent>

        <TabsContent value="activity">
          <Card><CardHeader><CardTitle>Sync activity</CardTitle><CardDescription>Recent pulls, imports and deliveries with retry controls.</CardDescription></CardHeader><CardContent>{jobs.data?.items.length ? <><Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Started</TableHead><TableHead>Duration</TableHead><TableHead>Records</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{jobs.data.items.map(job => <TableRow key={job.id}><TableCell>{connectorName(job.connectorId)}</TableCell><TableCell>{new Date(job.startedAt).toLocaleString()}</TableCell><TableCell>{job.durationMs != null ? `${Math.round(job.durationMs / 1000)}s` : '—'}</TableCell><TableCell>{job.sourceCount ?? 0} → {job.targetCount ?? 0}</TableCell><TableCell><Status value={job.status} />{job.error && <p className="mt-1 max-w-xs text-xs text-destructive">{job.error}</p>}</TableCell><TableCell>{job.status === 'failed' && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: job.id }, { onSuccess: (job2) => refresh(job2.status === 'succeeded' ? 'Email resent successfully' : 'Retry attempted — delivery still failing'), onError: fail })}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>}</TableCell></TableRow>)}</TableBody></Table><div className="mt-4 flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil((jobs.data.total ?? 0) / 10))}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * 10 >= (jobs.data.total ?? 0)} onClick={() => setPage(v => v + 1)}>Next</Button></div></div></> : <p className="py-10 text-center text-sm text-muted-foreground">No sync jobs have run yet.</p>}</CardContent></Card>
        </TabsContent>
      </Tabs>}
    </div>
    <AddConnectionWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSaved={refresh} />
    <Dialog open={!!editing} onOpenChange={open => { if (!open) { setEditing(undefined); setPassword(''); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Configure {editing?.name}</DialogTitle><DialogDescription>{isEmail ? 'SMTP settings for outbound escalation and workflow email. The password is write-only: enter a new one to replace it, or leave blank to keep the stored secret.' : 'Secret values are masked and cannot be viewed here. Replace them through the secure credential flow.'}</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><label className="flex items-center justify-between rounded-lg border p-4"><span><b>Connector enabled</b><span className="block text-sm text-muted-foreground">Allow scheduled and manual sync.</span></span><Switch checked={editing.enabled} onCheckedChange={enabled => setEditing({ ...editing, enabled })} /></label>{isEmail && <><div className="grid gap-3 sm:grid-cols-[2fr_1fr]"><div><Label>SMTP host</Label><Input placeholder="smtp.example.com" value={smtpValue('host')} onChange={e => setSmtp('host', e.target.value)} /></div><div><Label>Port</Label><Input inputMode="numeric" placeholder="587" value={smtpValue('port')} onChange={e => setSmtp('port', e.target.value.replace(/[^0-9]/g, ''))} /></div></div><div><Label>Security</Label><select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm" value={editing.config?.secure === true || editing.config?.secure === 'true' ? 'tls' : 'starttls'} onChange={e => setSmtp('secure', e.target.value === 'tls')}><option value="starttls">STARTTLS (upgrade after connect)</option><option value="tls">Implicit TLS from connect (port 465)</option></select></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>Username</Label><Input autoComplete="off" value={smtpValue('username')} onChange={e => setSmtp('username', e.target.value)} /></div><div><Label>Password</Label><Input type="password" autoComplete="new-password" placeholder="Leave blank to keep current" value={password} onChange={e => setPassword(e.target.value)} /></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>From address</Label><Input placeholder="qms360@example.com" value={smtpValue('fromAddress')} onChange={e => setSmtp('fromAddress', e.target.value)} /></div><div><Label>From name</Label><Input placeholder="QMS360" value={smtpValue('fromName')} onChange={e => setSmtp('fromName', e.target.value)} /></div></div><p className="text-xs text-muted-foreground">Credentials are encrypted at rest and never displayed after saving. Hosts resolving to private network addresses are rejected unless the platform allows an internal relay.</p></>}{configEntries.map(([key, value]) => <div key={key}><Label>{key.replaceAll('_', ' ')}</Label><Input value={typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)} onChange={e => setEditing({ ...editing, config: { ...editing.config, [key]: e.target.value } })} /></div>)}{!isEmail && <div><Label>Credential</Label><Input type="password" value="••••••••••••" disabled /><p className="mt-1 text-xs text-muted-foreground">Stored secret is masked and never displayed.</p></div>}</div>}<DialogFooter><Button variant="outline" onClick={() => { setEditing(undefined); setPassword(''); }}>Cancel</Button><Button onClick={save} disabled={update.isPending}><Save className="mr-2 h-4 w-4" />Save connector</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
