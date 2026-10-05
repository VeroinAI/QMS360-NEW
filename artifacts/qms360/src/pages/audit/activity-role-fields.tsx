import type { AuditActivityRoleAssignment } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Option = { id: string; name: string };
export function ActivityMultiSelect({ label, options, value, onChange, disabled = false }: {
  label: string; options: Option[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const missing = value.filter(id => !options.some(option => option.id === id));
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...value, id])] : value.filter(item => item !== id));
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button type="button" variant="outline" disabled={disabled} aria-label={label} className="h-auto min-h-10 w-full justify-start whitespace-normal text-left font-normal">
      {value.length ? value.map(id => options.find(option => option.id === id)?.name ?? `Unavailable selection (${id})`).join(", ") : label}
    </Button>
  </DropdownMenuTrigger><DropdownMenuContent className="max-h-72 max-w-md overflow-y-auto">
    {options.map(option => <DropdownMenuCheckboxItem key={option.id} checked={value.includes(option.id)}
      onSelect={event => event.preventDefault()} onCheckedChange={checked => toggle(option.id, checked === true)}>{option.name}</DropdownMenuCheckboxItem>)}
    {missing.map(id => <DropdownMenuCheckboxItem key={id} checked onCheckedChange={() => toggle(id, false)}
      onSelect={event => event.preventDefault()}>Unavailable selection — remove ({id})</DropdownMenuCheckboxItem>)}
    {!options.length && <p className="px-2 py-1 text-sm text-muted-foreground">No available options.</p>}
  </DropdownMenuContent></DropdownMenu>;
}

export function ScheduleActivityRoleFields({ value, onChange, roles, users, disabled }: {
  value: AuditActivityRoleAssignment[]; onChange: (value: AuditActivityRoleAssignment[]) => void;
  roles: Option[]; users: Option[]; disabled: boolean;
}) {
  return <fieldset className="space-y-3 rounded-md border p-3">
    <legend className="px-1 font-medium">13. Activity roles and auditee assignments</legend>
    <p className="text-sm text-muted-foreground">Select roles and assign one or multiple QMS Audit users to each. These are defaults for activity auditees in this schedule’s Audit Plan, not permission grants.</p>
    {value.map((item, index) => <div key={index} className="space-y-2 rounded-md border p-3">
      <Label>Activity role {index + 1}</Label>
      <Select value={item.roleId} disabled={disabled} onValueChange={roleId => onChange(value.map((row, at) => at === index ? { ...row, roleId } : row))}>
        <SelectTrigger aria-label={`Activity role ${index + 1}`}><SelectValue placeholder="Select activity role"/></SelectTrigger>
        <SelectContent>{roles.map(role => <SelectItem key={role.id} value={role.id}
          disabled={role.id !== item.roleId && value.some(row => row.roleId === role.id)}>{role.name}</SelectItem>)}
          {item.roleId && !roles.some(role => role.id === item.roleId) && <SelectItem value={item.roleId}>Unavailable role — replace or remove</SelectItem>}
        </SelectContent>
      </Select>
      <Label>Assigned users</Label>
      <ActivityMultiSelect label={`Select users for activity role ${index + 1}`} options={users} value={item.userIds} disabled={disabled}
        onChange={userIds => onChange(value.map((row, at) => at === index ? { ...row, userIds } : row))}/>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(value.filter((_, at) => at !== index))}>Remove role assignment</Button>
    </div>)}
    <Button type="button" variant="outline" disabled={disabled || value.length >= 200}
      onClick={() => onChange([...value, { roleId: "", userIds: [] }])}>Add activity role</Button>
  </fieldset>;
}