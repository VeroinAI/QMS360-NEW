export type CcTarget = {
  mode: string; userId?: string; name?: string; email?: string;
  roleName?: string; roleNames?: string[]; projectIds?: string[];
};
const modes = ['all_users', 'internal_user', 'external_email', 'workspace_role', 'project_members', 'project_role', 'linked_approver', 'linked_creator'];
/** Shared by create/update; legacy role-only CC is checked as workspace_role too. */
export function emailCcTargetError(toMode: string, cc: CcTarget | undefined, eventType: string): string | undefined {
  if (!cc) return;
  if (!modes.includes(cc.mode)) return 'Select a valid CC recipient mode.';
  if (cc.mode === toMode && cc.mode !== 'workspace_role') return 'CC recipient mode must differ from Recipient mode. Select a different CC mode or remove CC.';
  if (['workspace_role','project_role'].includes(cc.mode) && !['audit','lessons','qaqc'].includes(eventType.split('.')[0]!))
    return 'CC workspace-role modes require an Audit, Lessons Learned or QA/QC event.';
  if (['linked_approver','linked_creator'].includes(cc.mode) && !eventType.startsWith('lessons.lesson_form.'))
    return 'Linked Lessons approver and creator CC modes are only available for Lessons Learned form events.';
  if (cc.mode === 'internal_user' && !cc.userId?.trim()) return 'Select an internal CC user.';
  if (cc.mode === 'external_email' && (!cc.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cc.email ?? '')))
    return 'Enter a valid external CC name and email.';
  if (cc.mode === 'workspace_role' && !cc.roleNames?.some(name => name.trim())) return 'Select at least one CC workspace role.';
  if (cc.mode === 'project_role' && !cc.roleName?.trim()) return 'Enter a CC workspace role name.';
  if (['project_members','project_role'].includes(cc.mode) && !cc.projectIds?.length) return 'Select a CC project.';
  return undefined;
}
