import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch } from 'wouter';
import {
  useCreateMasterDataGroup, useCreateMasterDataValue, useDeleteMasterDataGroup,
  useDeleteMasterDataValue, useListMasterData, useUpdateMasterDataGroup,
  useUpdateMasterDataValue,
} from '@workspace/api-client-react';
import type { MasterDataGroup, MasterDataValue } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Database, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { MasterDataRolePicker } from './role-picker';

const scopes = ['global', 'qaqc', 'lessons', 'audit'] as const;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

function MasterDataPage() {
  const query = useListMasterData();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [groupEditor, setGroupEditor] = useState<MasterDataGroup | null>();
  const [valueEditor, setValueEditor] = useState<MasterDataValue | null>();
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'group' | 'value'; id: string; name: string }>();
  const updateValue = useUpdateMasterDataValue();
  const client = useQueryClient();
  const { toast } = useToast();
  const groups = (query.data?.items ?? []).filter(group =>
    (scope === 'all' || group.appScope === scope) &&
    `${group.name} ${group.code}`.toLowerCase().includes(search.toLowerCase()));
  const selected = query.data?.items.find(group => group.id === selectedId) ?? groups[0];
  const auditTypeOptions = query.data?.items.find(group => group.code.toLowerCase() === 'audit_types')
    ?.values.filter(value => value.active).map(({ value, label }) => ({ value, label })) ?? [];
  useEffect(() => { if (!selectedId && groups[0]) setSelectedId(groups[0].id); }, [groups, selectedId]);

  if (query.isLoading) return <Card><CardContent className="space-y-3 py-12"><div className="h-6 w-1/3 animate-pulse rounded bg-muted" /><div className="h-40 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Loading global master data…</p></CardContent></Card>;
  if (query.error && /403|forbidden/i.test(errorText(query.error))) return <Card><CardContent className="py-14 text-center"><Lock className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">Administrator access required</p><p className="mt-1 text-sm text-muted-foreground">Only platform administrators can manage global master data.</p></CardContent></Card>;
  if (query.error) return <Card className="border-destructive"><CardContent className="flex items-center gap-3 py-8"><AlertCircle className="text-destructive" /><div className="flex-1"><p className="font-semibold">Master data unavailable</p><p className="text-sm text-muted-foreground">{errorText(query.error)}</p></div><Button variant="outline" onClick={() => query.refetch()}>Retry</Button></CardContent></Card>;

  return <div className="space-y-6">
    <header className="rounded-xl bg-primary p-6 text-primary-foreground">
      <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm opacity-80"><ArrowLeft className="size-4" />System overview</Link>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest opacity-70">Global QMS360 configuration</p><h1 className="mt-2 text-3xl font-bold">Master Data</h1><p className="mt-2 opacity-80">Master Data — global lists of values used across all three applications.</p></div><Button variant="secondary" onClick={() => setGroupEditor(null)}><Plus className="mr-2 size-4" />Add group</Button></div>
    </header>
    {!query.data?.items.length ? <Card><CardContent className="py-14 text-center"><Database className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">No master-data groups</p><Button className="mt-4" onClick={() => setGroupEditor(null)}>Add the first group</Button></CardContent></Card> :
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Card><CardHeader><CardTitle>Value groups</CardTitle><CardDescription>{query.data.total} lists available</CardDescription></CardHeader><CardContent><div className="mb-4 grid gap-2"><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name or code" value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={scope} onValueChange={setScope}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All applications</SelectItem>{scopes.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2">{groups.map(group => <button key={group.id} onClick={() => setSelectedId(group.id)} className={`w-full rounded-lg border p-3 text-left ${selected?.id === group.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}><div className="flex items-center justify-between"><span className="font-medium">{group.name}</span><span className="flex gap-1">{group.isSystem && <Badge variant="outline"><Lock className="mr-1 size-3" />System</Badge>}<Badge variant="secondary">{group.values.length}</Badge></span></div><div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><code>{group.code}</code><Badge variant="outline">{group.appScope}</Badge></div></button>)}</div>
        {!groups.length && <p className="py-8 text-center text-sm text-muted-foreground">No groups match these filters.</p>}
      </CardContent></Card>
      {selected && <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>{selected.name}</CardTitle><CardDescription>{selected.description || selected.code}</CardDescription></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setGroupEditor(selected)}><Pencil className="mr-2 size-4" />Edit group</Button>{!selected.isSystem && <Button size="icon" variant="outline" onClick={() => setDeleteTarget({ kind: 'group', id: selected.id, name: selected.name })}><Trash2 className="size-4 text-destructive" /></Button>}<Button size="sm" onClick={() => setValueEditor(null)}><Plus className="mr-2 size-4" />Add value</Button></div></CardHeader><CardContent>
         {selected.values.length ? <Table><TableHeader><TableRow><TableHead>Value</TableHead><TableHead>Label</TableHead>{selected.code.toLowerCase() === 'audit_categories' && <TableHead>Linked Audit Types</TableHead>}<TableHead>Sort order</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{selected.values.map(value => <TableRow key={value.id}><TableCell className="font-medium">{value.value}</TableCell><TableCell>{value.label}</TableCell>{selected.code.toLowerCase() === 'audit_categories' && <TableCell className="text-xs text-muted-foreground">{Array.isArray(value.metadata?.auditTypeValues) && value.metadata.auditTypeValues.length ? value.metadata.auditTypeValues.join(', ') : 'Not linked'}</TableCell>}<TableCell>{value.sortOrder}</TableCell><TableCell><Toggle checked={value.active} disabled={updateValue.isPending} onCheckedChange={active => updateValue.mutate({ id: value.id, data: { active } }, { onSuccess: () => { client.invalidateQueries(); toast({ title: active ? 'Value activated' : 'Value deactivated' }); }, onError: e => toast({ title: 'Could not update value', description: errorText(e), variant: 'destructive' }) })} aria-label={`Toggle ${value.label}`} /></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => setValueEditor(value)}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" onClick={() => setDeleteTarget({ kind: 'value', id: value.id, name: value.label })}><Trash2 className="size-4 text-destructive" /></Button></div></TableCell></TableRow>)}</TableBody></Table> : <div className="py-14 text-center"><p className="font-semibold">No values in this group</p><p className="text-sm text-muted-foreground">Add the first selectable value.</p></div>}
      </CardContent></Card>}
    </div>}
    {groupEditor !== undefined && <GroupDialog group={groupEditor} close={() => setGroupEditor(undefined)} />}
     {valueEditor !== undefined && selected && <ValueDialog groupId={selected.id} groupCode={selected.code} groupScope={selected.appScope} auditTypes={auditTypeOptions} value={valueEditor} close={() => setValueEditor(undefined)} />}
    {deleteTarget && <DeleteDialog target={deleteTarget} close={() => setDeleteTarget(undefined)} />}
  </div>;
}

function GroupDialog({ group, close }: { group: MasterDataGroup | null; close: () => void }) {
  const [form, setForm] = useState({ code: group?.code ?? '', name: group?.name ?? '', description: group?.description ?? '', appScope: group?.appScope ?? 'global', sortOrder: group?.sortOrder ?? 0 });
  const create = useCreateMasterDataGroup(); const update = useUpdateMasterDataGroup(); const client = useQueryClient(); const { toast } = useToast();
  const save = () => { const done = () => { client.invalidateQueries(); toast({ title: group ? 'Group updated' : 'Group created' }); close(); }; const fail = (e: unknown) => toast({ title: 'Could not save group', description: errorText(e), variant: 'destructive' }); if (group) update.mutate({ id: group.id, data: { name: form.name, description: form.description, appScope: form.appScope as typeof group.appScope, sortOrder: form.sortOrder } }, { onSuccess: done, onError: fail }); else create.mutate({ data: { ...form, appScope: form.appScope as 'global' } }, { onSuccess: done, onError: fail }); };
  return <Dialog open onOpenChange={open => !open && close()}><DialogContent><DialogHeader><DialogTitle>{group ? 'Edit group' : 'Add master-data group'}</DialogTitle><DialogDescription>Define a reusable list and its application scope.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Code</Label><Input disabled={!!group} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div><div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div><div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div><div><Label>Application scope</Label><Select value={form.appScope} onValueChange={appScope => setForm({ ...form, appScope: appScope as typeof form.appScope })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{scopes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div><Label>Sort order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div></div><DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!form.name.trim() || !form.code.trim() || create.isPending || update.isPending} onClick={save}>Save group</Button></DialogFooter></DialogContent></Dialog>;
}

function ValueDialog({ groupId, groupCode, groupScope, auditTypes, value, close }: { groupId: string; groupCode: string; groupScope: string; auditTypes: { value: string; label: string }[]; value: MasterDataValue | null; close: () => void }) {
  const isActivitiesGroup = groupCode.trim().toLowerCase() === 'activities';
  const isAuditCategory = groupCode.trim().toLowerCase() === 'audit_categories';
  const existingMetadata = value?.metadata ?? {};
  const [form, setForm] = useState({
    value: value?.value ?? '', label: value?.label ?? '', sortOrder: value?.sortOrder ?? 0, active: value?.active ?? true,
    defaultRemarks: isActivitiesGroup && typeof existingMetadata.activityDefaultRemarks === 'string'
      ? existingMetadata.activityDefaultRemarks : '',
    auditTypeValues: isAuditCategory && Array.isArray(existingMetadata.auditTypeValues)
      ? existingMetadata.auditTypeValues.filter((item): item is string => typeof item === 'string') : [],
    assignedRoles: existingMetadata.assignedRoles ?? [],
  });
  const create = useCreateMasterDataValue(); const update = useUpdateMasterDataValue(); const client = useQueryClient(); const { toast } = useToast();
  const save = () => {
    const done = () => { client.invalidateQueries(); toast({ title: value ? 'Value updated' : 'Value added' }); close(); };
    const fail = (e: unknown) => toast({ title: 'Could not save value', description: errorText(e), variant: 'destructive' });
    const data = {
      value: form.value, label: form.label, sortOrder: form.sortOrder, active: form.active,
      metadata: {
        ...existingMetadata, assignedRoles: form.assignedRoles,
        ...(isActivitiesGroup ? { activityDefaultRemarks: form.defaultRemarks } : {}),
        ...(isAuditCategory ? { auditTypeValues: form.auditTypeValues } : {}),
      },
    };
    value ? update.mutate({ id: value.id, data }, { onSuccess: done, onError: fail }) : create.mutate({ groupId, data }, { onSuccess: done, onError: fail });
  };
  return <Dialog open onOpenChange={open => !open && close()}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{value ? 'Edit value' : 'Add value'}</DialogTitle>
        <DialogDescription>Values are immediately available in application dropdowns.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div><Label>Value</Label><Input value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></div>
        <div><Label>Label</Label><Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
        <MasterDataRolePicker scope={groupScope} value={form.assignedRoles}
          onChange={assignedRoles => setForm(current => ({ ...current, assignedRoles }))} />
        {isActivitiesGroup && <div>
          <Label>Activities / Section Remarks</Label>
          <Textarea rows={6} value={form.defaultRemarks} onChange={e => setForm({ ...form, defaultRemarks: e.target.value })}
            placeholder="Enter the default multiline remarks copied into a new Audit Plan activity row" />
          <p className="mt-1 text-xs text-muted-foreground">When this activity is selected in a new Audit Plan, these remarks are copied into the row and can still be edited for that plan.</p>
        </div>}
        {isAuditCategory && <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Linked Audit Types</legend>
          {auditTypes.map(type => <label key={type.value} className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.auditTypeValues.includes(type.value)} onCheckedChange={checked => setForm(current => ({
              ...current, auditTypeValues: checked === true ? [...current.auditTypeValues, type.value] : current.auditTypeValues.filter(item => item !== type.value),
            }))} />{type.label}
          </label>)}
          {!auditTypes.length && <p className="text-sm text-muted-foreground">Add an active Audit Type in master data first.</p>}
          <p className="text-xs text-muted-foreground">Until any category is linked, existing categories remain available for all Audit Types. Once links exist, only linked categories appear for each type.</p>
        </fieldset>}
        <div><Label>Sort order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
        {value && <label className="flex items-center gap-3"><Toggle checked={form.active} onCheckedChange={active => setForm({ ...form, active })} />Active</label>}
      </div>
      <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button>
        <Button disabled={!form.value.trim() || create.isPending || update.isPending} onClick={save}>Save value</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DeleteDialog({ target, close }: { target: { kind: 'group' | 'value'; id: string; name: string }; close: () => void }) {
  const group = useDeleteMasterDataGroup(); const value = useDeleteMasterDataValue(); const client = useQueryClient(); const { toast } = useToast();
  const remove = () => { const mutation = target.kind === 'group' ? group : value; mutation.mutate({ id: target.id }, { onSuccess: () => { client.invalidateQueries(); toast({ title: `${target.kind === 'group' ? 'Group' : 'Value'} deleted` }); close(); }, onError: e => toast({ title: 'Delete failed', description: errorText(e), variant: 'destructive' }) }); };
  return <Dialog open onOpenChange={open => !open && close()}><DialogContent><DialogHeader><DialogTitle>Delete {target.name}?</DialogTitle><DialogDescription>This action permanently removes the {target.kind}. Existing records retain their stored raw values.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button variant="destructive" onClick={remove}>Delete</Button></DialogFooter></DialogContent></Dialog>;
}

export function MasterDataRoutes() {
  return <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8"><Switch><Route path="/master-data" component={MasterDataPage} /></Switch></main>;
}