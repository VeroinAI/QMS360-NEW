/** Lead / Internal Auditor and Audit Team are separate participant selections. */
export function auditTeamWithoutLead(teamMemberIds: readonly string[], leadAuditorId: string): string[] {
  return teamMemberIds.filter(id => id !== leadAuditorId);
}
