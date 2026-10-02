import { useQueryClient } from '@tanstack/react-query';
import { useLov } from '@/lib/use-lov';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import {
  useAssignAuditUserRole, useAssignLessonsUserRole, useAssignQaqcUserRole,
  useCreateAuditDelegation, useCreateAuditRole, useCreateLessonsDelegation, useCreateLessonsRole, useCreateQaqcDelegation, useCreateQaqcRole,
  useDecideAuditAccessRequest, useDecideLessonsAccessRequest, useDecideQaqcAccessRequest,
  useGetAuditAdminFieldControls, useGetAuditScheduleNumbering, useGetCurrentUser, useGetLessonsAdminFieldControls, useGetLessonsAiSettings, useGetNumberingConfig, useGetPlatformContext, useGetQaqcAdminFieldControls, useGetQaqcAiSettings,
  useCreateApproverScope, useDeleteApproverScope, useGetLessonsReferenceData, useListApproverScopes, useListLessonApprovers,
  getGetLessonsDelegationOptionsQueryKey, getListLessonsDelegationPendingFormsQueryKey,
  useGetLessonsDelegationOptions, useListLessonsDelegationPendingForms,
  useListAuditAccessQueue, useListAuditDelegations, useListAuditEscalationRules, useListAuditNotificationTemplates, useListAuditRoles, useListAuditUsers, useListAuditWorkspaceAuditLog,
  useListLessonsAccessQueue, useListLessonsAuditLog, useListLessonsDelegations, useListLessonsEscalationRules, useListLessonsNotificationTemplates, useListLessonsRoles, useListLessonsUsers,
  useListQaqcAccessQueue, useListQaqcAuditLog, useListQaqcDelegations, useListQaqcEscalationRules, useListQaqcNotificationTemplates, useListQaqcRoles, useListQaqcUsers,
  useResetNumberingPattern, useRevokeAuditDelegation, useRevokeLessonsDelegation, useRevokeQaqcDelegation,
  useRemoveAuditUserRole, useRemoveLessonsUserRole, useRemoveQaqcUserRole,
  useSetUserTemporaryPassword,
  getListPlatformRolesQueryKey, useListPlatformRoles, useUpdateUserEmail, useUpdateUserPlatformRole,
  useUpdateAuditEscalationRules, useUpdateAuditNotificationTemplate, useUpdateAuditRole, useUpdateNumberingPattern,
  useUpdateAuditAdminFieldControls, useUpdateAuditScheduleNumbering, useUpdateLessonsAdminFieldControls, useUpdateLessonsAiSettings, useUpdateLessonsEscalationRules, useUpdateLessonsNotificationTemplate, useUpdateLessonsRole,
  useUpdateQaqcAdminFieldControls, useUpdateQaqcAiSettings, useUpdateQaqcEscalationRules, useUpdateQaqcNotificationTemplate, useUpdateQaqcRole,
  useGetLessonsEscalationReportJob, useUpdateLessonsEscalationReportJob, useRunLessonsEscalationReportJob,
  useUpdateLessonsUserProfile,
  useUpdateAuditUserProfile,
} from '@workspace/api-client-react';
import { PdfTemplatesAdmin } from '@/pages/qaqc/reporting/pdf-templates-admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch as Toggle } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CockpitPage } from '../cockpit';
import type { AISettings, AuditScheduleNumbering, EscalationRule, FieldControlSetting, NotificationTemplate, NumberingModuleConfig, PermissionKey, Role, RoleAssignment } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Bell, Sparkles, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, FileClock, Hash, KeyRound, Plus, Save, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { fieldControlRegistry } from '@/lib/field-controls';
import { userFacingApiError } from '@/lib/api-error';
import { useEffect, useState } from 'react';

type AppKey = 'qaqc' | 'lessons' | 'audit';
type TabKey = 'overview' | 'numbering' | 'access' | 'roles' | 'escalation' | 'ai' | 'form-fields' | 'notifications' | 'audit-log' | 'pdf-templates';
const names: Record<AppKey, string> = { qaqc: 'QA/QC & Document Governance', lessons: 'Lesson Learned Management', audit: 'QMS Audit Management' };
const tabs: { key: TabKey; label: string; icon: typeof Settings2 }[] = [
  { key: 'overview', label: 'Overview', icon: Settings2 }, { key: 'numbering', label: 'Numbering', icon: Hash }, { key: 'access', label: 'Users & Access', icon: Users },
  { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck }, { key: 'escalation', label: 'Escalation', icon: Clock },
  { key: 'ai', label: 'VerionAI Settings', icon: Sparkles }, { key: 'form-fields', label: 'Form Fields', icon: SlidersHorizontal },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'pdf-templates', label: 'PDF Templates', icon: FileClock },
  { key: 'audit-log', label: 'Audit Log', icon: FileClock },
];

function errorText(error: unknown) {
  const details = userFacingApiError(error, 'Administration could not be loaded.');
  return `${details.message} (${details.technicalCode})`;
}

function DelegationPerson({ name, username, email, status, fallbackId }: { name?: string | null; username?: string | null; email?: string | null; status?: string | null; fallbackId: string }) {
  const context = username ? `@${username}` : email;
  const unavailable = status === 'unavailable';
  return <div className="min-w-0">
    <p className="truncate font-medium">{name?.trim() || (unavailable ? 'Unavailable user' : fallbackId)}{status === 'deactivated' && <span className="ml-1 font-normal text-muted-foreground">(deactivated)</span>}</p>
    {(context || unavailable) && <p className="truncate text-xs text-muted-foreground">{context || 'Account no longer available'}</p>}
  </div>;
}

function PageState({ loading, error, empty, onRetry, children }: { loading: boolean; error: unknown; empty?: boolean; onRetry: () => void; children: React.ReactNode }) {
  if (loading) return <Card><CardContent className="space-y-3 py-12"><div className="h-5 w-1/3 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Loading administration data…</p></CardContent></Card>;
  if (error && /403|forbidden/i.test(errorText(error))) return <Card><CardContent className="py-14 text-center"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">Administrator access required</p><p className="mt-1 text-sm text-muted-foreground">This administration area is hidden because your workspace role does not include configuration access.</p></CardContent></Card>;
  if (error) return <Card className="border-destructive"><CardContent className="flex items-center gap-3 py-8"><AlertCircle className="text-destructive" /><div className="flex-1"><p className="font-semibold">Administration is unavailable</p><p className="text-sm text-muted-foreground">{errorText(error)}</p></div><Button variant="outline" onClick={onRetry}>Retry</Button></CardContent></Card>;
  if (empty) return <Card><CardContent className="py-14 text-center"><p className="font-semibold">No records found</p><p className="mt-1 text-sm text-muted-foreground">Try changing the filters or add the first record.</p></CardContent></Card>;
  return <>{children}</>;
}

function useAdmin(app: AppKey, page = 1, filters?: { from?: string; to?: string; actorId?: string; action?: string }, accessPage = page) {
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
      job: useGetLessonsEscalationReportJob(opts('lessons')),
      log: useListLessonsAuditLog({ ...filters, page, limit: 20 }, opts('lessons')), ai: useGetLessonsAiSettings(opts('lessons')),
    },
    audit: {
      roles: useListAuditRoles({ page, limit: 20 }, opts('audit')), users: useListAuditUsers({ page, limit: 20 }, opts('audit')),
      access: useListAuditAccessQueue({ page: accessPage, limit: 20 }, opts('audit')), delegations: useListAuditDelegations({ page, limit: 20 }, opts('audit')),
      escalations: useListAuditEscalationRules(opts('audit')), templates: useListAuditNotificationTemplates({ page, limit: 20 }, opts('audit')),
      log: useListAuditWorkspaceAuditLog({ ...filters, page, limit: 20 }, opts('audit')), ai: null,
      job: useGetLessonsEscalationReportJob({ query: { enabled: false, queryKey: ['disabled-lessons-job'] } }),
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
    qaqc: { createRole: useCreateQaqcRole(), updateRole: useUpdateQaqcRole(), assign: useAssignQaqcUserRole(), removeRole: useRemoveQaqcUserRole(), decide: useDecideQaqcAccessRequest(), createDelegation: useCreateQaqcDelegation(), revoke: useRevokeQaqcDelegation(), escalation: useUpdateQaqcEscalationRules(), ai: useUpdateQaqcAiSettings(), template: useUpdateQaqcNotificationTemplate(), job: useUpdateLessonsEscalationReportJob(), runJob: useRunLessonsEscalationReportJob() },
    lessons: { createRole: useCreateLessonsRole(), updateRole: useUpdateLessonsRole(), assign: useAssignLessonsUserRole(), removeRole: useRemoveLessonsUserRole(), decide: useDecideLessonsAccessRequest(), createDelegation: useCreateLessonsDelegation(), revoke: useRevokeLessonsDelegation(), escalation: useUpdateLessonsEscalationRules(), ai: useUpdateLessonsAiSettings(), template: useUpdateLessonsNotificationTemplate(), job: useUpdateLessonsEscalationReportJob(), runJob: useRunLessonsEscalationReportJob() },
    audit: { createRole: useCreateAuditRole(), updateRole: useUpdateAuditRole(), assign: useAssignAuditUserRole(), removeRole: useRemoveAuditUserRole(), decide: useDecideAuditAccessRequest(), createDelegation: useCreateAuditDelegation(), revoke: useRevokeAuditDelegation(), escalation: useUpdateAuditEscalationRules(), ai: null, template: useUpdateAuditNotificationTemplate(), job: useUpdateLessonsEscalationReportJob(), runJob: useRunLessonsEscalationReportJob() },
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

// Scoped approver assignments for lesson forms. A blank dimension matches
// everything; once any row exists, only approvers with a matching row qualify.
function ApproverScopes() {
  const { toast } = useToast(); const client = useQueryClient();
  const scopes = useListApproverScopes();
  const approvers = useListLessonApprovers({ includeSelf: 'true' });
  const refs = useGetLessonsReferenceData();
  const categorisations = useLov('lesson_categorisations');
  const create = useCreateApproverScope(); const remove = useDeleteApproverScope();
  const [open, setOpen] = useState(false);
  const blank = { userId: '', projectId: 'all', disciplineId: 'all', categorisation: 'all' };
  const [form, setForm] = useState(blank);
  const invalidate = () => client.invalidateQueries({ queryKey: ['/api/lessons/admin/approver-scopes'] });
  const fail = (title: string) => (error: unknown) => toast({ title, description: errorText(error), variant: 'destructive' });
  const save = () => {
    if (!form.userId) return;
    create.mutate({ data: { userId: form.userId, ...(form.projectId !== 'all' ? { projectId: form.projectId } : {}), ...(form.disciplineId !== 'all' ? { disciplineId: form.disciplineId } : {}), ...(form.categorisation !== 'all' ? { categorisation: form.categorisation } : {}) } }, { onSuccess: () => { toast({ title: 'Approver scope saved' }); setOpen(false); setForm(blank); invalidate(); }, onError: fail('Unable to save approver scope') });
  };
  const rows = scopes.data ?? [];
  return <Card className="mt-5"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Approver scope</CardTitle><CardDescription>Control which lesson forms an approver may review. Blank dimensions match everything: a row with no project, discipline or categorisation allows approving all lessons. Once at least one row exists, only approvers with a matching row can be designated.</CardDescription></div><Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Approver scope</Button></CardHeader>
    <CardContent><Table><TableHeader><TableRow><TableHead>Approver</TableHead><TableHead>Project</TableHead><TableHead>Discipline</TableHead><TableHead>Categorisation</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map(s => <TableRow key={s.id}><TableCell><p className="font-medium">{s.userName}</p><p className="text-xs text-muted-foreground">{s.userEmail}</p></TableCell><TableCell>{s.projectName ?? 'All projects'}</TableCell><TableCell>{s.disciplineName ?? 'All disciplines'}</TableCell><TableCell>{s.categorisation ?? 'All categorisations'}</TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => remove.mutate({ id: s.id }, { onSuccess: () => { toast({ title: 'Approver scope removed' }); invalidate(); }, onError: fail('Unable to remove approver scope') })}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table>
      {!rows.length && <p className="py-8 text-center text-sm text-muted-foreground">No approver scopes — every eligible approver can approve any lesson.</p>}</CardContent>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Assign approver scope</DialogTitle><DialogDescription>Leave a dimension on "All" to match every value; combine dimensions to narrow the scope.</DialogDescription></DialogHeader><div className="grid gap-3">
      <div><Label>Approver</Label><Select value={form.userId} onValueChange={v => setForm({ ...form, userId: v })}><SelectTrigger><SelectValue placeholder="Select approver" /></SelectTrigger><SelectContent>{(approvers.data ?? []).map(a => <SelectItem key={a.id} value={a.id}>{a.fullName}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Project</Label><Select value={form.projectId} onValueChange={v => setForm({ ...form, projectId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{(refs.data?.projects ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Discipline</Label><Select value={form.disciplineId} onValueChange={v => setForm({ ...form, disciplineId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All disciplines</SelectItem>{(refs.data?.disciplines ?? []).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Categorisation</Label><Select value={form.categorisation} onValueChange={v => setForm({ ...form, categorisation: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categorisations</SelectItem>{categorisations.options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!form.userId || create.isPending} onClick={save}>Save scope</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}

function UsersAccess({ app }: { app: AppKey }) {
  const [accessPage, setAccessPage] = useState(1);
  const api = useAdmin(app, 1, undefined, accessPage); const act = useActions(app); const [search, setSearch] = useState('');
  const platform = useGetPlatformContext();
  const [roleDialog, setRoleDialog] = useState<{ userId: string; editing?: Role }>();
  const [roleId, setRoleId] = useState(''); const [scopeType, setScopeType] = useState<'organization' | 'project'>('organization');
  const [scopeIds, setScopeIds] = useState<string[]>([]); const [projectSearch, setProjectSearch] = useState('');
  const [passwordDialog, setPasswordDialog] = useState<{ id: string; username: string; fullName: string; email?: string | null }>();
  const [passwordForm, setPasswordForm] = useState({ password: '', confirm: '' });
  const [emailDialog, setEmailDialog] = useState<{ id: string; fullName: string; email: string }>();
  const [emailValue, setEmailValue] = useState('');
  const [profileDialog, setProfileDialog] = useState<{ id: string; username: string; fullName: string; signatureUrl?: string | null }>();
  const [profileForm, setProfileForm] = useState({ designation: '', signatureDataUrl: undefined as string | null | undefined });
  const currentUser = useGetCurrentUser();
  const canManagePlatformRoles = ['Super Admin', 'Org Admin'].includes(currentUser.data?.platformRole ?? '');
  const platformRoles = useListPlatformRoles({ query: { queryKey: getListPlatformRolesQueryKey(), enabled: canManagePlatformRoles } });
  const updatePlatformRole = useUpdateUserPlatformRole();
  const profileMutation = {
    onSuccess: () => { act.done('Profile updated'); setProfileDialog(undefined); },
    onError: act.fail,
  };
  const updateLessonsProfile = useUpdateLessonsUserProfile({ mutation: profileMutation });
  const updateAuditProfile = useUpdateAuditUserProfile({ mutation: profileMutation });
  const setTemporaryPassword = useSetUserTemporaryPassword({ mutation: {
    onSuccess: () => {
      act.done('Sign-in password set — the user can now sign in');
      setPasswordDialog(undefined);
      setPasswordForm({ password: '', confirm: '' });
    },
    onError: act.fail,
  } });
  const updateEmail = useUpdateUserEmail({ mutation: {
    onSuccess: () => {
      act.done('User email updated');
      setEmailDialog(undefined);
      setEmailValue('');
      api.users.refetch();
    },
    onError: act.fail,
  } });
  const openPassword = (u: { id: string; username: string; fullName: string; email?: string | null }) => {
    setPasswordDialog(u);
    setPasswordForm({ password: '', confirm: '' });
  };
  const savePassword = () => {
    if (!passwordDialog || passwordForm.password.length < 8 || passwordForm.password !== passwordForm.confirm) return;
    setTemporaryPassword.mutate({ userId: passwordDialog.id, data: { password: passwordForm.password } });
  };
  const openEmail = (u: { id: string; fullName: string; email?: string | null }) => {
    const email = u.email ?? '';
    setEmailDialog({ id: u.id, fullName: u.fullName, email });
    setEmailValue(email);
  };
  const saveEmail = () => {
    if (!emailDialog || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim())) return;
    updateEmail.mutate({ userId: emailDialog.id, data: { email: emailValue.trim() } });
  };
  const openProfile = (u: { id: string; username: string; fullName: string; designation?: string | null; signatureUrl?: string | null }) => { setProfileDialog({ id: u.id, username: u.username, fullName: u.fullName, signatureUrl: u.signatureUrl }); setProfileForm({ designation: u.designation ?? '', signatureDataUrl: undefined }); };
  const saveProfile = () => {
    if (!profileDialog) return;
    const variables = { userId: profileDialog.id, data: { designation: profileForm.designation.trim() || null, ...(profileForm.signatureDataUrl !== undefined ? { signatureDataUrl: profileForm.signatureDataUrl } : {}) } };
    if (app === 'audit') updateAuditProfile.mutate(variables);
    else updateLessonsProfile.mutate(variables);
  };
  const pickSignature = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { act.fail(new Error('Signature must be a PNG, JPEG or WebP image')); return; }
    if (file.size > 512 * 1024) { act.fail(new Error('Signature image exceeds the 512KB limit')); return; }
    const reader = new FileReader();
    reader.onload = () => setProfileForm((f) => ({ ...f, signatureDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  };
  const [delegateOpen, setDelegateOpen] = useState(false);
  const blankDelegation = { projectId: '', delegatorId: '', delegateId: '', lessonFormIds: [] as string[], startDate: '', endDate: '' };
  const [delegation, setDelegation] = useState(blankDelegation);
  const [legacyDelegation, setLegacyDelegation] = useState({ delegatorId: '', delegateId: '', scope: 'all', startDate: '', endDate: '' });
  const delegationOptions = useGetLessonsDelegationOptions({ query: { enabled: app === 'lessons' && delegateOpen, queryKey: getGetLessonsDelegationOptionsQueryKey() } });
  const pendingFormParams = { projectId: delegation.projectId, delegatorId: delegation.delegatorId };
  const pendingForms = useListLessonsDelegationPendingForms(
    pendingFormParams,
    { query: { enabled: app === 'lessons' && delegateOpen && !!delegation.projectId && !!delegation.delegatorId, queryKey: getListLessonsDelegationPendingFormsQueryKey(pendingFormParams) } },
  );
  const users = api.users.data?.items.filter(u => `${u.fullName} ${u.username} ${u.email ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const projects = platform.data?.projects.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(projectSearch.toLowerCase())) ?? [];
  const resetRoleDialog = () => { setRoleDialog(undefined); setRoleId(''); setScopeType('organization'); setScopeIds([]); setProjectSearch(''); };
  const openRoleDialog = (userId: string, editing?: Role) => {
    setRoleDialog({ userId, editing }); setRoleId(editing?.id ?? '');
    setScopeType(editing?.scopeType === 'project' ? 'project' : 'organization');
    setScopeIds(editing?.scopeType === 'project' ? (editing.scopeIds ?? []) : []); setProjectSearch('');
  };
  const saveRole = () => {
    if (!roleDialog || !roleId || (scopeType === 'project' && !scopeIds.length)) return;
    const data: RoleAssignment = { roleId, scopeType, scopeIds: scopeType === 'project' ? scopeIds : [] };
    act.assign.mutate({ userId: roleDialog.userId, data }, { onSuccess: () => { act.done(roleDialog.editing ? 'Role scope updated' : 'Role assigned'); resetRoleDialog(); }, onError: act.fail });
  };
  const removeRole = (userId: string, role: Role) => {
    if (!window.confirm(`Remove the "${role.name}" role from this user?${users.find((u) => u.id === userId)?.workspaceRoles.length === 1 ? ` This will also revoke access to ${names[app]}.` : ''}`)) return;
    act.removeRole.mutate({ userId, id: role.id }, { onSuccess: () => act.done('Role removed'), onError: act.fail });
  };
  const changePlatformRole = (userId: string, roleId: string) => {
    const role = platformRoles.data?.find((item) => item.id === roleId);
    if (!role || !window.confirm(`Change this user's platform role to "${role.name}"? This changes access across all applications.`)) return;
    updatePlatformRole.mutate({ userId, data: { roleId } }, {
      onSuccess: () => act.done(`Platform role changed to ${role.name}`),
      onError: act.fail,
    });
  };
  const createDelegation = () => {
    if (app === 'lessons') {
      if (!delegation.projectId || !delegation.delegatorId || !delegation.delegateId || delegation.delegatorId === delegation.delegateId || !delegation.startDate || !delegation.endDate || delegation.lessonFormIds.length === 0) return;
      act.createDelegation.mutate({ data: delegation } as any, { onSuccess: () => { act.done('Delegation created'); setDelegateOpen(false); setDelegation(blankDelegation); }, onError: act.fail });
      return;
    }
    if (!legacyDelegation.delegatorId || !legacyDelegation.delegateId || !legacyDelegation.startDate || !legacyDelegation.endDate) return;
    const data = { id: crypto.randomUUID(), ...legacyDelegation, status: 'pending' as const };
    act.createDelegation.mutate({ data } as any, { onSuccess: () => { act.done('Delegation created'); setDelegateOpen(false); }, onError: act.fail });
  };
  const changeProject = (projectId: string) => setDelegation((current) => ({ ...current, projectId, delegatorId: '', lessonFormIds: [] }));
  const changeDelegator = (delegatorId: string) => setDelegation((current) => ({ ...current, delegatorId, lessonFormIds: [] }));
  const toggleLesson = (id: string, checked: boolean) => setDelegation((current) => ({ ...current, lessonFormIds: checked ? [...current.lessonFormIds, id] : current.lessonFormIds.filter((value) => value !== id) }));
  const displayedLessonIds = pendingForms.data?.map((form) => form.id) ?? [];
  const allLessonsSelected = displayedLessonIds.length > 0 && displayedLessonIds.every((id) => delegation.lessonFormIds.includes(id));
  const pending = api.access.data?.items.filter(r => r.status === 'pending') ?? [];
  const loading = api.users.isLoading || api.roles.isLoading || api.access.isLoading || api.delegations.isLoading || currentUser.isLoading || (canManagePlatformRoles && platformRoles.isLoading);
  const error = api.users.error || api.roles.error || api.access.error || api.delegations.error || currentUser.error || (canManagePlatformRoles ? platformRoles.error : null);
  return <PageState loading={loading} error={error} onRetry={() => { api.users.refetch(); api.roles.refetch(); api.access.refetch(); api.delegations.refetch(); }}>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Workspace users</CardTitle><CardDescription>Assign application roles and review access.</CardDescription></div><Button onClick={() => setDelegateOpen(true)}><Plus className="mr-2 h-4 w-4" />Delegation</Button></CardHeader><CardContent><div className="relative mb-4 max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="Search user or email" /></div>
      <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Platform role</TableHead><TableHead>Workspace roles</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{users.map(u => <TableRow key={u.id}><TableCell><p className="font-medium">{u.fullName}</p><p className="text-xs text-muted-foreground">{u.email}</p></TableCell><TableCell>{canManagePlatformRoles ? <Select value={platformRoles.data?.find(r => r.name === u.platformRole)?.id ?? ''} disabled={updatePlatformRole.isPending || u.id === currentUser.data?.id} onValueChange={roleId => changePlatformRole(u.id, roleId)}><SelectTrigger className="min-w-44" aria-label={`Platform role for ${u.fullName}`}><SelectValue placeholder={u.platformRole} /></SelectTrigger><SelectContent>{platformRoles.data?.map(role => <SelectItem key={role.id} value={role.id} disabled={role.name === 'Super Admin' && currentUser.data?.platformRole !== 'Super Admin'}>{role.name}</SelectItem>)}</SelectContent></Select> : <Badge variant="outline">{u.platformRole}</Badge>}</TableCell><TableCell><div className="flex flex-col items-start gap-2">{u.workspaceRoles.map(r => { const selectedNames = (r.scopeIds ?? []).map(id => platform.data?.projects.find(p => p.id === id)?.name ?? id); return <div key={r.id} className="flex flex-wrap items-center gap-2"><div><Badge variant="secondary">{r.name}</Badge><p className="text-xs text-muted-foreground">{r.scopeType === 'project' ? `Selected projects: ${selectedNames.join(', ') || 'None'}` : 'Organization-wide'}</p></div><Button type="button" size="sm" variant="outline" onClick={() => openRoleDialog(u.id, r)}>Edit scope</Button><Button type="button" size="sm" variant="outline" className="h-7 border-destructive/50 px-2 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground" disabled={act.removeRole.isPending} onClick={() => removeRole(u.id, r)}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove role</Button></div>; })}{!u.workspaceRoles.length && <span className="text-sm text-muted-foreground">No role assigned</span>}</div></TableCell><TableCell><Badge variant={u.status === 'Active' ? 'default' : 'secondary'}>{u.status}</Badge></TableCell><TableCell className="space-x-2"><Button size="sm" variant="outline" onClick={() => openRoleDialog(u.id)}>Assign role</Button><Button size="sm" variant="outline" onClick={() => openEmail(u)}>Edit email</Button><Button size="sm" variant="outline" onClick={() => openPassword(u)}><KeyRound className="mr-1 h-4 w-4" />Set password</Button>{(app === 'lessons' || app === 'audit') && <Button size="sm" variant="ghost" onClick={() => openProfile(u)}>Edit profile</Button>}</TableCell></TableRow>)}</TableBody></Table>
      {!users.length && <p className="py-10 text-center text-sm text-muted-foreground">No users match this search.</p>}</CardContent></Card>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle>Access request queue</CardTitle><CardDescription>Approve or reject pending requests.</CardDescription></CardHeader><CardContent className="space-y-3">{pending.map(r => <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="min-w-0 flex-1"><p className="font-medium">{r.fullName ?? 'Unavailable user'}</p><p className="truncate text-xs text-muted-foreground">@{r.username}{r.email ? ` · ${r.email}` : ' · Email unavailable'}</p><p className="text-xs text-muted-foreground">Requested {new Date(r.requestedAt).toLocaleDateString()}</p></div><Button size="sm" disabled={act.decide.isPending} onClick={() => act.decide.mutate({ id: r.id, data: { decision: 'approve' } }, { onSuccess: () => act.done('Access approved'), onError: act.fail })}><Check className="mr-1 h-4 w-4" />Approve</Button><Button size="sm" variant="outline" disabled={act.decide.isPending} onClick={() => act.decide.mutate({ id: r.id, data: { decision: 'reject' } }, { onSuccess: () => act.done('Access rejected'), onError: act.fail })}>Reject</Button></div>)}{!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No pending access requests.</p>}{app === 'audit' && (api.access.data?.total ?? 0) > 0 && <div className="flex items-center justify-between gap-2 pt-2 text-sm"><span>{api.access.data?.total} pending · Page {accessPage}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={accessPage === 1} onClick={() => setAccessPage(p => p - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={accessPage * 20 >= (api.access.data?.total ?? 0)} onClick={() => setAccessPage(p => p + 1)}>Next</Button></div></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Delegations</CardTitle><CardDescription>Access expires automatically at the end date.</CardDescription></CardHeader><CardContent className="space-y-3">{api.delegations.data?.items.map((d: any) => <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="min-w-0 flex-1">{app === 'lessons' ? <p className="font-medium">{d.delegatorName} → {d.delegateName}</p> : <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"><DelegationPerson name={d.delegatorFullName} username={d.delegatorUsername} email={d.delegatorEmail} status={d.delegatorUserStatus} fallbackId={d.delegatorId} /><span className="text-muted-foreground" aria-hidden="true">→</span><DelegationPerson name={d.delegateFullName} username={d.delegateUsername} email={d.delegateEmail} status={d.delegateUserStatus} fallbackId={d.delegateId} /></div>}<p className="mt-2 text-xs text-muted-foreground">{app === 'lessons' ? `${d.projectName} · ${d.lessonForms.length} selected form${d.lessonForms.length === 1 ? '' : 's'}${d.lessonForms.length <= 2 ? ` (${d.lessonForms.map((form: any) => form.referenceNumber).join(', ')})` : ''}` : d.scope} · expires {new Date(d.endDate).toLocaleDateString()}</p></div><Badge variant={d.status === 'active' ? 'default' : 'secondary'}>{d.status}</Badge>{['active', 'pending'].includes(d.status) && <Button size="icon" variant="ghost" onClick={() => act.revoke.mutate({ id: d.id }, { onSuccess: () => act.done('Delegation revoked'), onError: act.fail })}><Trash2 className="h-4 w-4" /></Button>}</div>)}{!api.delegations.data?.items.length && <p className="py-8 text-center text-sm text-muted-foreground">No delegations configured.</p>}</CardContent></Card></div>
    {app === 'lessons' && <ApproverScopes />}
    <Dialog open={!!roleDialog} onOpenChange={open => !open && resetRoleDialog()}><DialogContent><DialogHeader><DialogTitle>{roleDialog?.editing ? 'Edit role scope' : 'Assign workspace role'}</DialogTitle><DialogDescription>Assignment applies only to {names[app]}.</DialogDescription></DialogHeader><div className="grid gap-3"><div><Label>Role</Label><Select value={roleId} onValueChange={setRoleId} disabled={!!roleDialog?.editing}><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger><SelectContent>{api.roles.data?.items.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Access scope</Label><Select value={scopeType} onValueChange={v => { setScopeType(v as 'organization' | 'project'); if (v === 'organization') setScopeIds([]); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="organization">Organization-wide</SelectItem><SelectItem value="project">Selected projects</SelectItem></SelectContent></Select></div>{scopeType === 'project' && <div className="rounded-md border p-3"><Input value={projectSearch} onChange={e => setProjectSearch(e.target.value)} placeholder="Search projects" /><div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{projects.map(p => <label key={p.id} className="flex items-center gap-2 text-sm"><Checkbox checked={scopeIds.includes(p.id)} onCheckedChange={checked => setScopeIds(ids => checked ? [...new Set([...ids, p.id])] : ids.filter(id => id !== p.id))} /><span>{p.name} <span className="text-muted-foreground">({p.code})</span></span></label>)}{!projects.length && <p className="text-sm text-muted-foreground">No projects found.</p>}</div>{!scopeIds.length && <p className="mt-2 text-xs text-destructive">Select at least one project.</p>}</div>}</div><DialogFooter><Button variant="outline" onClick={resetRoleDialog}>Cancel</Button><Button disabled={!roleId || (scopeType === 'project' && !scopeIds.length) || act.assign.isPending} onClick={saveRole}>{roleDialog?.editing ? 'Save scope' : 'Assign'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!passwordDialog} onOpenChange={open => !open && setPasswordDialog(undefined)}><DialogContent><DialogHeader><DialogTitle>Set password — {passwordDialog?.username}</DialogTitle><DialogDescription>Set a sign-in password for {passwordDialog?.email ?? 'this imported user'}. Share it securely; it remains valid until an administrator replaces it.</DialogDescription></DialogHeader><div className="grid gap-3"><div><Label htmlFor="sign-in-password">Sign-in password</Label><Input id="sign-in-password" type="password" minLength={8} maxLength={128} autoComplete="new-password" value={passwordForm.password} onChange={e => setPasswordForm({ ...passwordForm, password: e.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Use at least 8 characters. Do not reuse your own password.</p></div><div><Label htmlFor="confirm-sign-in-password">Confirm password</Label><Input id="confirm-sign-in-password" type="password" minLength={8} maxLength={128} autoComplete="new-password" value={passwordForm.confirm} onChange={e => setPasswordForm({ ...passwordForm, confirm: e.target.value })} />{passwordForm.confirm && passwordForm.password !== passwordForm.confirm && <p className="mt-1 text-xs text-destructive">Passwords do not match.</p>}</div></div><DialogFooter><Button variant="outline" onClick={() => setPasswordDialog(undefined)}>Cancel</Button><Button disabled={passwordForm.password.length < 8 || passwordForm.password !== passwordForm.confirm || setTemporaryPassword.isPending} onClick={savePassword}>{setTemporaryPassword.isPending ? 'Saving…' : 'Set password'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!emailDialog} onOpenChange={open => !open && setEmailDialog(undefined)}><DialogContent><DialogHeader><DialogTitle>Edit email — {emailDialog?.fullName}</DialogTitle><DialogDescription>This email is used for sign-in and system notifications. The user must use the new address the next time they sign in.</DialogDescription></DialogHeader><div className="grid gap-2"><Label htmlFor="user-email">Email address</Label><Input id="user-email" type="email" autoComplete="off" maxLength={320} value={emailValue} onChange={e => setEmailValue(e.target.value)} />{emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim()) && <p className="text-xs text-destructive">Enter a valid email address.</p>}</div><DialogFooter><Button variant="outline" onClick={() => setEmailDialog(undefined)}>Cancel</Button><Button disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim()) || emailValue.trim().toLowerCase() === emailDialog?.email.toLowerCase() || updateEmail.isPending} onClick={saveEmail}>{updateEmail.isPending ? 'Saving…' : 'Save email'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!profileDialog} onOpenChange={open => !open && setProfileDialog(undefined)}><DialogContent><DialogHeader><DialogTitle>Edit profile — {profileDialog?.username}</DialogTitle><DialogDescription>Designation and signature appear on {app === 'audit' ? 'Audit Programme sign-off reports' : 'lesson approval records'}.</DialogDescription></DialogHeader><div className="grid gap-3"><div><Label>Designation</Label><Input value={profileForm.designation} onChange={e => setProfileForm({ ...profileForm, designation: e.target.value })} placeholder="e.g. QA/QC Manager" /></div><div><Label>Signature image</Label><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => pickSignature(e.target.files)} />{profileForm.signatureDataUrl ? <img src={profileForm.signatureDataUrl} alt="Signature preview" className="mt-2 h-12 rounded border bg-white object-contain p-1" /> : profileDialog?.signatureUrl ? <p className="mt-1 text-xs text-muted-foreground">Signature on file. Upload a new image to replace it.</p> : null}<p className="mt-1 text-xs text-muted-foreground">PNG, JPEG or WebP up to 512KB. Uploading replaces the current signature.</p></div></div><DialogFooter><Button variant="outline" onClick={() => setProfileDialog(undefined)}>Cancel</Button><Button disabled={updateLessonsProfile.isPending || updateAuditProfile.isPending} onClick={saveProfile}>Save</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={delegateOpen} onOpenChange={setDelegateOpen}><DialogContent className={app === 'lessons' ? 'max-w-2xl' : undefined}><DialogHeader><DialogTitle>Create delegation</DialogTitle><DialogDescription>Delegate access for a fixed period. It expires automatically.</DialogDescription></DialogHeader>{app === 'lessons' ? <div className="grid gap-4">
      <div><Label>Project</Label><Select value={delegation.projectId} onValueChange={changeProject} disabled={delegationOptions.isLoading}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{delegationOptions.data?.projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>{delegationOptions.isError && <p className="mt-1 text-xs text-destructive">Projects and users could not be loaded.</p>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label>Delegator</Label><Select value={delegation.delegatorId} onValueChange={changeDelegator} disabled={!delegation.projectId}><SelectTrigger><SelectValue placeholder="Select delegator" /></SelectTrigger><SelectContent>{delegationOptions.data?.users.map(user => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Delegate</Label><Select value={delegation.delegateId} onValueChange={delegateId => setDelegation(current => ({ ...current, delegateId }))} disabled={!delegation.projectId}><SelectTrigger><SelectValue placeholder="Select delegate" /></SelectTrigger><SelectContent>{delegationOptions.data?.users.filter(user => user.id !== delegation.delegatorId).map(user => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div></div>
      <section className="rounded-lg border p-3"><div className="mb-3 flex items-center justify-between"><div><p className="font-medium">Lessons pending with Delegator</p><p className="text-xs text-muted-foreground">Only selected forms will be available to the delegate.</p></div>{displayedLessonIds.length > 0 && <label className="flex items-center gap-2 text-sm"><Checkbox checked={allLessonsSelected} onCheckedChange={checked => setDelegation(current => ({ ...current, lessonFormIds: checked === true ? displayedLessonIds : [] }))} />Select all</label>}</div>
        {!delegation.projectId || !delegation.delegatorId ? <p className="py-5 text-center text-sm text-muted-foreground">Select a project and delegator to see pending forms.</p> : pendingForms.isLoading ? <p className="py-5 text-center text-sm text-muted-foreground">Loading pending lessons…</p> : pendingForms.isError ? <div className="py-4 text-center"><p className="text-sm text-destructive">Pending lessons could not be loaded.</p><Button className="mt-2" size="sm" variant="outline" onClick={() => pendingForms.refetch()}>Retry</Button></div> : !pendingForms.data?.length ? <p className="py-5 text-center text-sm text-muted-foreground">No lesson forms are currently awaiting this delegator.</p> : <div className="max-h-52 space-y-2 overflow-y-auto">{pendingForms.data.map(form => <label key={form.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><Checkbox checked={delegation.lessonFormIds.includes(form.id)} onCheckedChange={checked => toggleLesson(form.id, checked === true)} /><span><span className="block text-sm font-medium">{form.referenceNumber}</span><span className="block text-xs text-muted-foreground">{form.title}</span></span></label>)}</div>}
      </section>
      <div className="grid grid-cols-2 gap-3"><div><Label>Starts</Label><Input type="date" value={delegation.startDate} onChange={e => setDelegation({ ...delegation, startDate: e.target.value })} /></div><div><Label>Expires</Label><Input type="date" min={delegation.startDate} value={delegation.endDate} onChange={e => setDelegation({ ...delegation, endDate: e.target.value })} /></div></div>
    </div> : <div className="grid gap-3"><Label>Delegator user ID</Label><Input value={legacyDelegation.delegatorId} onChange={e => setLegacyDelegation({ ...legacyDelegation, delegatorId: e.target.value })} /><Label>Delegate user ID</Label><Input value={legacyDelegation.delegateId} onChange={e => setLegacyDelegation({ ...legacyDelegation, delegateId: e.target.value })} /><Label>Scope</Label><Input value={legacyDelegation.scope} onChange={e => setLegacyDelegation({ ...legacyDelegation, scope: e.target.value })} /><div className="grid grid-cols-2 gap-3"><div><Label>Starts</Label><Input type="date" value={legacyDelegation.startDate} onChange={e => setLegacyDelegation({ ...legacyDelegation, startDate: e.target.value })} /></div><div><Label>Expires</Label><Input type="date" value={legacyDelegation.endDate} onChange={e => setLegacyDelegation({ ...legacyDelegation, endDate: e.target.value })} /></div></div></div>}<DialogFooter><Button variant="outline" onClick={() => setDelegateOpen(false)}>Cancel</Button><Button disabled={act.createDelegation.isPending || (app === 'lessons' && (!delegation.projectId || !delegation.delegatorId || !delegation.delegateId || delegation.delegatorId === delegation.delegateId || !delegation.startDate || !delegation.endDate || delegation.endDate < delegation.startDate || delegation.lessonFormIds.length === 0))} onClick={createDelegation}>{act.createDelegation.isPending ? 'Creating…' : 'Create delegation'}</Button></DialogFooter></DialogContent></Dialog>
  </PageState>;
}

const basePermissionLabels: Record<PermissionKey, string> = { data_entry: 'Create / edit', create_audit_programme: 'Create Audit Programme', submit: 'Submit', approve_reject: 'Approve / reject', view_own_scope: 'View own', view_all: 'View all', configure_masters: 'Configure', manage_integrations: 'Integrations', manage_ai_settings: 'VerionAI settings', export: 'Export', delegate: 'Delegate', memo_circulation: 'Memo Circulation', audit_team_lead: 'Audit Team Lead', audit_program_manager: 'Audit Program Manager', product_process_owner: 'Product / Process Owner' };
type RoleWithAuthorizationLevel = Role & { roleAuthorizationLevel?: number | null };
function Roles({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [editing, setEditing] = useState<RoleWithAuthorizationLevel>();
  const [authorizationLevelInput, setAuthorizationLevelInput] = useState('');
  const permissionLabels = app === 'audit'
    ? { ...basePermissionLabels, data_entry: 'Create / edit schedules', create_audit_programme: 'Create Audit Programme (org-wide)' }
    : basePermissionLabels;
  const permissionKeys = (Object.keys(permissionLabels) as PermissionKey[]).filter(key => app === 'audit' || (key !== 'create_audit_programme' && key !== 'audit_team_lead' && key !== 'audit_program_manager' && key !== 'product_process_owner'));
  const hasApproveReject = !!editing?.permissions.some(p => p.key === 'approve_reject');
  const parsedAuthorizationLevel = /^\d+$/.test(authorizationLevelInput) ? Number(authorizationLevelInput) : NaN;
  const validAuthorizationLevel = Number.isSafeInteger(parsedAuthorizationLevel) && parsedAuthorizationLevel > 0 && parsedAuthorizationLevel <= 2147483647;
  const newRole = () => {
    setAuthorizationLevelInput('');
    setEditing({ id: crypto.randomUUID(), name: '', description: '', active: true, permissions: [], roleAuthorizationLevel: null });
  };
  const togglePermission = (key: PermissionKey) => {
    if (!editing) return;
    const selected = editing.permissions.some(p => p.key === key);
    const permissions = selected ? editing.permissions.filter(p => p.key !== key) : [...editing.permissions, { key, name: permissionLabels[key] }];
    if (app === 'audit' && key === 'approve_reject' && selected) {
      setAuthorizationLevelInput('');
      setEditing({ ...editing, permissions, roleAuthorizationLevel: null });
      return;
    }
    setEditing({ ...editing, permissions });
  };
  const save = () => {
    if (!editing?.name.trim()) return;
    if (app === 'audit' && hasApproveReject && !validAuthorizationLevel) return;
    const exists = api.roles.data?.items.some(r => r.id === editing.id);
    const mutation = exists ? act.updateRole : act.createRole;
    const data = app === 'audit' ? { ...editing, roleAuthorizationLevel: hasApproveReject ? parsedAuthorizationLevel : null } : editing;
    const variables = exists ? { id: editing.id, data } : { data };
    mutation.mutate(variables as never, { onSuccess: () => { act.done(exists ? 'Role updated' : 'Role created'); setEditing(undefined); }, onError: act.fail });
  };
  return <PageState loading={api.roles.isLoading} error={api.roles.error} empty={!api.roles.data?.items.length} onRetry={api.roles.refetch}>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Roles & permission matrix</CardTitle><CardDescription>{app === 'audit' ? 'Set a positive Approval Level on each role with Approve / reject. Sequential schedule approvals are ordered by this level, not by role name.' : 'Full capabilities can be narrowed by assignment scope to Own or Select.'}</CardDescription></div><Button onClick={newRole}><Plus className="mr-2 h-4 w-4" />Custom role</Button></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Role</TableHead>{permissionKeys.map(key => <TableHead key={key} className="text-center text-xs">{permissionLabels[key]}</TableHead>)}{app === 'audit' && <TableHead className="text-center text-xs">Approval Level</TableHead>}</TableRow></TableHeader><TableBody>{api.roles.data?.items.map(r => <TableRow key={r.id} className="cursor-pointer" onClick={() => { setAuthorizationLevelInput(String((r as RoleWithAuthorizationLevel).roleAuthorizationLevel ?? '')); setEditing(r); }}><TableCell><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.systemDefault ? 'System default' : 'Custom'}</p></TableCell>{permissionKeys.map(key => <TableCell key={key} className="text-center">{r.permissions.some(p => p.key === key) ? <Badge>{key === 'audit_team_lead' || key === 'audit_program_manager' || key === 'product_process_owner' ? 'Yes' : 'Full'}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>)}{app === 'audit' && <TableCell className="text-center" data-testid={`text-role-authorization-level-${r.id}`}>{r.permissions.some(p => p.key === 'approve_reject') && (r as RoleWithAuthorizationLevel).roleAuthorizationLevel != null ? (r as RoleWithAuthorizationLevel).roleAuthorizationLevel : <span className="text-muted-foreground">—</span>}</TableCell>}</TableRow>)}</TableBody></Table></CardContent></Card>
    <Dialog open={!!editing} onOpenChange={open => !open && setEditing(undefined)}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{editing?.name ? 'Edit role' : 'Build a custom role'}</DialogTitle><DialogDescription>Select capability primitives. Scope is chosen when assigning the role (Full, Own, or Select).</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><div><Label>Role name</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} disabled={editing.systemDefault} /></div><div><Label>Description</Label><Textarea value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{permissionKeys.map(key => <label key={key} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><Checkbox checked={editing.permissions.some(p => p.key === key)} onCheckedChange={() => togglePermission(key)} /><span>{permissionLabels[key]}</span></label>)}</div>{app === 'audit' && hasApproveReject && <div className="space-y-1"><Label htmlFor="audit-authorization-level">Approval Level</Label><Input id="audit-authorization-level" data-testid="input-audit-authorization-level" type="number" min="1" max="2147483647" step="1" inputMode="numeric" value={authorizationLevelInput} aria-invalid={!validAuthorizationLevel} aria-describedby="audit-authorization-level-error" onChange={e => { const value = e.target.value; setAuthorizationLevelInput(value); const level = /^\d+$/.test(value) ? Number(value) : NaN; setEditing({ ...editing, roleAuthorizationLevel: Number.isSafeInteger(level) && level > 0 && level <= 2147483647 ? level : null }); }} /><p id="audit-authorization-level-error" data-testid="text-audit-authorization-level-error" className="text-xs text-destructive">{validAuthorizationLevel ? '' : 'Enter a positive whole number no greater than 2,147,483,647.'}</p></div>}{app === 'audit' && <p className="text-xs text-muted-foreground">Audit Team Lead and Audit Program Manager identify roles for future workflows; neither grants extra actions yet.</p>}<label className="flex items-center gap-3"><Toggle checked={editing.active} onCheckedChange={active => setEditing({ ...editing, active })} />Role enabled</label></div>}<DialogFooter><Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button><Button onClick={save} disabled={!editing?.name.trim() || (app === 'audit' && hasApproveReject && !validAuthorizationLevel)}><Save className="mr-2 h-4 w-4" />Save role</Button></DialogFooter></DialogContent></Dialog>
  </PageState>;
}

// Triggers the background escalation engine (artifacts/api-server/src/lib/escalation.ts)
// actually evaluates per application — keep in sync with evaluateEscalations.
const triggerMeta: Record<string, { label: string; description: string }> = {
  approval_delay: { label: 'Approval delay', description: 'A record waits too long for approval' },
  lesson_sla: { label: 'Lesson SLA breach', description: 'A lesson stays unresolved past its SLA' },
  performance: { label: 'Performance below target', description: 'Closure rate stays under the benchmark' },
  finding_priority: { label: 'Finding priority ageing', description: 'Open findings age and climb priority' },
};
const appTriggers: Record<AppKey, string[]> = {
  qaqc: ['approval_delay', 'performance'],
  lessons: ['lesson_sla'],
  audit: ['approval_delay', 'finding_priority'],
};
const levelOptions = ['P2', 'P1', 'L1', 'L2', 'L3'];
const recommendedRules: Record<AppKey, Omit<EscalationRule, 'id'>[]> = {
  qaqc: [
    { triggerType: 'approval_delay', priority: 'P2', level: 'P2', slaWorkingDays: 3, recipientRoles: ['Quality Manager'], ccRecipientRoles: [], repeatCadenceDays: 2, enabled: true },
    { triggerType: 'performance', priority: 'L1', level: 'L1', slaWorkingDays: 0, recipientRoles: ['Quality Manager'], ccRecipientRoles: [], repeatCadenceDays: 2, enabled: true },
  ],
  lessons: [{ triggerType: 'lesson_sla', priority: 'P1', level: 'P1', slaWorkingDays: 5, recipientRoles: ['Quality Manager'], ccRecipientRoles: [], repeatCadenceDays: 3, enabled: true }],
  audit: [
    { triggerType: 'approval_delay', priority: 'P2', level: 'P2', slaWorkingDays: 3, recipientRoles: ['Audit Manager'], ccRecipientRoles: [], repeatCadenceDays: 2, enabled: true },
    { triggerType: 'finding_priority', priority: 'P1', level: 'P1', slaWorkingDays: 2, recipientRoles: ['Audit Manager'], ccRecipientRoles: [], repeatCadenceDays: 2, enabled: true },
  ],
};

function Escalations({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [draft, setDraft] = useState<EscalationRule[]>();
  const rows = draft ?? api.escalations.data?.items ?? [];
  const patch = (id: string, value: Partial<EscalationRule>) => setDraft(rows.map(r => r.id === id ? { ...r, ...value } : r));
  const addRule = () => setDraft([...rows, { id: crypto.randomUUID(), triggerType: appTriggers[app][0]!, priority: 'L1', level: 'L1', slaWorkingDays: 3, recipientRoles: [], ccRecipientRoles: [], repeatCadenceDays: 2, enabled: true }]);
  const removeRule = (id: string) => setDraft(rows.filter(r => r.id !== id));
  const loadDefaults = () => setDraft(recommendedRules[app].map(r => ({ ...r, id: crypto.randomUUID(), recipientRoles: [...r.recipientRoles] })));
  // unstaffedRoles is computed server-side from active role memberships; the
  // name-existence fallback covers unsaved draft rows.
  const roleNames = new Set((api.roles.data?.items ?? []).map((role) => role.name as string));
  const activeRoleNames = (api.roles.data?.items ?? []).filter((role) => role.active).map((role) => role.name);
  const toggleRole = (rule: EscalationRule, roleName: string, checked: boolean) => {
    const recipientRoles = checked
      ? [...new Set([...rule.recipientRoles, roleName])]
      : rule.recipientRoles.filter((name) => name !== roleName);
    patch(rule.id, { recipientRoles });
  };
  const toggleCcRole = (rule: EscalationRule, roleName: string, checked: boolean) => {
    const current = rule.ccRecipientRoles ?? [];
    const ccRecipientRoles = checked
      ? [...new Set([...current, roleName])]
      : current.filter((name) => name !== roleName);
    patch(rule.id, { ccRecipientRoles });
  };
  const unstaffed = (r: EscalationRule) => r.unstaffedRoles ?? (roleNames.size ? r.recipientRoles.filter((n) => !roleNames.has(n)) : []);
  const unstaffedCc = (r: EscalationRule) => r.unstaffedCcRoles ?? (roleNames.size ? (r.ccRecipientRoles ?? []).filter((n) => !roleNames.has(n)) : []);
  const save = () => act.escalation.mutate({ data: rows }, { onSuccess: () => { act.done('Escalation rules saved'); setDraft(undefined); api.escalations.refetch(); }, onError: act.fail });
  return <PageState loading={api.escalations.isLoading} error={api.escalations.error} onRetry={api.escalations.refetch}>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Escalation rules</CardTitle><CardDescription>The workflow engine checks these rules every 15 minutes. When a record breaches its threshold, the target roles are notified in-app and by email, and the escalation advances through levels until resolved.</CardDescription></div><div className="flex shrink-0 gap-2"><Button variant="outline" onClick={loadDefaults}>Load recommended</Button><Button variant="outline" onClick={addRule}><Plus className="mr-2 h-4 w-4" />Add rule</Button><Button disabled={!draft || act.escalation.isPending} onClick={save}><Save className="mr-2 h-4 w-4" />Save changes</Button></div></CardHeader>
      <CardContent>{!rows.length ? <div className="py-12 text-center"><Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">No escalation rules yet</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Nothing escalates until at least one rule is enabled. Add a rule or load the recommended set for {names[app]}.</p><div className="mt-4 flex justify-center gap-2"><Button variant="outline" onClick={loadDefaults}>Load recommended</Button><Button onClick={addRule}><Plus className="mr-2 h-4 w-4" />Add rule</Button></div></div> :
        <Table><TableHeader><TableRow><TableHead>Trigger</TableHead><TableHead>First level</TableHead><TableHead>Threshold (working days)</TableHead><TableHead>Target roles</TableHead><TableHead>CC roles</TableHead><TableHead>Repeat (days)</TableHead><TableHead>Enabled</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{rows.map(r => <TableRow key={r.id}>
            <TableCell><Select value={r.triggerType} onValueChange={v => patch(r.id, { triggerType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{appTriggers[app].map(v => <SelectItem value={v} key={v}>{triggerMeta[v]?.label ?? v}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">{triggerMeta[r.triggerType]?.description}</p></TableCell>
            <TableCell><Select value={r.priority ?? r.level ?? 'L1'} onValueChange={v => patch(r.id, { priority: v, level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{levelOptions.map(v => <SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select></TableCell>
            <TableCell><Input type="number" min={0} value={r.slaWorkingDays} onChange={e => patch(r.id, { slaWorkingDays: Math.max(0, Number(e.target.value) || 0) })} /></TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="w-full min-w-56 justify-between font-normal">
                    <span className="truncate">{r.recipientRoles.length ? r.recipientRoles.join(', ') : 'Select target roles'}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  {[...new Set([...activeRoleNames, ...r.recipientRoles])].map(roleName => (
                    <DropdownMenuCheckboxItem
                      key={roleName}
                      checked={r.recipientRoles.includes(roleName)}
                      onSelect={event => event.preventDefault()}
                      onCheckedChange={checked => toggleRole(r, roleName, checked === true)}
                    >
                      {roleName}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {!activeRoleNames.length && !r.recipientRoles.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">No active workspace roles</p>}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="mt-1 text-xs text-muted-foreground">Select one or more workspace roles</p>
              {unstaffed(r).length > 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">No active members for: {unstaffed(r).join(', ')} — escalations fall back to the initial admins.</p>}
            </TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="w-full min-w-56 justify-between font-normal">
                    <span className="truncate">{r.ccRecipientRoles?.length ? r.ccRecipientRoles.join(', ') : 'Select CC roles'}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  {[...new Set([...activeRoleNames, ...(r.ccRecipientRoles ?? [])])].map(roleName => (
                    <DropdownMenuCheckboxItem
                      key={roleName}
                      checked={(r.ccRecipientRoles ?? []).includes(roleName)}
                      onSelect={event => event.preventDefault()}
                      onCheckedChange={checked => toggleCcRole(r, roleName, checked === true)}
                    >
                      {roleName}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {!activeRoleNames.length && !r.ccRecipientRoles?.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">No active workspace roles</p>}
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="mt-1 text-xs text-muted-foreground">Email CC only; no in-app escalation</p>
              {unstaffedCc(r).length > 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">No active members for: {unstaffedCc(r).join(', ')}</p>}
            </TableCell>
            <TableCell><Input type="number" min={1} value={r.repeatCadenceDays} onChange={e => patch(r.id, { repeatCadenceDays: Math.max(1, Number(e.target.value) || 1) })} /></TableCell>
            <TableCell><Toggle checked={r.enabled} onCheckedChange={enabled => patch(r.id, { enabled })} /></TableCell>
            <TableCell><Button size="icon" variant="ghost" onClick={() => removeRule(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
          </TableRow>)}</TableBody></Table>}
       </CardContent></Card>
       {app === 'lessons' && <LessonsDigestJob api={api as any} act={act as any} />}
   </PageState>;
}

function LessonsDigestJob({ api, act }: { api: ReturnType<typeof useAdmin> & { job: any }; act: ReturnType<typeof useActions> }) {
  const source = api.job?.data;
  const [draft, setDraft] = useState<any>();
  const value = draft ?? source;
  if (!value) return null;
  const save = () => act.job.mutate({ data: value }, { onSuccess: () => { act.done('Lessons approval digest saved'); setDraft(undefined); api.job.refetch(); }, onError: act.fail });
  return <Card className="mt-5"><CardHeader><CardTitle>Pending approval digest</CardTitle><CardDescription>QMS360 sends a grouped tabular summary of submitted Lessons Learned forms that remain unapproved. The schedule uses the tenant timezone ({value.timezone}).</CardDescription></CardHeader><CardContent className="space-y-4">
    <label className="flex items-center justify-between rounded-lg border p-4"><span><b>Enable scheduled report</b><span className="block text-sm text-muted-foreground">Only submitted forms are included; approved, sent-back, and draft forms are excluded.</span></span><Toggle checked={value.enabled} onCheckedChange={enabled => setDraft({ ...value, enabled })} /></label>
    <div className="grid gap-4 md:grid-cols-3">
      <div><Label>Report</Label><Select value={value.reportKey} onValueChange={reportKey => setDraft({ ...value, reportKey })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending_lessons_approval">Pending Lessons approvals</SelectItem></SelectContent></Select></div>
      <div><Label>Frequency</Label><Select value={value.frequency} onValueChange={frequency => setDraft({ ...value, frequency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['custom','daily','weekly','monthly'].map(item => <SelectItem key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Run time</Label><Input type="time" value={value.time} onChange={event => setDraft({ ...value, time: event.target.value })} /></div>
    </div>
    {value.frequency === 'weekly' && <div><Label>Weekly day (0 Sunday – 6 Saturday)</Label><Input type="number" min={0} max={6} value={value.weeklyDay} onChange={event => setDraft({ ...value, weeklyDay: Number(event.target.value) })} /></div>}
    {value.frequency === 'monthly' && <div><Label>Monthly day</Label><Input type="number" min={1} max={31} value={value.monthlyDay} onChange={event => setDraft({ ...value, monthlyDay: Number(event.target.value) })} /></div>}
    {value.frequency === 'custom' && <div><Label>Custom interval (minutes, minimum 15)</Label><Input type="number" min={15} value={value.customIntervalMinutes} onChange={event => setDraft({ ...value, customIntervalMinutes: Number(event.target.value) })} /></div>}
    <div className="flex flex-wrap items-center gap-2"><Button disabled={!draft || act.job.isPending} onClick={save}><Save className="mr-2 h-4 w-4" />Save schedule</Button><Button variant="outline" disabled={act.runJob.isPending} onClick={() => act.runJob.mutate(undefined as any, { onSuccess: () => { act.done('Lessons approval digest queued'); api.job.refetch(); }, onError: act.fail })}>Run now</Button><span className="text-sm text-muted-foreground">Last run: {value.lastRunAt ? new Date(value.lastRunAt).toLocaleString() : 'Never'} · Next run: {value.nextRunAt ? new Date(value.nextRunAt).toLocaleString() : 'Not scheduled'}</span></div>
  </CardContent></Card>;
}

function AiSettings({ app }: { app: Exclude<AppKey, 'audit'> }) {
  const api = useAdmin(app); const act = useActions(app); const [draft, setDraft] = useState<AISettings>();
  const value = draft ?? api.ai?.data;
  if (!api.ai || !act.ai) return null;
  return <PageState loading={api.ai.isLoading} error={api.ai.error} onRetry={api.ai.refetch}>{value && <div className="grid gap-5 lg:grid-cols-[1fr_.7fr]"><Card><CardHeader><CardTitle>AI provider & model</CardTitle><CardDescription>Controls apply only to this application. Credentials remain in the Integration Cockpit and are never displayed here.</CardDescription></CardHeader><CardContent className="space-y-4"><label className="flex items-center justify-between rounded-lg border p-4"><span><b>Enable VerionAI assistance</b><span className="block text-sm text-muted-foreground">Allow configured VerionAI features.</span></span><Toggle checked={value.enabled} onCheckedChange={enabled => setDraft({ ...value, enabled })} /></label><div className="grid gap-4 md:grid-cols-2"><div><Label>Provider</Label><Input value={value.provider} onChange={e => setDraft({ ...value, provider: e.target.value })} /></div><div><Label>Model</Label><Input value={value.model} onChange={e => setDraft({ ...value, model: e.target.value })} /></div><div><Label>Timeout (seconds)</Label><Input type="number" min={1} value={value.timeoutSeconds} onChange={e => setDraft({ ...value, timeoutSeconds: Number(e.target.value) })} /></div><div><Label>Retention (days)</Label><Input type="number" min={0} value={value.retentionDays ?? 0} onChange={e => setDraft({ ...value, retentionDays: Number(e.target.value) })} /></div></div><Button disabled={!draft || act.ai.isPending} onClick={() => act.ai?.mutate({ data: value }, { onSuccess: () => { act.done('VerionAI settings saved'); setDraft(undefined); }, onError: act.fail })}><Save className="mr-2 h-4 w-4" />Save settings</Button></CardContent></Card><Card><CardHeader><CardTitle>Features & privacy</CardTitle></CardHeader><CardContent className="space-y-3">{Object.entries(value.features).map(([key, enabled]) => <label key={key} className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium">{key.replaceAll('_', ' ')}</span><Toggle checked={enabled} onCheckedChange={checked => setDraft({ ...value, features: { ...value.features, [key]: checked } })} /></label>)}<label className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium">Strip personal data</span><Toggle checked={value.stripPersonalData ?? false} onCheckedChange={stripPersonalData => setDraft({ ...value, stripPersonalData })} /></label></CardContent></Card></div>}</PageState>;
}

function Notifications({ app }: { app: AppKey }) {
  const api = useAdmin(app); const act = useActions(app); const [editing, setEditing] = useState<NotificationTemplate>();
  const save = () => editing && act.template.mutate({ id: editing.id, data: editing }, { onSuccess: () => { act.done('Notification template saved'); setEditing(undefined); }, onError: act.fail });
  return <PageState loading={api.templates.isLoading} error={api.templates.error} empty={!api.templates.data?.items.length} onRetry={api.templates.refetch}><Card><CardHeader><CardTitle>Notification templates</CardTitle><CardDescription>Manage application-specific subject, body, channels and availability.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Subject</TableHead><TableHead>Channels</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{api.templates.data?.items.map(t => <TableRow key={t.id}><TableCell className="font-medium">{t.key}</TableCell><TableCell>{t.subject}</TableCell><TableCell className="space-x-1">{t.channels.map(c => <Badge variant="secondary" key={c}>{c}</Badge>)}</TableCell><TableCell><Badge variant={t.enabled ? 'default' : 'secondary'}>{t.enabled ? 'Enabled' : 'Disabled'}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Dialog open={!!editing} onOpenChange={open => !open && setEditing(undefined)}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Edit notification template</DialogTitle><DialogDescription>Merge fields are preserved when the message is sent.</DialogDescription></DialogHeader>{editing && <div className="space-y-4"><div><Label>Subject</Label><Input value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} /></div><div><Label>Body template</Label><Textarea rows={8} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} /></div><div><Label>Channel</Label><Select value={editing.channels[0] ?? 'in_app'} onValueChange={v => setEditing({ ...editing, channels: [v as NotificationTemplate['channels'][number]] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['in_app','email','push','sms'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><label className="flex items-center gap-3"><Toggle checked={editing.enabled} onCheckedChange={enabled => setEditing({ ...editing, enabled })} />Template enabled</label></div>}<DialogFooter><Button onClick={save}><Save className="mr-2 h-4 w-4" />Save template</Button></DialogFooter></DialogContent></Dialog></PageState>;
}

const accessOptions = [{ value: 'editable', label: 'Editable' }, { value: 'read_only', label: 'Read-only' }] as const;
function AuditLog({ app }: { app: AppKey }) {
  const [page, setPage] = useState(1); const [draft, setDraft] = useState({ from: '', to: '', actorId: '', action: '' }); const [filters, setFilters] = useState<Record<string, string>>({});
  const api = useAdmin(app, page, filters);
  const entries = api.log.data?.items ?? [];
  return <><Card className="mb-5"><CardHeader><CardTitle>Audit log filters</CardTitle><CardDescription>Read-only, immutable administrative history.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-5"><Input type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /><Input type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /><Input placeholder="Actor ID" value={draft.actorId} onChange={e => setDraft({ ...draft, actorId: e.target.value })} /><Input placeholder="Action" value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })} /><Button onClick={() => { setPage(1); setFilters(Object.fromEntries(Object.entries(draft).filter(([,v]) => v))); }}><Search className="mr-2 h-4 w-4" />Apply</Button></CardContent></Card><PageState loading={api.log.isLoading} error={api.log.error} empty={!entries.length} onRetry={api.log.refetch}><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Date & time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>IP address</TableHead></TableRow></TableHeader><TableBody>{entries.map(e => <TableRow key={e.id}><TableCell>{new Date(e.occurredAt).toLocaleString()}</TableCell><TableCell>{e.actorId}</TableCell><TableCell><Badge variant="outline">{e.action}</Badge></TableCell><TableCell>{e.entityType} · {e.entityId}</TableCell><TableCell>{e.ipAddress ?? '—'}</TableCell></TableRow>)}</TableBody></Table><div className="mt-5 flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {page} · {api.log.data?.total ?? 0} entries</p><div className="flex gap-2"><Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></Button><Button size="icon" variant="outline" disabled={page * 20 >= (api.log.data?.total ?? 0)} onClick={() => setPage(p => p + 1)}><ChevronRight /></Button></div></div></CardContent></Card></PageState></>;
}

type NumberingPosition = 'after_prefix' | 'after_suffix' | 'before_prefix';
interface NumberingFormState { prefix: string; suffix: string; separator: string; position: NumberingPosition; padding: number; startingNumber: number; }

// Mirrors the server formatter in api-server/src/lib/numbering.ts — keep in sync.
function formatNumberPreview(p: NumberingFormState, n: number) {
  const running = String(n).padStart(p.padding, '0');
  const parts = p.position === 'before_prefix' ? [running, p.prefix, p.suffix]
    : p.position === 'after_suffix' ? [p.prefix, p.suffix, running]
    : [p.prefix, running, p.suffix];
  return parts.filter(part => part !== '').join(p.separator);
}

function NumberingForm({ app, module, onSaved }: { app: AppKey; module: NumberingModuleConfig; onSaved: (title: string) => void }) {
  const [form, setForm] = useState<NumberingFormState>({
    prefix: module.pattern.prefix, suffix: module.pattern.suffix, separator: module.pattern.separator,
    position: module.pattern.position, padding: module.pattern.padding, startingNumber: module.pattern.startingNumber,
  });
  const update = useUpdateNumberingPattern(); const reset = useResetNumberingPattern();
  const set = <K extends keyof NumberingFormState>(key: K, value: NumberingFormState[K]) => setForm(f => ({ ...f, [key]: value }));
  const busy = update.isPending || reset.isPending;
  const fail = (error: unknown) => onSaved(`Could not save: ${error instanceof Error ? error.message : 'unknown error'}`);
  return <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Reference numbers</CardTitle><CardDescription>Pattern used when new {names[app]} records are created. Existing records keep their numbers.</CardDescription></div><Badge variant={module.configured ? 'default' : 'secondary'}>{module.configured ? 'Custom' : 'Default'}</Badge></div></CardHeader><CardContent className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label>Prefix</Label><Input maxLength={20} value={form.prefix} onChange={e => set('prefix', e.target.value)} /></div>
      <div><Label>Suffix</Label><Input maxLength={20} value={form.suffix} onChange={e => set('suffix', e.target.value)} /></div>
      <div><Label>Separator</Label><Input maxLength={3} value={form.separator} onChange={e => set('separator', e.target.value)} /></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label>Running number position</Label><Select value={form.position} onValueChange={v => set('position', v as NumberingPosition)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="after_prefix">After prefix</SelectItem><SelectItem value="after_suffix">After suffix</SelectItem><SelectItem value="before_prefix">Before prefix</SelectItem></SelectContent></Select></div>
      <div><Label>Padding (digits)</Label><Input type="number" min={0} max={12} value={form.padding} onChange={e => set('padding', Math.max(0, Math.min(12, Number(e.target.value) || 0)))} /></div>
      <div><Label>Starting number</Label><Input type="number" min={0} value={form.startingNumber} onChange={e => set('startingNumber', Math.max(0, Number(e.target.value) || 0))} /></div>
    </div>
    <div className="rounded-lg border bg-muted/40 px-4 py-3"><p className="text-xs uppercase tracking-widest text-muted-foreground">Next reference number</p><p className="mt-1 font-mono text-lg font-semibold">{formatNumberPreview(form, Math.max(module.pattern.nextNumber, form.startingNumber))}</p><p className="mt-1 text-xs text-muted-foreground">The counter continues from {module.pattern.nextNumber}; the starting number applies only before the first number is issued.</p></div>
    <div className="flex gap-2"><Button disabled={busy} onClick={() => update.mutate({ module: app, data: form }, { onSuccess: () => onSaved('Numbering pattern saved'), onError: fail })}><Save className="mr-2 h-4 w-4" />Save pattern</Button>{module.configured && <Button variant="outline" disabled={busy} onClick={() => reset.mutate({ module: app }, { onSuccess: () => onSaved('Numbering reset to default'), onError: fail })}>Reset to default</Button>}</div>
  </CardContent></Card>;
}

function NumberingTab({ app }: { app: AppKey }) {
  const config = useGetNumberingConfig();
  const { toast } = useToast();
  const notify = (title: string) => { toast({ title }); config.refetch(); };
  if (config.isLoading) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading numbering settings…</CardContent></Card>;
  const module = config.data?.modules?.[app];
  if (!module) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Numbering settings unavailable.</CardContent></Card>;
  return <div className="space-y-5"><NumberingForm key={`${app}-${config.dataUpdatedAt}`} app={app} module={module} onSaved={notify} />
    {app === 'audit' && <AuditScheduleNumberingSettings />}
  </div>;
}

function AuditScheduleNumberingSettings() {
  const query = useGetAuditScheduleNumbering();
  const { toast } = useToast();
  if (query.isLoading) return <Card><CardContent className="py-6">Loading Audit Schedule numbering…</CardContent></Card>;
  if (!query.data || query.isError) return <Card><CardContent className="py-6 text-destructive">Unable to load Audit Schedule numbering. <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></CardContent></Card>;
  return <AuditScheduleNumberingEditor key={query.dataUpdatedAt} initial={query.data} onSaved={() => {
    toast({ title: 'Audit Schedule numbering saved' }); void query.refetch();
  }} />;
}

function AuditScheduleNumberingEditor({ initial, onSaved }: { initial: AuditScheduleNumbering; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const update = useUpdateAuditScheduleNumbering();
  const { toast } = useToast();
  const change = (field: keyof AuditScheduleNumbering, key: 'prefix' | 'start' | 'end', value: string) =>
    setForm(current => ({ ...current, [field]: { ...current[field], [key]: key === 'prefix' ? value : Number(value) } }));
  const valid = [form.qaqcReference, form.auditNumber].every(range =>
    range.prefix.trim() && Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= 1 && range.end <= 999 && range.end >= range.start) && form.qaqcReference.start === 1;
  return <Card><CardHeader><CardTitle>Audit Schedule fields 8 and 9</CardTitle><CardDescription>Separate prefixes and three-digit ranges. Only QA/QC Reference includes a two-digit year, taken from each audit's From Date. Existing numbers are not changed when settings are saved.</CardDescription></CardHeader>
    <CardContent className="space-y-5">{(['qaqcReference', 'auditNumber'] as const).map(field => <section key={field} className="space-y-3 rounded-lg border p-4">
      <div><h3 className="font-medium">{field === 'qaqcReference' ? '8. QA/QC Reference' : '9. Audit Number / Site Visit No.'}</h3><p className="text-sm text-muted-foreground">{field === 'qaqcReference' ? 'Assigned in From Date order when the parent Audit Schedule is submitted. The two-digit year comes from that audit’s From Date; numbering starts at 001 within each schedule.' : 'Assigned when each audit is created. No year is added, and the sequence continues separately for each department or project.'}</p></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${field}-prefix`}>Prefix</Label><Input id={`${field}-prefix`} maxLength={20} value={form[field].prefix} onChange={e => change(field, 'prefix', e.target.value)} /></div>
        <div><Label htmlFor={`${field}-start`}>First number</Label><Input id={`${field}-start`} type="number" min={1} max={999} disabled={field === 'qaqcReference'} value={form[field].start} onChange={e => change(field, 'start', e.target.value)} /></div>
        <div><Label htmlFor={`${field}-end`}>Last number</Label><Input id={`${field}-end`} type="number" min={1} max={999} value={form[field].end} onChange={e => change(field, 'end', e.target.value)} /></div>
      </div><p className="text-sm text-muted-foreground">{field === 'qaqcReference' ? 'Example (From Date: 10-12-2026)' : 'Example'}: <span className="font-mono">{form[field].prefix}{field === 'qaqcReference' ? '26-' : ''}{String(form[field].start).padStart(3, '0')}</span></p>
    </section>)}
    <Button disabled={!valid || update.isPending} onClick={() => update.mutate({ data: form }, { onSuccess: onSaved, onError: error => toast({ title: 'Unable to save numbering', description: error instanceof Error ? error.message : 'Request failed', variant: 'destructive' }) })}><Save className="mr-2 size-4" />Save schedule numbering</Button>
  </CardContent></Card>;
}

function SettingsPage() {
  const params = useParams<{ app: string; tab?: string }>(); const [, navigate] = useLocation();
  const app = (['qaqc','lessons','audit'].includes(params.app) ? params.app : 'qaqc') as AppKey;
  const tab = (params.tab || 'overview') as TabKey;
  const visibleTabs = tabs.filter(t => !(app === 'audit' && t.key === 'ai') && !(t.key === 'pdf-templates' && app !== 'qaqc'));
  const content = tab === 'overview' ? <Overview app={app} /> : tab === 'numbering' ? <NumberingTab app={app} /> : tab === 'access' ? <UsersAccess app={app} /> : tab === 'roles' ? <Roles app={app} /> : tab === 'escalation' ? <Escalations app={app} /> : tab === 'ai' && app !== 'audit' ? <AiSettings app={app} /> : tab === 'form-fields' ? <FormFields app={app} /> : tab === 'notifications' ? <Notifications app={app} /> : tab === 'pdf-templates' && app === 'qaqc' ? <PdfTemplatesAdmin /> : <AuditLog app={app} />;
  return <main className="min-h-screen bg-background"><header className="bg-primary px-5 py-8 text-primary-foreground md:px-10"><div className="mx-auto max-w-7xl"><Link href={`/${app}`} className="mb-5 inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"><ArrowLeft className="h-4 w-4" />Back to application</Link><p className="text-sm font-semibold uppercase tracking-widest opacity-70">Independent workspace administration</p><h1 className="mt-2 font-display text-3xl font-bold">{names[app]} Settings</h1><p className="mt-2 max-w-2xl opacity-80">Configure access, governance and operational controls for this application only.</p></div></header><div className="mx-auto max-w-7xl px-5 py-6 md:px-10"><nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5">{visibleTabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => navigate(`/settings/${app}/${key}`)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>{content}</div></main>;
}

export function AdminRoutes() {
  return <Switch><Route path="/settings/:app/:tab"><SettingsPage /></Route><Route path="/settings/:app"><SettingsPage /></Route><Route path="/cockpit"><CockpitPage /></Route></Switch>;
}

const requirementOptions = [{ value: 'optional', label: 'Optional' }, { value: 'mandatory', label: 'Mandatory' }] as const;

function FormFields({ app }: { app: AppKey }) {
  const opts = (key: AppKey): any => ({ query: { enabled: app === key } });
  const queries = {
    qaqc: useGetQaqcAdminFieldControls(opts('qaqc')),
    lessons: useGetLessonsAdminFieldControls(opts('lessons')),
    audit: useGetAuditAdminFieldControls(opts('audit')),
  };
  const mutations = {
    qaqc: useUpdateQaqcAdminFieldControls(),
    lessons: useUpdateLessonsAdminFieldControls(),
    audit: useUpdateAuditAdminFieldControls(),
  };
  const act = useActions(app);
  const query = queries[app];
  const mutation = mutations[app];
  const forms = fieldControlRegistry[app];
  const [formKey, setFormKey] = useState('');
  const [draft, setDraft] = useState<Record<string, FieldControlSetting>>();
  const form = forms.find(f => f.key === formKey) ?? forms[0];
  useEffect(() => setDraft(undefined), [app, form?.key]);
  if (!form) return null;
  const saved = query.data?.[form.key] ?? {};
  const matrix = draft ?? Object.fromEntries(form.fields.map(f => [f.key, saved[f.key] ?? { access: 'editable' as const, requirement: 'optional' as const }]));
  const patch = (fieldKey: string, value: Partial<FieldControlSetting>) => setDraft({ ...matrix, [fieldKey]: { ...matrix[fieldKey]!, ...value } as FieldControlSetting });
  const save = () => mutation.mutate({ data: { ...(query.data ?? {}), [form.key]: matrix } }, { onSuccess: () => { act.done('Field controls saved'); setDraft(undefined); }, onError: act.fail });
  return <PageState loading={query.isLoading} error={query.error} onRetry={query.refetch}>
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Form field controls</CardTitle><CardDescription>Decide which fields are read-only or mandatory on each form. Applies to everyone except administrators.</CardDescription></div><Button disabled={!draft || mutation.isPending} onClick={save}><Save className="mr-2 h-4 w-4" />Save changes</Button></CardHeader>
      <CardContent>
        <div className="mb-4 max-w-sm"><Label>Form</Label><Select value={form.key} onValueChange={key => { setFormKey(key); setDraft(undefined); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{forms.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent></Select></div>
        <Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead className="w-44">Access</TableHead><TableHead className="w-44">Requirement</TableHead></TableRow></TableHeader>
          <TableBody>{form.fields.map(f => <TableRow key={f.key}><TableCell className="font-medium">{f.label}</TableCell>
            <TableCell><Select value={matrix[f.key]?.access ?? 'editable'} onValueChange={v => patch(f.key, { access: v as FieldControlSetting['access'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{accessOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></TableCell>
            <TableCell><Select value={matrix[f.key]?.requirement ?? 'optional'} onValueChange={v => patch(f.key, { requirement: v as FieldControlSetting['requirement'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{requirementOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></TableCell>
          </TableRow>)}</TableBody></Table>
        <p className="mt-4 text-sm text-muted-foreground">Read-only fields appear disabled on the form. Mandatory fields are marked required and block saving while empty. Administrators always keep full edit access.</p>
      </CardContent></Card>
  </PageState>;
}
