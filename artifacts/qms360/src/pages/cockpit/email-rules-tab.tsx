import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListEmailRulesQueryKey,
  useListEmailRules, useCreateEmailRule, useUpdateEmailRule, useDeleteEmailRule,
  useReorderEmailRules, useEmailRuleEventCatalog, useEmailRuleUserOptions,
  useListPlatformProjects,
  useSimulateEmailRule,
  useCreateIntegrationConnector,
  useSendConnectorTestEmail
} from '@workspace/api-client-react';
import type { IntegrationConnector, EmailEventRule, EmailRuleSimulationResult } from '@workspace/api-client-react';
import { Plus, Settings2, Mail, Save, Trash2, MoveUp, MoveDown, Search, ArrowRight, Bot, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'An error occurred';
}

function StatusBadge({ value }: { value: string }) {
  const variant = value === 'Connected' ? 'default' : value === 'Disabled' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{value}</Badge>;
}

export function EmailRulesTab({ connectors, onEditConnector }: { connectors: IntegrationConnector[], onEditConnector: (c: IntegrationConnector) => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const createConnector = useCreateIntegrationConnector();
  
  const emailConnector = connectors.find((c) => c.family === 'email');

  const handleCreateSMTP = () => {
    createConnector.mutate({
      data: {
        name: 'Email SMTP',
        family: 'email',
        enabled: true,
        config: {
          host: '',
          port: '587',
          secure: false,
          username: '',
          fromAddress: '',
          fromName: 'QMS360',
        }
      }
    }, {
      onSuccess: (c) => {
        toast({ title: 'SMTP Connector created' });
        client.invalidateQueries();
        onEditConnector(c);
      },
      onError: (err) => {
        toast({ title: 'Failed to create connector', description: message(err), variant: 'destructive' });
      }
    });
  };

  const testEmail = useSendConnectorTestEmail();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>SMTP Configuration</CardTitle>
            <CardDescription>Configure the outbound email server for all system notifications and escalations.</CardDescription>
          </div>
          {emailConnector ? (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={testEmail.isPending} onClick={() => testEmail.mutate({ id: emailConnector.id }, { onSuccess: (r) => toast({ title: r.message || 'Test email sent' }), onError: (err) => toast({ title: 'Test email failed', description: message(err), variant: 'destructive' }) })}>
                <Mail className="mr-2 h-4 w-4" />
                Test connection
              </Button>
              <Button variant="outline" onClick={() => onEditConnector(emailConnector)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </div>
          ) : (
            <Button onClick={handleCreateSMTP} disabled={createConnector.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Configure SMTP
            </Button>
          )}
        </CardHeader>
        {emailConnector && (
          <CardContent>
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div className="space-y-1">
                <span className="text-muted-foreground">Status</span>
                <div className="flex items-center"><StatusBadge value={emailConnector.status} /></div>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">From address</span>
                <div className="font-medium">{String(emailConnector.config?.fromAddress || '—')}</div>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">Host</span>
                <div className="font-medium">{String(emailConnector.config?.host || '—')}:{String(emailConnector.config?.port || '')}</div>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">Enabled</span>
                <div className="font-medium">{emailConnector.enabled ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <EmailRulesList />
      <EmailSimulator />
    </div>
  );
}

function EmailRulesList() {
  const { toast } = useToast();
  const client = useQueryClient();
  const query = useListEmailRules();
  const rules = query.data ?? [];
  const reorder = useReorderEmailRules();
  const update = useUpdateEmailRule();
  const remove = useDeleteEmailRule();
  
  const [editingRule, setEditingRule] = useState<EmailEventRule | null | 'new'>(null);

  const refresh = () => client.invalidateQueries({ queryKey: getListEmailRulesQueryKey() });

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= rules.length) return;
    const ids = rules.map(r => r.id);
    const temp = ids[index];
    ids[index] = ids[next];
    ids[next] = temp;
    reorder.mutate({ data: { ids } }, {
      onSuccess: () => refresh(),
      onError: (err) => toast({ title: 'Could not reorder', description: message(err), variant: 'destructive' })
    });
  };

  const toggleStatus = (rule: EmailEventRule) => {
    update.mutate({ id: rule.id, data: { ...rule, enabled: !rule.enabled } }, {
      onSuccess: () => refresh(),
      onError: (err) => toast({ title: 'Could not toggle rule', description: message(err), variant: 'destructive' })
    });
  };

  const deleteRule = (id: string) => {
    remove.mutate({ id }, {
      onSuccess: () => { toast({ title: 'Rule deleted' }); refresh(); },
      onError: (err) => toast({ title: 'Could not delete rule', description: message(err), variant: 'destructive' })
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Email Event Rules</CardTitle>
          <CardDescription>Rules are evaluated top-to-bottom. The first matching enabled rule determines who receives the event email.</CardDescription>
        </div>
        <Button variant="outline" onClick={() => setEditingRule('new')}>
          <Plus className="mr-2 h-4 w-4" />
          New rule
        </Button>
      </CardHeader>
      <CardContent>
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading rules...</p>}
        {query.error && <p className="text-sm text-destructive">{message(query.error)}</p>}
        {rules.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Rule name &amp; Event</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="w-24">Enabled</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule, i) => (
                <TableRow key={rule.id}>
                  <TableCell className="text-center font-medium text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <p className="font-medium">{rule.name}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{rule.eventType}</p>
                  </TableCell>
                  <TableCell>
                    {rule.createdByUserId ? (
                      <span className="text-sm">If created by specific user</span>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Any creator</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {rule.recipientMode === 'linked_approver' ? (
                      <span className="text-sm">Send from form creator to linked approver</span>
                    ) : rule.recipientMode === 'workspace_role' ? (
                      <span className="text-sm">Send to role: {rule.recipientConfig?.roleName}</span>
                    ) : rule.recipientMode === 'project_members' ? (
                      <span className="text-sm">Send to project members</span>
                    ) : rule.recipientMode === 'project_role' ? (
                      <span className="text-sm">Send to project role: {rule.recipientConfig?.roleName}</span>
                    ) : rule.receiverEmail ? (
                      <span className="text-sm">Send to: {rule.receiverName} &lt;{rule.receiverEmail}&gt;</span>
                    ) : rule.receiverUserId ? (
                      <span className="text-sm">Send to specific user</span>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Send to all active users</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch checked={rule.enabled} onCheckedChange={() => toggleStatus(rule)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <div className="flex flex-col mr-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><MoveUp className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={i === rules.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><MoveDown className="h-3 w-3" /></Button>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingRule(rule)}><Settings2 className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteRule(rule.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rules.length === 0 && !query.isLoading && (
          <p className="text-center text-sm text-muted-foreground py-10">No rules configured. All events will use default system behavior.</p>
        )}
      </CardContent>
      {editingRule && <RuleEditor rule={editingRule === 'new' ? null : editingRule} onClose={() => setEditingRule(null)} />}
    </Card>
  );
}

function RuleEditor({ rule, onClose }: { rule: EmailEventRule | null, onClose: () => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const create = useCreateEmailRule();
  const update = useUpdateEmailRule();
  const eventsQuery = useEmailRuleEventCatalog();
  const usersQuery = useEmailRuleUserOptions();
  const projectsQuery = useListPlatformProjects({ page: 1, limit: 200 });
  
  const [draft, setDraft] = useState({
    name: rule?.name ?? '',
    enabled: rule?.enabled ?? true,
    eventType: rule?.eventType ?? '',
    createdByUserId: rule?.createdByUserId ?? '',
    receiverMode: rule?.recipientMode === 'linked_approver' ? 'linked_approver'
      : rule?.recipientMode === 'workspace_role' ? 'role'
      : rule?.recipientMode === 'project_members' ? 'project'
        : rule?.recipientMode === 'project_role' ? 'project_role'
          : rule?.receiverEmail ? 'external' : (rule?.receiverUserId ? 'user' : 'default'),
    receiverUserId: rule?.receiverUserId ?? '',
    receiverName: rule?.receiverName ?? '',
    receiverEmail: rule?.receiverEmail ?? '',
    roleName: rule?.recipientConfig?.roleName ?? '',
    projectId: rule?.recipientConfig?.projectIds?.[0] ?? '',
  });

  const set = (patch: Partial<typeof draft>) => setDraft(d => ({ ...d, ...patch }));

  const save = () => {
    const payload = {
      name: draft.name.trim(),
      enabled: draft.enabled,
      priority: rule?.priority ?? 999,
      eventType: draft.eventType,
      createdByUserId: draft.createdByUserId || null,
      recipientMode: draft.receiverMode === 'user' ? 'internal_user' as const
        : draft.receiverMode === 'external' ? 'external_email' as const
          : draft.receiverMode === 'role' ? 'workspace_role' as const
            : draft.receiverMode === 'project' ? 'project_members' as const
              : draft.receiverMode === 'project_role' ? 'project_role' as const
                : draft.receiverMode === 'linked_approver' ? 'linked_approver' as const : 'all_users' as const,
      receiverUserId: draft.receiverMode === 'user' && draft.receiverUserId ? draft.receiverUserId : null,
      receiverName: draft.receiverMode === 'external' ? draft.receiverName.trim() : null,
      receiverEmail: draft.receiverMode === 'external' ? draft.receiverEmail.trim() : null,
      recipientConfig: {
        ...(draft.receiverMode === 'linked_approver' ? { senderMode: 'form_creator' as const } : {}),
        ...(draft.receiverMode === 'role' || draft.receiverMode === 'project_role' ? { roleName: draft.roleName.trim() } : {}),
        ...(draft.receiverMode === 'project' || draft.receiverMode === 'project_role' ? { projectIds: draft.projectId ? [draft.projectId] : [] } : {}),
      },
    };
    
    if (draft.receiverMode === 'external' && (!payload.receiverEmail || !payload.receiverName)) {
      toast({ title: 'Validation error', description: 'External recipient requires both name and email.', variant: 'destructive' });
      return;
    }
    if ((draft.receiverMode === 'role' || draft.receiverMode === 'project_role') && !draft.roleName.trim()) {
      toast({ title: 'Validation error', description: 'Enter a workspace role name.', variant: 'destructive' });
      return;
    }
    if ((draft.receiverMode === 'project' || draft.receiverMode === 'project_role') && !draft.projectId) {
      toast({ title: 'Validation error', description: 'Select a project.', variant: 'destructive' });
      return;
    }

    const action = rule 
      ? update.mutateAsync({ id: rule.id, data: payload })
      : create.mutateAsync({ data: payload });

    action.then(() => {
      client.invalidateQueries({ queryKey: getListEmailRulesQueryKey() });
      toast({ title: rule ? 'Rule updated' : 'Rule created' });
      onClose();
    }).catch(err => {
      toast({ title: 'Failed to save rule', description: message(err), variant: 'destructive' });
    });
  };

  const events = eventsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const projects = projectsQuery.data?.items ?? [];
  
  const busy = create.isPending || update.isPending;
  const isNew = !rule;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New Email Rule' : 'Edit Rule'}</DialogTitle>
          <DialogDescription>Define when to override default email recipients.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Rule name</Label>
              <Input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Finance team escalations" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={draft.enabled} onCheckedChange={enabled => set({ enabled })} />
                <span className="text-sm font-medium">Enabled</span>
              </label>
            </div>
          </div>
          
          <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
            <h4 className="font-semibold text-sm">Condition (If)</h4>
            <div className="space-y-3">
              <div>
                <Label>Event type</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={draft.eventType}
                  onChange={event => set({ eventType: event.target.value })}
                >
                  <option value="">Select an event...</option>
                  {events.map(ev => <option key={ev.value} value={ev.value}>{ev.label} ({ev.value})</option>)}
                </select>
              </div>
              <div>
                <Label>Triggered by user (Optional)</Label>
                <Select value={draft.createdByUserId || 'any'} onValueChange={v => set({ createdByUserId: v === 'any' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Any user" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any user (Ignore condition)</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">Only match this rule if the event was triggered by this specific person.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
            <h4 className="font-semibold text-sm">Action (Then send to)</h4>
            <div className="space-y-3">
              <div>
                <Label>Recipient mode</Label>
                <Select value={draft.receiverMode} onValueChange={v => set({ receiverMode: v as typeof draft.receiverMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">All active users</SelectItem>
                    <SelectItem value="user">Specific internal user</SelectItem>
                    <SelectItem value="role">Application workspace role</SelectItem>
                    <SelectItem value="project">All members of a project</SelectItem>
                    <SelectItem value="project_role">Role members in a project</SelectItem>
                    <SelectItem value="linked_approver" disabled={draft.eventType !== 'lessons.lesson_form.submit'}>Linked Lessons approver</SelectItem>
                    <SelectItem value="external">Specific external address</SelectItem>
                  </SelectContent>
                </Select>
                {draft.receiverMode === 'default' && (
                  <p className="mt-1 text-xs text-muted-foreground">Leaves recipient fields blank. The system will send this email to every active user in your organization.</p>
                )}
                {draft.receiverMode === 'linked_approver' && <p className="mt-1 text-xs text-muted-foreground">Uses the approver linked to this Lessons Learned form. The form creator is used as the visible sender and Reply-To address.</p>}
              </div>
              
              {draft.receiverMode === 'user' && (
                <div>
                  <Label>Internal user</Label>
                  <Select value={draft.receiverUserId} onValueChange={v => set({ receiverUserId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select user..." /></SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              {draft.receiverMode === 'external' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Receiver name</Label>
                    <Input value={draft.receiverName} onChange={e => set({ receiverName: e.target.value })} placeholder="John Doe" />
                  </div>
                  <div>
                    <Label>Receiver email</Label>
                    <Input value={draft.receiverEmail} type="email" onChange={e => set({ receiverEmail: e.target.value })} placeholder="john@example.com" />
                  </div>
                </div>
              )}
              {(draft.receiverMode === 'role' || draft.receiverMode === 'project_role') && (
                <div><Label>Workspace role name</Label><Input className="mt-2" value={draft.roleName} onChange={e => set({ roleName: e.target.value })} placeholder="e.g. Auditor, QA/QC Manager" /><p className="mt-1 text-xs text-muted-foreground">The role is resolved in the application selected by the event type.</p></div>
              )}
              {(draft.receiverMode === 'project' || draft.receiverMode === 'project_role') && (
                <div><Label>Project</Label><Select value={draft.projectId} onValueChange={projectId => set({ projectId })}><SelectTrigger className="mt-2"><SelectValue placeholder="Select project..." /></SelectTrigger><SelectContent>{projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!draft.name.trim() || !draft.eventType || busy} onClick={save}>
            <Save className="mr-2 h-4 w-4" />
            {isNew ? 'Create rule' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailSimulator() {
  const eventsQuery = useEmailRuleEventCatalog();
  const usersQuery = useEmailRuleUserOptions();
  const simulate = useSimulateEmailRule();
  
  const [eventType, setEventType] = useState('');
  const [createdByUserId, setCreatedByUserId] = useState('');
  
  const events = eventsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  
  const result = simulate.data;

  const runSimulation = () => {
    simulate.mutate({
      data: {
        eventType,
        createdByUserId: createdByUserId || undefined
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" /> Rule Simulator</CardTitle>
        <CardDescription>Test the routing logic to see which rule matches and who will receive the email.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-[2fr_2fr_auto] items-end">
          <div>
            <Label>Event</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={eventType}
              onChange={event => setEventType(event.target.value)}
            >
              <option value="">Select event...</option>
              {events.map(ev => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Created by</Label>
            <Select value={createdByUserId || 'none'} onValueChange={v => setCreatedByUserId(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="System (No user)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">System (No user)</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runSimulation} disabled={!eventType || simulate.isPending}>
            <Search className="mr-2 h-4 w-4" />
            Simulate
          </Button>
        </div>

        {simulate.isError && (
          <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-semibold">Simulation failed</p>
            <p className="mt-1">{message(simulate.error)}</p>
          </div>
        )}

        {simulate.isSuccess && result && (
          <div className={`mt-4 rounded-lg border p-5 ${result.matched ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-muted'}`}>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Settings2 className="h-4 w-4" /> Rule matched
                </h4>
                {result.matched && result.rule ? (
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground mr-2">Rule name:</span> <span className="font-medium">{result.rule.name}</span></p>
                    <p><span className="text-muted-foreground mr-2">Priority:</span> <span>{result.rule.priority}</span></p>
                    {result.rule.createdByUserId && <p><span className="text-muted-foreground mr-2">Condition:</span> <span>Restricted to specific creator</span></p>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No custom rule matched. System default will apply.</p>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <MailCheck className="h-4 w-4" /> Resolved recipients ({result.recipients.length})
                </h4>
                {result.recipients.length > 0 ? (
                  <ul className="space-y-2">
                    {result.recipients.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          {r.name && <span className="font-medium mr-1">{r.name}</span>}
                          <span className="text-muted-foreground">&lt;{r.email}&gt;</span>
                          {r.userId && <Badge variant="outline" className="ml-2 h-5 text-[10px]">Internal</Badge>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No active recipients found.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
