export type RegisterFinding = {
  id: string; auditId: string; classification: string; riskLevel?: string | null;
  description?: string | null; status?: string | null; evidence?: Record<string, unknown> | null;
};
type Taker = { id: string; name: string | null };
export type FindingRegisterContext = {
  auditExecutionId: string; auditId: string | null; auditTitle: string;
  projectDepartment: string | null; auditTeamLeadId: string | null; auditTeamLeadName: string | null;
  fullVisibility: boolean; viewerId: string; teamIds: string[];
  names: Map<string, string>; owners: Map<string, string[]>;
  label: (group: string, value: string | null) => string | null;
};
export const registerText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
export const registerJson = (value: string | null | undefined): Record<string, unknown> => {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
};
const applicable = (value: unknown) => {
  const text = registerText(value)?.toLowerCase();
  return !!text && !["not applicable", "not_applicable", "n/a"].includes(text);
};

/** Pure, read-only projection: no number issuance, CAR creation, or historical reassignment. */
export function mapAuditFindingRegister(checklist: unknown, findings: RegisterFinding[], context: FindingRegisterContext) {
  const rows = [];
  const items: Record<string, unknown>[] = Array.isArray(checklist)
    ? checklist.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
  const people = (ids: string[]): Taker[] => [...new Set(ids)].map(id => ({ id, name: context.names.get(id) ?? null }));
  const common = {
    auditExecutionId: context.auditExecutionId, auditId: context.auditId, auditTitle: context.auditTitle,
    projectDepartment: context.projectDepartment, auditTeamLeadId: context.auditTeamLeadId,
    auditTeamLeadName: context.auditTeamLeadName,
  };
  const visible = (takers: Taker[]) => context.fullVisibility || context.auditTeamLeadId === context.viewerId
    || context.teamIds.includes(context.viewerId) || takers.some(person => person.id === context.viewerId);
  const current = findings.filter(f => f.status?.toLowerCase() !== "deleted");
  const seen = new Set<string>();
  for (const item of items) {
    const itemId = registerText(item.id);
    const classification = registerText(item.auditFinding) ?? registerText(item.result);
    if (!itemId || seen.has(itemId) || !applicable(classification)) continue;
    seen.add(itemId);
    const mirror = current.find(f => f.evidence?.sourceChecklistItemId === itemId);
    // The live checklist assignee is authoritative; an old CAR owner cannot replace it.
    const actionTakers = people(registerText(item.actionTakerId) ? [String(item.actionTakerId)] : []);
    if (!visible(actionTakers)) continue;
    rows.push({
      ...common, id: `checklist:${context.auditExecutionId}:${itemId}`, source: "checklist" as const,
      findingNumber: registerText(item.findingNumber),
      clauseReference: registerText(item.clause),
      auditArea: context.label("Audit Area", registerText(item.auditArea)),
      description: registerText(item.description) ?? registerText(item.question),
      findingType: context.label("nc_classifications", classification),
      riskLevel: context.label("risk_levels", registerText(item.riskLevel) ?? registerText(mirror?.riskLevel)),
      actionTakers,
    });
  }
  for (const finding of current) {
    // Mirrors of deleted/inapplicable checklist rows stay in history, not the active register.
    if (finding.evidence?.sourceChecklistItemId || !applicable(finding.classification)) continue;
    const actionTakers = people(context.owners.get(finding.id) ?? []);
    if (!visible(actionTakers)) continue;
    rows.push({
      ...common, id: `legacy:${finding.id}`, source: "legacy" as const,
      findingNumber: registerText(finding.evidence?.findingNumber),
      clauseReference: registerText(finding.evidence?.clause),
      // Responsible Department is not Audit Area: never substitute unrelated fields.
      auditArea: context.label("Audit Area", registerText(finding.evidence?.auditArea)),
      description: registerText(finding.description),
      findingType: context.label("nc_classifications", registerText(finding.classification)),
      riskLevel: context.label("risk_levels", registerText(finding.riskLevel)),
      actionTakers,
    });
  }
  return rows;
}
