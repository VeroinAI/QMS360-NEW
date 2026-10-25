import type { Permission } from "@workspace/api-client-react";
import { auditApprovalModuleOptions, auditModuleGroups, auditOperationLabels } from "@workspace/field-controls";
import { Checkbox } from "@/components/ui/checkbox";

export function AuditModulePermissions({ permissions, onToggle }: {
  permissions: Permission[];
  onToggle: (key: string, name: string) => void;
}) {
  const approving = permissions.some(p => ["approve_reject", "schedules.approve_reject", ...auditApprovalModuleOptions.map(option => option.key)].includes(p.key));
  const selected = auditApprovalModuleOptions.some(option => permissions.some(p => p.key === option.key || option.key === "audit.schedules.approve_reject" && String(p.key) === "schedules.approve_reject"));
  return <section className="space-y-3" data-testid="audit-module-permissions">
    {approving && <fieldset className="space-y-3 rounded-lg border p-3" data-testid="audit-approval-modules" aria-invalid={!selected}>
      <legend className="px-1 text-sm font-semibold">Approval applies to *</legend>
      <p className="text-xs text-muted-foreground">Select at least one module. The Approval Level applies separately within each selected module. Existing submissions keep their saved route.</p>
      {auditApprovalModuleOptions.map(option => <label key={option.key} className="flex items-center gap-2 text-sm">
        <Checkbox data-testid={`approval-module-${option.key}`} checked={permissions.some(p => p.key === option.key || option.key === "audit.schedules.approve_reject" && String(p.key) === "schedules.approve_reject")}
          onCheckedChange={() => {
            const stored = permissions.find(p => p.key === option.key || option.key === "audit.schedules.approve_reject" && String(p.key) === "schedules.approve_reject");
            onToggle(stored?.key ?? option.key, `${option.label}: Approve / reject`);
          }} />{option.label}
      </label>)}
      {!selected && <p role="alert" className="text-xs text-destructive">Select an approval module before saving this role.</p>}
    </fieldset>}
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
    <p className="text-xs text-muted-foreground">Create / edit schedules remains separate from the organization-wide Create Audit Programme grant. Schedule, Audit Report and Corrective Action Report approval require a positive whole-number Approval Level. Audit Reports enter approval when marked Complete; CAR responses enter approval on submission. Action grants do not replace view access or assignment scope.</p>
  </section>;
}
