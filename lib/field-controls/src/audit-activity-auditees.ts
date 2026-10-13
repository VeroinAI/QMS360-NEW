type ActivityAuditeeSelection = {
  roleIds?: readonly string[];
  auditeeIds?: readonly string[];
  auditeeId?: string;
};

/** Explicit arrays preserve cleared selections; the scalar is for legacy plans. */
export function auditActivityAuditeeIds(activity: ActivityAuditeeSelection): string[] {
  return (activity.auditeeIds ?? (activity.auditeeId ? [activity.auditeeId] : []))
    .filter(id => id.trim().length > 0);
}

/** Activity roles are a valid selection even without schedule-local user defaults. */
export function hasAuditActivityAuditeeSelection(activity: ActivityAuditeeSelection): boolean {
  return !!activity.roleIds?.some(id => id.trim().length > 0) || auditActivityAuditeeIds(activity).length > 0;
}
