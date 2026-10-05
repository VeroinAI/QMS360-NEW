import { useState } from 'react';
import { useListMasterDataRoles, type MasterDataRoleAssignment } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { roleKey, toggleRole } from './role-selection';

const applications = { qaqc: 'QA/QC', lessons: 'Lessons', audit: 'QMS Audit' };
export function MasterDataRolePicker({ scope, value, onChange }: {
  scope: string; value: MasterDataRoleAssignment[]; onChange: (roles: MasterDataRoleAssignment[]) => void;
}) {
  const roles = useListMasterDataRoles();
  const [search, setSearch] = useState('');
  const options = (roles.data?.items ?? []).filter(role => scope === 'global' || role.application === scope);
  const visible = options.filter(role => `${applications[role.application]} ${role.name}`.toLowerCase().includes(search.toLowerCase()));
  const unavailable = roles.data ? value.filter(role =>
    !options.some(option => roleKey(role) === roleKey({ application: option.application, roleId: option.id }))) : [];
  return <fieldset className="space-y-3 rounded-md border p-3">
    <legend className="px-1 text-sm font-medium">Assigned Roles (optional)</legend>
    <p className="text-xs text-muted-foreground">Select one or multiple application roles. Assignments are saved with this value only; they do not change permissions or dropdown visibility.</p>
    {roles.isLoading && <p className="text-sm text-muted-foreground">Loading roles…</p>}
    {roles.isError && <div role="alert" className="text-sm text-destructive">Unable to load roles. Existing selections are retained.
      <Button type="button" variant="link" size="sm" onClick={() => void roles.refetch()}>Retry</Button>
    </div>}
    {roles.data && <>
      <Input aria-label="Search application roles" placeholder="Search roles…" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="max-h-40 space-y-2 overflow-y-auto">
        {visible.map(role => {
          const assignment = { application: role.application, roleId: role.id };
          const selected = value.some(item => roleKey(item) === roleKey(assignment));
          return <label key={roleKey(assignment)} className="flex items-start gap-2 text-sm">
            <Checkbox checked={selected} disabled={!role.active && !selected}
              onCheckedChange={checked => onChange(toggleRole(value, assignment, checked === true))} />
            <span>{role.name}<span className="ml-1 text-xs text-muted-foreground">· {applications[role.application]}{!role.active && ' · Inactive (remove to save)'}</span></span>
          </label>;
        })}
        {!visible.length && <p className="text-sm text-muted-foreground">{options.length ? 'No roles match your search.' : 'No application roles are available for this group.'}</p>}
        {unavailable.map(role => <label key={roleKey(role)} className="flex items-start gap-2 text-sm text-destructive">
          <Checkbox checked onCheckedChange={() => onChange(toggleRole(value, role, false))} />
          <span>Unavailable role · {applications[role.application]}<span className="block text-xs">Remove this selection before saving.</span></span>
        </label>)}
      </div>
    </>}
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{value.length} {value.length === 1 ? 'role' : 'roles'} selected</span>
      {!!value.length && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>Clear roles</Button>}
    </div>
  </fieldset>;
}