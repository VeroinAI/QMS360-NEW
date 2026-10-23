import type { EmailCcRecipient, EmailEventRule } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type CcDraft = {
  mode: EmailCcRecipient['mode'] | 'none'; userId: string; name: string; email: string;
  roleNames: string[]; roleName: string; projectIds: string[];
};
export const CC_MODES: {value: EmailCcRecipient['mode']; label: string}[] = [
  {value:'all_users',label:'All active users'},
  {value:'internal_user',label:'Specific internal user'},
  {value:'workspace_role',label:'Application workspace roles (select multiple)'},
  {value:'project_members',label:'All members of a project'},
  {value:'project_role',label:'Role members in a project'},
  {value:'linked_approver',label:'Linked Lessons approver'},
  {value:'linked_creator',label:'Linked Lessons creator'},
  {value:'external_email',label:'Specific external address'},
];
export function recipientModeForDraft(mode: string): EmailEventRule['recipientMode'] {
  return ({user:'internal_user',external:'external_email',role:'workspace_role',project:'project_members',project_role:'project_role',
    linked_approver:'linked_approver',linked_creator:'linked_creator'} as Record<string,EmailEventRule['recipientMode']>)[mode] ?? 'all_users';
}
export function initialCcDraft(config: EmailEventRule['recipientConfig']): CcDraft {
  const target=config?.ccRecipient;
  return {mode:target?.mode ?? (config?.ccRoleNames?.length ? 'workspace_role' : 'none'),userId:target?.userId??'',
    name:target?.name??'',email:target?.email??'',roleNames:target?.roleNames??config?.ccRoleNames??[],
    roleName:target?.roleName??'',projectIds:target?.projectIds??[]};
}
export function ccModeError(mode: CcDraft['mode'], toMode: EmailEventRule['recipientMode'], eventType: string): string | undefined {
  if(mode==='none')return;
  if(mode===toMode)return 'CC recipient mode must differ from Recipient mode. Choose another CC mode or select No CC.';
  if((mode==='linked_approver'||mode==='linked_creator')&&!eventType.startsWith('lessons.lesson_form.'))
    return 'Linked Lessons CC modes are only available for Lessons Learned form events.';
  return undefined;
}
export function ccRecipientFromDraft(cc: CcDraft): EmailCcRecipient | undefined {
  if(cc.mode==='none')return;
  return {mode:cc.mode,
    ...(cc.mode==='internal_user'&&cc.userId?{userId:cc.userId}:{}),
    ...(cc.mode==='external_email'?{name:cc.name.trim(),email:cc.email.trim()}:{}),
    ...(cc.mode==='workspace_role'?{roleNames:[...new Set(cc.roleNames.map(name=>name.trim()).filter(Boolean))]}:{}),
    ...(cc.mode==='project_role'?{roleName:cc.roleName.trim()}:{}),
    ...(['project_members','project_role'].includes(cc.mode)?{projectIds:[...new Set(cc.projectIds)]}:{}),
  };
}
export function EmailRuleCcEditor({value,onChange,toMode,eventType,users,projects,roles,rolesLoading,rolesError}:{
  value:CcDraft;onChange:(patch:Partial<CcDraft>)=>void;toMode:EmailEventRule['recipientMode'];eventType:string;
  users:{id:string;fullName:string}[];projects:{id:string;name:string}[];roles:{id:string;name:string}[];
  rolesLoading?:boolean;rolesError?:string;
}) {
  const error=ccModeError(value.mode,toMode,eventType);
  return <section className="space-y-3 rounded-xl border p-4" aria-label="CC recipients">
    <div className="space-y-2">
      <Label>CC recipient mode (optional)</Label>
      <p className="text-xs text-muted-foreground">Choose how CC recipients are determined. The option selected in Recipient mode cannot also be selected for CC. A person included in both To and CC receives the email in To only.</p>
      <Select value={value.mode} onValueChange={mode=>onChange({mode:mode as CcDraft['mode']})}>
        <SelectTrigger aria-label="CC recipient mode"><SelectValue placeholder="No CC" /></SelectTrigger>
        <SelectContent><SelectItem value="none">No CC</SelectItem>
          {CC_MODES.map(mode=><SelectItem key={mode.value} value={mode.value} disabled={!!ccModeError(mode.value,toMode,eventType)}>{mode.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
    {value.mode==='internal_user'&&<div className="space-y-2"><Label>Internal CC user</Label>
      <Select value={value.userId} onValueChange={userId=>onChange({userId})}><SelectTrigger aria-label="Internal CC user"><SelectValue placeholder="Select user..." /></SelectTrigger>
        <SelectContent>{users.map(user=><SelectItem key={user.id} value={user.id}>{user.fullName}</SelectItem>)}</SelectContent></Select></div>}
    {value.mode==='external_email'&&<div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2"><Label>CC recipient name</Label><Input aria-label="CC recipient name" value={value.name} onChange={event=>onChange({name:event.target.value})}/></div>
      <div className="space-y-2"><Label>CC recipient email</Label><Input aria-label="CC recipient email" type="email" value={value.email} onChange={event=>onChange({email:event.target.value})}/></div>
    </div>}
    {value.mode==='workspace_role'&&<div className="space-y-2">
      <Label>CC application workspace roles</Label>
      <p className="text-xs text-muted-foreground">Active users assigned the selected roles in this event's application receive a copy, including approval or send-back comments.</p>
      {rolesLoading&&<p className="text-sm text-muted-foreground">Loading roles...</p>}
      {rolesError&&<p role="alert" className="text-sm text-destructive">{rolesError}</p>}
      <div className="grid gap-2 sm:grid-cols-2">{roles.map(role=><label key={role.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <input type="checkbox" checked={value.roleNames.includes(role.name)} onChange={event=>onChange({roleNames:event.target.checked?[...new Set([...value.roleNames,role.name])]:value.roleNames.filter(name=>name!==role.name)})}/>{role.name}
      </label>)}</div>
      {!rolesLoading&&!rolesError&&!roles.length&&<p className="text-sm text-muted-foreground">No active roles are available for this application.</p>}
    </div>}
    {value.mode==='project_role'&&<div className="space-y-2"><Label>CC workspace role name</Label>
      <Input aria-label="CC workspace role name" value={value.roleName} onChange={event=>onChange({roleName:event.target.value})} placeholder="e.g. QA/QC Manager"/></div>}
    {(value.mode==='project_members'||value.mode==='project_role')&&<div className="space-y-2"><Label>CC project</Label>
      <Select value={value.projectIds[0]??''} onValueChange={projectId=>onChange({projectIds:[projectId]})}>
        <SelectTrigger aria-label="CC project"><SelectValue placeholder="Select project..." /></SelectTrigger>
        <SelectContent>{projects.map(project=><SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
      </Select></div>}
    {(value.mode==='linked_approver'||value.mode==='linked_creator')&&<p className="text-xs text-muted-foreground">Uses the {value.mode==='linked_approver'?'approver':'creator'} linked to this Lessons Learned form. The configured From and Reply-To behavior stays unchanged.</p>}
  </section>;
}
