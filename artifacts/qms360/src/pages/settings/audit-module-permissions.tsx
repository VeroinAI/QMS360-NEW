import type { Permission } from "@workspace/api-client-react";
import { auditModuleGroups, auditOperationLabels } from "@workspace/field-controls";
import { Checkbox } from "@/components/ui/checkbox";

export function AuditModulePermissions({ permissions, onToggle }: {
  permissions: Permission[];
  onToggle: (key: string, name: string) => void;
}) {
  return <section className="space-y-3" data-testid="audit-module-permissions">
    <div><h4 className="text-sm font-semibold">Module-level permissions</h4>
      <p className="text-xs text-muted-foreground">Grant access per module. Existing global grants above still apply; remove broad grants when limiting a role to selected modules. Application administrators retain their existing access within their assigned scope.</p></div>
    {auditModuleGroups.map(group => <fieldset key={group.module} className="rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{group.label}</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{group.actions.map(action => {
        const key = `audit.${group.module}.${action}`;
        return <label key={key} className="flex items-center gap-2 text-sm">
          <Checkbox data-testid={`permission-${key}`} checked={permissions.some(permission => permission.key === key)}
            onCheckedChange={() => onToggle(key, `${group.label}: ${auditOperationLabels[action]}`)} />
          <span>{auditOperationLabels[action]}</span>
        </label>;
      })}</div>
    </fieldset>)}
    <p className="text-xs text-muted-foreground">Create / edit schedules remains separate from the organization-wide Create Audit Programme grant. Schedule approval requires an Approval Level. Action grants do not replace view access or assignment scope.</p>
  </section>;
}