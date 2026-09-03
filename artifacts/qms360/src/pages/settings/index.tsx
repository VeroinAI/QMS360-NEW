import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import {
  useAssignAuditUserRole, useAssignLessonsUserRole, useAssignQaqcUserRole,
  useCreateAuditDelegation, useCreateAuditRole, useCreateLessonsDelegation, useCreateLessonsRole, useCreateQaqcDelegation, useCreateQaqcRole,
  useDecideAuditAccessRequest, useDecideLessonsAccessRequest, useDecideQaqcAccessRequest,
  useGetLessonsAiSettings, useGetQaqcAiSettings,
  useListAuditAccessQueue, useListAuditDelegations, useListAuditEscalationRules, useListAuditNotificationTemplates, useListAuditRoles, useListAuditUsers, useListAuditWorkspaceAuditLog,
  useListLessonsAccessQueue, useListLessonsAuditLog, useListLessonsDelegations, useListLessonsEscalationRules, useListLessonsNotificationTemplates, useListLessonsRoles, useListLessonsUsers,
  useListQaqcAccessQueue, useListQaqcAuditLog, useListQaqcDelegations, useListQaqcEscalationRules, useListQaqcNotificationTemplates, useListQaqcRoles, useListQaqcUsers,
  useRevokeAuditDelegation, useRevokeLessonsDelegation, useRevokeQaqcDelegation,
  useUpdateAuditEscalationRules, useUpdateAuditNotificationTemplate, useUpdateAuditRole,
  useUpdateLessonsAiSettings, useUpdateLessonsEscalationRules, useUpdateLessonsNotificationTemplate, useUpdateLessonsRole,
  useUpdateQaqcAiSettings, useUpdateQaqcEscalationRules, useUpdateQaqcNotificationTemplate, useUpdateQaqcRole,
} from '@workspace/api-client-react';
import type { AISettings, EscalationRule, NotificationTemplate, PermissionKey, Role, RoleAssignment } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Bell, Bot, Check, ChevronLeft, ChevronRight, Clock, FileClock, KeyRound, Plus, Save, Search, Settings2, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch as Toggle } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CockpitPage } from '../cockpit';

type AppKey = 'qaqc' | 'lessons' | 'audit';
type TabKey = 'overview' | 'access' | 'roles' | 'escalation' | 'ai' | 'notifications' | 'audit-log';
const names: Record<AppKey, string> = { qaqc: 'QA/QC & Document Governance', lessons: 'Lesson Learned Management', audit: 'QMS Audit Management' };
const tabs: { key: TabKey; label: string; icon: typeof Settings2 }[] = [
  { key: 'overview', label: 'Overview', icon: Settings2 }, { key: 'access', label: 'Users & Access', icon: Users },
  { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck }, { key: 'escalation', label: 'Escalation', icon: Clock },
  { key: 'ai', label: 'AI Settings', icon: Bot }, { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'audit-log', label: 'Audit Log', icon: FileClock },
];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The service could not complete this request.';
}

function PageState({ loading, error, empty, onRetry, children }: { loading: boolean; error: unknown; empty?: boolean; onRetry: () => void; children: React.ReactNode }) {
  if (loading) return <Card><CardContent className="space-y-3 py-12"><div className="h-5 w-1/3 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Loading administration data…</p></CardContent></Card>;
  if (error && /403|forbidden/i.test(errorText(error))) return <Card><CardContent className="py-14 text-center"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">Administrator access required</p><p className="mt-1 text-sm text-muted-foreground">This administration area is hidden because your workspace role does not include configuration access.</p></CardContent></Card>;
  if (error) return <Card className="border-destructive"><CardContent className="flex items-center gap-3 py-8"><AlertCircle className="text-destructive" /><div className="flex-1"><p className="font-semibold">Administration is unavailable</p><p className="text-sm text-muted-foreground">{errorText(error)}</p></div><Button variant="outline" onClick={onRetry}>Retry</Button></CardContent></Card>;
  if (empty) return <Card><CardContent className="py-14 text-center"><p className="font-semibold">No records found</p><p className="mt-1 text-sm text-muted-foreground">Try changing the filters or add the first record.</p></CardContent></Card>;
  return <>{children}</>;
}

function useAdmin(app: AppKey, page = 1, filters?: { from?: string; to?: string; actorId?: string; action?: string }) {
  const opts = (key: AppKey): any => ({ query: { enabled: app === key } });
  const q = {
    qaqc: {
      roles: useListQaqcRoles({ page, limit: 20 }, opts('qaqc')), users: useListQaqcUsers({ page, limit: 20 }, opts('qaqc')),
      access: useListQaqcAccessQueue({ page, limit: 20 }, opts('qaqc')), delegations: useListQaqcDelegations({ page, limit: 20 }, opts('qaqc')),
      escalations: useListQaqcEscalationRules(opts('qaqc')), templates: useListQaqcNotificationTemplates({ page, limit: 20 }, opts('qaqc')),
      log: useListQaqcAuditLog({ ...filters, page, limit: 20 }, opts('qaqc')), ai: useGetQaqcAiSettings(opts('qaqc')),
    },
    lessons: {
      roles: useListLessonsRoles({ page, limit: 20 }, opts('lessons')), users: useListLessonsUsers({ page, limit: 20 }, opts('lessons')),
      access: useListLessonsAccessQueue({ page, limit: 20 }, opts('lessons')), delegations: useListLessonsDelegations({ page, limit: 20 }, opts('lessons')),
      escalations: useListLessonsEscalationRules(opts('lessons')), templates: useListLessonsNotificationTemplates({ page, limit: 20 }, opts('lessons')),
      log: useListLessonsAuditLog({ ...filters, page, limit: 20 }, opts('lessons')), ai: useGetLessonsAiSettings(opts('lessons')),
    },
    audit: {
      roles: useListAuditRoles({ page, limit: 20 }, opts('audit')), users: useListAuditUsers({ page, limit: 20 }, opts('audit')),
      access: useListAuditAccessQueue({ page, limit: 20 }, opts('audit')), delegations: useListAuditDelegations({ page, limit: 20 }, opts('audit')),
      escalations: useListAuditEscalationRules(opts('audit')), templates: useListAuditNotificationTemplates({ page, limit: 20 }, opts('audit')),
      log: useListAuditWorkspaceAuditLog({ ...filters, page, limit: 20 }, opts('audit')), ai: null,
    },
  };
  return q[app];
}

function useActions(app: AppKey) {
  const client = useQueryClient();
  const { toast } = useToast();
  const done = (message: string) => { client.invalidateQueries(); toast({ title: message }); };
  const fail = (error: unknown) => toast({ title: 'Action failed', description: errorText(error), variant: 'destructive' });
  const mutations = {
    qaqc: { createRole: useCreateQaqcRole(), updateRole: useUpdateQaqcRole(), assign: useAssignQaqcUserRole(), decide: useDecideQaqcAccessRequest(), createDelegation: useCreateQaqcDelegation(), revoke: useRevokeQaqcDelegation(), escalation: useUpdateQaqcEscalationRules(), ai: useUpdateQaqcAiSettings(), template: useUpdateQaqcNotificationTemplate() },
    lessons: { createRole: useCreateLessonsRole(), updateRole: useUpdateLessonsRole(), assign: useAssignLessonsUserRole(), decide: useDecideLessonsAccessRequest(), createDelegation: useCreateLessonsDelegation(), revoke: useRevokeLessonsDelegation(), escalation: useUpdateLessonsEscalationRules(), ai: useUpdateLessonsAiSettings(), template: useUpdateLessonsNotificationTemplate() },
    audit: { createRole: useCreateAuditRole(), updateRole: useUpdateAuditRole(), assign: useAssignAuditUserRole(), decide: useDecideAuditAccessRequest(), createDelegation: useCreateAuditDelegation(), revoke: useRevokeAuditDelegation(), escalation: useUpdateAuditEscalationRules(), ai: null, template: useUpdateAuditNotificationTemplate() },
  };
  return { ...mutations[app], done, fail };
}

function Overview({ app }: { app: AppKey }) {
  const api = useAdmin(app);
  const queries = [api.users, api.roles, api.access, api.delegations];
  const stats = [
    ['Workspace users', api.users.data?.total ?? 0, Users], ['Active roles', api.roles.data?.items.filter(r => r.active).length ?? 0, ShieldCheck],
    ['Pending requests', api.access.data?.items.filter(r => r.status === 'pending').length ?? 0, KeyRound],
    ['Active delegations', api.delegations.data?.items.filter(d => d.status === 'active').length ?? 0, Clock],
  ] as const;
  return <PageState loading={queries.some(q => q.isLoading)} error={queries.find(q => q.error)?.error} onRetry={() => queries.forEach(q => q.refetch())}>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value, Icon]) => <Card key={label}><CardContent className="pt-6"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon className="h-5 w-5" /></div><p className="text-3xl font-bold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>)}</div>
    <Card className="mt-5"><CardHeader><CardTitle>Independent application administration</CardTitle><CardDescription>{names[app]} maintains its own users, roles, workflow controls, notifications, and immutable audit history.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><div className="rounded-lg border p-4"><p className="font-medium">Access governance</p><p className="text-sm text-muted-foreground">Role assignment is scoped inside this application.</p></div><div className="rounded-lg border p-4"><p className="font-medium">Workflow controls</p><p className="text-sm text-muted-foreground">Escalations and templates are independently managed.</p></div><div className="rounded-lg border p-4"><p className="font-medium">Compliance</p><p className="text-sm text-muted-foreground">Every administrative change is recorded.</p></div></CardContent></Card>
  </PageState>;
}

function UsersAccess({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [search, setSearch] = useState('');
  const [roleDialog, setRoleDialog] = useState<string>(); const [roleId, setRoleId] = useState('');
  const [delegateOpen, setDelegateOpen] = useState(false); const [delegation, setDelegation] = useState({ delegatorId: '', delegateId: '', scope: 'all', startDate: '', endDate: '' });
  const users = api.users.data?.items.filter(u => `${u.username} ${u.email}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const saveRole = () => {
    if (!roleDialog || !roleId) return;
    const data: RoleAssignment = { roleId, scopeType: 'organization', scopeIds: [] };
    act.assign.mutate({ userId: roleDialog, data }, { onSuccess: () => { act.done('Role assigned'); setRoleDialog(undefined); }, onError: act.fail });
  };
  const createDelegation = () => {
    if (!delegation.delegatorId || !delegation.delegateId || !delegation.startDate || !delegation.endDate) return;
    const data = { id: crypto.randomUUID(), ...delegation, status: 'pending' as const };
    act.createDelegation.mutate({ data }, { onSuccess: () => { act.done('Delegation created'); setDelegateOpen(false); }, onError: act.fail });
  };
  const pending = api.access.data?.items.filter(r => r.status === 'pending') ?? [];
  const loading = api.users.isLoading || api.roles.isLoading || api.access.isLoading || api.delegations.isLoading;
  const error = api.users.error || api.roles.error || api.access.error || api.delegations.error;
  return <PageState loading={loading} error={error} onRetry={() => { api.users.refetch(); api.roles.refetch(); api.access.refetch(); api.delegations.refetch(); }}>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Workspace users</CardTitle><CardDescription>Assign application roles and review access.</CardDescription></div><Button onClick={() => setDelegateOpen(true)}><Plus className="mr-2 h-4 w-4" />Delegation</Button></CardHeader><CardContent><div className="relative mb-4 max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="Search user or email" /></div>
      <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Platform role</TableHead><TableHead>Workspace roles</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{users.map(u => <TableRow key={u.id}><TableCell><p className="font-medium">{u.username}</p><p className="text-xs text-muted-foreground">{u.email}</p></TableCell><TableCell>{u.platformRole}</TableCell><TableCell className="space-x-1">{u.workspaceRoles.map(r => <Badge key={r.id} variant="secondary">{r.name}</Badge>)}</TableCell><TableCell><Badge variant={u.status === 'Active' ? 'default' : 'secondary'}>{u.status}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setRoleDialog(u.id)}>Assign role</Button></TableCell></TableRow>)}</TableBody></Table>
      {!users.length && <p className="py-10 text-center text-sm text-muted-foreground">No users match this search.</p>}</CardContent></Card>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle>Access request queue</CardTitle><CardDescription>Approve or reject pending requests.</CardDescription></CardHeader><CardContent className="space-y-3">{pending.map(r => <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="flex-1"><p className="font-medium">User {r.userId}</p><p className="text-xs text-muted-foreground">Requested {new Date(r.requestedAt).toLocaleDateString()}</p></div><Button size="sm" onClick={() => act.decide.mutate({ id: r.id, data: { decision: 'approve' } }, { onSuccess: () => act.done('Access approved'), onError: act.fail })}><Check className="mr-1 h-4 w-4" />Approve</Button><Button size="sm" variant="outline" onClick={() => act.decide.mutate({ id: r.id, data: { decision: 'reject' } }, { onSuccess: () => act.done('Access rejected'), onError: act.fail })}>Reject</Button></div>)}{!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No pending access requests.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Delegations</CardTitle><CardDescription>Access expires automatically at the end date.</CardDescription></CardHeader><CardContent className="space-y-3">{api.delegations.data?.items.map(d => <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="flex-1"><p className="font-medium">{d.delegatorId} → {d.delegateId}</p><p className="text-xs text-muted-foreground">{d.scope} · expires {new Date(d.endDate).toLocaleDateString()}</p></div><Badge variant={d.status === 'active' ? 'default' : 'secondary'}>{d.status}</Badge>{['active', 'pending'].includes(d.status) && <Button size="icon" variant="ghost" onClick={() => act.revoke.mutate({ id: d.id }, { onSuccess: () => act.done('Delegation revoked'), onError: act.fail })}><Trash2 className="h-4 w-4" /></Button>}</div>)}{!api.delegations.data?.items.length && <p className="py-8 text-center text-sm text-muted-foreground">No delegations configured.</p>}</CardContent></Card></div>
    <Dialog open={!!roleDialog} onOpenChange={open => !open && setRoleDialog(undefined)}><DialogContent><DialogHeader><DialogTitle>Assign workspace role</DialogTitle><DialogDescription>Assignment applies only to {names[app]}.</DialogDescription></DialogHeader><Label>Role</Label><Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger><SelectContent>{api.roles.data?.items.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select><DialogFooter><Button variant="outline" onClick={() => setRoleDialog(undefined)}>Cancel</Button><Button disabled={!roleId || act.assign.isPending} onClick={saveRole}>Assign</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={delegateOpen} onOpenChange={setDelegateOpen}><DialogContent><DialogHeader><DialogTitle>Create delegation</DialogTitle><DialogDescription>Delegate access for a fixed period. It expires automatically.</DialogDescription></DialogHeader><div className="grid gap-3"><Label>Delegator user ID</Label><Input value={delegation.delegatorId} onChange={e => setDelegation({ ...delegation, delegatorId: e.target.value })} /><Label>Delegate user ID</Label><Input value={delegation.delegateId} onChange={e => setDelegation({ ...delegation, delegateId: e.target.value })} /><Label>Scope</Label><Input value={delegation.scope} onChange={e => setDelegation({ ...delegation, scope: e.target.value })} /><div className="grid grid-cols-2 gap-3"><div><Label>Starts</Label><Input type="date" value={delegation.startDate} onChange={e => setDelegation({ ...delegation, startDate: e.target.value })} /></div><div><Label>Expires</Label><Input type="date" value={delegation.endDate} onChange={e => setDelegation({ ...delegation, endDate: e.target.value })} /></div></div></div><DialogFooter><Button onClick={createDelegation}>Create delegation</Button></DialogFooter></DialogContent></Dialog>
  </PageState>;
}

const permissionLabels: Record<PermissionKey, string> = { data_entry: 'Create / edit', submit: 'Submit', approve_reject: 'Approve / reject', view_own_scope: 'View own', view_all: 'View all', configure_masters: 'Configure', manage_integrations: 'Integrations', manage_ai_settings: 'AI settings', export: 'Export', delegate: 'Delegate' };
function Roles({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [editing, setEditing] = useState<Role>();
  const newRole = () => setEditing({ id: crypto.randomUUID(), name: '', description: '', active: true, permissions: [] });
  const togglePermission = (key: PermissionKey) => editing && setEditing({ ...editing, permissions: editing.permissions.some(p => p.key === key) ? editing.permissions.filter(p => p.key !== key) : [...editing.permissions, { key, name: permissionLabels[key] }] });
  const save = () => {
    if (!editing?.name.trim()) return;
    const exists = api.roles.data?.items.some(r => r.id === editing.id);
    const mutation = exists ? act.updateRole : act.createRole;
    const variables = exists ? { id: editing.id, data: editing } : { data: editing };
    mutation.mutate(variables as never, { onSuccess: () => { act.done(exists ? 'Role updated' : 'Role created'); setEditing(undefined); }, onError: act.fail });
  };
  return <PageState loading={api.roles.isLoading} error={api.roles.error} empty={!api.roles.data?.items.length} onRetry={api.roles.refetch}>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Roles & permission matrix</CardTitle><CardDescription>Full capabilities can be narrowed by assignment scope to Own or Select.</CardDescription></div><Button onClick={newRole}><Plus className="mr-2 h-4 w-4" />Custom role</Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Role</TableHead>{Object.values(permissionLabels).map(v => <TableHead key={v} className="text-center text-xs">{v}</TableHead>)}</TableRow></TableHeader><TableBody>{api.roles.data?.items.map(r => <TableRow key={r.id} className="cursor-pointer" onClick={() => setEditing(r)}><TableCell><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.systemDefault ? 'System default' : 'Custom'}</p></TableCell>{Object.keys(permissionLabels).map(k => <TableCell key={k} className="text-center">{r.permissions.some(p => p.key === k) ? <Badge>Full</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card>
    <Dialog open={!!editing} onOpenChange={open => !open && setEditing(undefined)}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{editing?.name ? 'Edit role' : 'Build a custom role'}</DialogTitle><DialogDescription>Select capability primitives. Scope is chosen when assigning the role (Full, Own, or Select).</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><div><Label>Role name</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} disabled={editing.systemDefault} /></div><div><Label>Description</Label><Textarea value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{(Object.keys(permissionLabels) as PermissionKey[]).map(key => <label key={key} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><Checkbox checked={editing.permissions.some(p => p.key === key)} onCheckedChange={() => togglePermission(key)} /><span>{permissionLabels[key]}</span></label>)}</div><label className="flex items-center gap-3"><Toggle checked={editing.active} onCheckedChange={active => setEditing({ ...editing, active })} />Role enabled</label></div>}<DialogFooter><Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button><Button onClick={save} disabled={!editing?.name.trim()}><Save className="mr-2 h-4 w-4" />Save role</Button></DialogFooter></DialogContent></Dialog>
  </PageState>;
}

function Escalations({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [draft, setDraft] = useState<EscalationRule[]>();
  const rows = draft ?? api.escalations.data?.items ?? [];
  const patch = (id: string, value: Partial<EscalationRule>) => setDraft(rows.map(r => r.id === id ? { ...r, ...value } : r));
  return <PageState loading={api.escalations.isLoading} error={api.escalations.error} empty={!rows.length} onRetry={api.escalations.refetch}><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Escalation rules</CardTitle><CardDescription>Configure trigger, threshold, target level, cadence and availability.</CardDescription></div><Button disabled={!draft || act.escalation.isPending} onClick={() => act.escalation.mutate({ data: rows }, { onSuccess: () => { act.done('Escalation rules saved'); setDraft(undefined); }, onError: act.fail })}><Save className="mr-2 h-4 w-4" />Save changes</Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Trigger type</TableHead><TableHead>Priority / level</TableHead><TableHead>Threshold days</TableHead><TableHead>Target roles</TableHead><TableHead>Repeat</TableHead><TableHead>Enabled</TableHead></TableRow></TableHeader><TableBody>{rows.map(r => <TableRow key={r.id}><TableCell><Input value={r.triggerType} onChange={e => patch(r.id, { triggerType: e.target.value })} /></TableCell><TableCell><Select value={r.priority ?? r.level ?? ''} onValueChange={v => patch(r.id, { priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['L1','L2','L3','P1','P2'].map(v => <SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select></TableCell><TableCell><Input type="number" min={0} value={r.slaWorkingDays} onChange={e => patch(r.id, { slaWorkingDays: Number(e.target.value) })} /></TableCell><TableCell><Input value={r.recipientRoles.join(', ')} onChange={e => patch(r.id, { recipientRoles: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} /></TableCell><TableCell><Input type="number" min={1} value={r.repeatCadenceDays} onChange={e => patch(r.id, { repeatCadenceDays: Number(e.target.value) })} /></TableCell><TableCell><Toggle checked={r.enabled} onCheckedChange={enabled => patch(r.id, { enabled })} /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></PageState>;
}

function AiSettings({ app }: { app: Exclude<AppKey, 'audit'> }) {
  const api = useAdmin(app); const act = useActions(app); const [draft, setDraft] = useState<AISettings>();
  const value = draft ?? api.ai?.data;
  if (!api.ai || !act.ai) return null;
  return <PageState loading={api.ai.isLoading} error={api.ai.error} onRetry={api.ai.refetch}>{value && <div className="grid gap-5 lg:grid-cols-[1fr_.7fr]"><Card><CardHeader><CardTitle>AI provider & model</CardTitle><CardDescription>Controls apply only to this application. Credentials remain in the Integration Cockpit and are never displayed here.</CardDescription></CardHeader><CardContent className="space-y-4"><label className="flex items-center justify-between rounded-lg border p-4"><span><b>Enable AI assistance</b><span className="block text-sm text-muted-foreground">Allow configured AI features.</span></span><Toggle checked={value.enabled} onCheckedChange={enabled => setDraft({ ...value, enabled })} /></label><div className="grid gap-4 md:grid-cols-2"><div><Label>Provider</Label><Input value={value.provider} onChange={e => setDraft({ ...value, provider: e.target.value })} /></div><div><Label>Model</Label><Input value={value.model} onChange={e => setDraft({ ...value, model: e.target.value })} /></div><div><Label>Timeout (seconds)</Label><Input type="number" min={1} value={value.timeoutSeconds} onChange={e => setDraft({ ...value, timeoutSeconds: Number(e.target.value) })} /></div><div><Label>Retention (days)</Label><Input type="number" min={0} value={value.retentionDays ?? 0} onChange={e => setDraft({ ...value, retentionDays: Number(e.target.value) })} /></div></div><Button disabled={!draft || act.ai.isPending} onClick={() => act.ai?.mutate({ data: value }, { onSuccess: () => { act.done('AI settings saved'); setDraft(undefined); }, onError: act.fail })}><Save className="mr-2 h-4 w-4" />Save settings</Button></CardContent></Card><Card><CardHeader><CardTitle>Features & privacy</CardTitle></CardHeader><CardContent className="space-y-3">{Object.entries(value.features).map(([key, enabled]) => <label key={key} className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium">{key.replaceAll('_', ' ')}</span><Toggle checked={enabled} onCheckedChange={checked => setDraft({ ...value, features: { ...value.features, [key]: checked } })} /></label>)}<label className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium">Strip personal data</span><Toggle checked={value.stripPersonalData ?? false} onCheckedChange={stripPersonalData => setDraft({ ...value, stripPersonalData })} /></label></CardContent></Card></div>}</PageState>;
}

function Notifications({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [editing, setEditing] = useState<NotificationTemplate>();
  const save = () => editing && act.template.mutate({ id: editing.id, data: editing }, { onSuccess: () => { act.done('Notification template saved'); setEditing(undefined); }, onError: act.fail });
  return <PageState loading={api.templates.isLoading} error={api.templates.error} empty={!api.templates.data?.items.length} onRetry={api.templates.refetch}><Card><CardHeader><CardTitle>Notification templates</CardTitle><CardDescription>Manage application-specific subject, body, channels and availability.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Subject</TableHead><TableHead>Channels</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{api.templates.data?.items.map(t => <TableRow key={t.id}><TableCell className="font-medium">{t.key}</TableCell><TableCell>{t.subject}</TableCell><TableCell className="space-x-1">{t.channels.map(c => <Badge variant="secondary" key={c}>{c}</Badge>)}</TableCell><TableCell><Badge variant={t.enabled ? 'default' : 'secondary'}>{t.enabled ? 'Enabled' : 'Disabled'}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Dialog open={!!editing} onOpenChange={open => !open && setEditing(undefined)}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Edit notification template</DialogTitle><DialogDescription>Merge fields are preserved when the message is sent.</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><div><Label>Subject</Label><Input value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} /></div><div><Label>Body template</Label><Textarea rows={8} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} /></div><div><Label>Channel</Label><Select value={editing.channels[0] ?? 'in_app'} onValueChange={v => setEditing({ ...editing, channels: [v as NotificationTemplate['channels'][number]] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['in_app','email','push','sms'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><label className="flex items-center gap-3"><Toggle checked={editing.enabled} onCheckedChange={enabled => setEditing({ ...editing, enabled })} />Template enabled</label></div>}<DialogFooter><Button onClick={save}><Save className="mr-2 h-4 w-4" />Save template</Button></DialogFooter></DialogContent></Dialog></PageState>;
}

function AuditLog({ app }: { app: AppKey }) {
  const [page, setPage] = useState(1); const [draft, setDraft] = useState({ from: '', to: '', actorId: '', action: '' }); const [filters, setFilters] = useState<Record<string, string>>({});
  const api = useAdmin(app, page, filters);
  const entries = api.log.data?.items ?? [];
  return <><Card className="mb-5"><CardHeader><CardTitle>Audit log filters</CardTitle><CardDescription>Read-only, immutable administrative history.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-5"><Input type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /><Input type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /><Input placeholder="Actor ID" value={draft.actorId} onChange={e => setDraft({ ...draft, actorId: e.target.value })} /><Input placeholder="Action" value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })} /><Button onClick={() => { setPage(1); setFilters(Object.fromEntries(Object.entries(draft).filter(([,v]) => v))); }}><Search className="mr-2 h-4 w-4" />Apply</Button></CardContent></Card><PageState loading={api.log.isLoading} error={api.log.error} empty={!entries.length} onRetry={api.log.refetch}><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Date & time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>IP address</TableHead></TableRow></TableHeader><TableBody>{entries.map(e => <TableRow key={e.id}><TableCell>{new Date(e.occurredAt).toLocaleString()}</TableCell><TableCell>{e.actorId}</TableCell><TableCell><Badge variant="outline">{e.action}</Badge></TableCell><TableCell>{e.entityType} · {e.entityId}</TableCell><TableCell>{e.ipAddress ?? '—'}</TableCell></TableRow>)}</TableBody></Table><div className="mt-5 flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {page} · {api.log.data?.total ?? 0} entries</p><div className="flex gap-2"><Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></Button><Button size="icon" variant="outline" disabled={page * 20 >= (api.log.data?.total ?? 0)} onClick={() => setPage(p => p + 1)}><ChevronRight /></Button></div></div></CardContent></Card></PageState></>;
}

function SettingsPage() {
  const params = useParams<{ app: string; tab?: string }>(); const [, navigate] = useLocation();
  const app = (['qaqc','lessons','audit'].includes(params.app) ? params.app : 'qaqc') as AppKey;
  const tab = (params.tab || 'overview') as TabKey;
  const visibleTabs = tabs.filter(t => !(app === 'audit' && t.key === 'ai'));
  const content = tab === 'overview' ? <Overview app={app} /> : tab === 'access' ? <UsersAccess app={app} /> : tab === 'roles' ? <Roles app={app} /> : tab === 'escalation' ? <Escalations app={app} /> : tab === 'ai' && app !== 'audit' ? <AiSettings app={app} /> : tab === 'notifications' ? <Notifications app={app} /> : <AuditLog app={app} />;
  return <main className="min-h-screen bg-background"><header className="bg-primary px-5 py-8 text-primary-foreground md:px-10"><div className="mx-auto max-w-7xl"><Link href={`/${app}`} className="mb-5 inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"><ArrowLeft className="h-4 w-4" />Back to application</Link><p className="text-sm font-semibold uppercase tracking-widest opacity-70">Independent workspace administration</p><h1 className="mt-2 font-display text-3xl font-bold">{names[app]} Settings</h1><p className="mt-2 max-w-2xl opacity-80">Configure access, governance and operational controls for this application only.</p></div></header><div className="mx-auto max-w-7xl px-5 py-6 md:px-10"><nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5">{visibleTabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => navigate(`/settings/${app}/${key}`)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>{content}</div></main>;
}

export function AdminRoutes() {
  return <Switch><Route path="/settings/:app/:tab"><SettingsPage /></Route><Route path="/settings/:app"><SettingsPage /></Route><Route path="/cockpit"><CockpitPage /></Route></Switch>;
}