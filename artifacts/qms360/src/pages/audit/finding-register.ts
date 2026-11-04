import type { Option } from "./schedule-register";
import type { AuditFindingRegisterItem } from "@workspace/api-client-react";

export type FindingRegisterItem = AuditFindingRegisterItem;
export type FindingActionTaker = FindingRegisterItem["actionTakers"][number];

export type FindingFilters = {
  search: string; auditTitle: string; projectDepartment: string; auditArea: string;
  findingType: string; riskLevel: string; auditTeamLead: string; actionTaker: string;
};
export const EMPTY_FINDING_FILTERS: FindingFilters = {
  search: "", auditTitle: "", projectDepartment: "", auditArea: "", findingType: "", riskLevel: "", auditTeamLead: "", actionTaker: "",
};

const sortOpts = (o: Option[]) => o.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
const textOptions = (values: (string | null)[]) =>
  sortOpts(Array.from(new Set(values.filter((v): v is string => !!v && !!v.trim()))).map(v => ({ value: v, label: v })));

/** Stable user-id options; identical display names are disambiguated with a short id suffix. */
function userOptions(people: { id: string; name: string | null }[]): Option[] {
  const byId = new Map<string, string>();
  for (const p of people) if (p.id && !byId.has(p.id)) byId.set(p.id, p.name?.trim() || "Unnamed user");
  const counts = new Map<string, number>();
  byId.forEach(n => counts.set(n, (counts.get(n) ?? 0) + 1));
  return sortOpts(Array.from(byId, ([id, name]) => ({ value: id, label: (counts.get(name) ?? 0) > 1 ? `${name} (${id.slice(0, 8)})` : name })));
}

export function findingFilterOptions(rows: FindingRegisterItem[]) {
  return {
    auditTitles: textOptions(rows.map(r => r.auditTitle)),
    projectDepartments: textOptions(rows.map(r => r.projectDepartment)),
    auditAreas: textOptions(rows.map(r => r.auditArea)),
    findingTypes: textOptions(rows.map(r => r.findingType)),
    riskLevels: textOptions(rows.map(r => r.riskLevel)),
    leads: userOptions(rows.filter(r => r.auditTeamLeadId).map(r => ({ id: r.auditTeamLeadId!, name: r.auditTeamLeadName }))),
    actionTakers: userOptions(rows.flatMap(r => r.actionTakers)),
  };
}

export function filterFindingRows(rows: FindingRegisterItem[], f: FindingFilters) {
  const q = f.search.trim().toLowerCase();
  return rows.filter(r =>
    (!f.auditTitle || r.auditTitle === f.auditTitle)
    && (!f.projectDepartment || r.projectDepartment === f.projectDepartment)
    && (!f.auditArea || r.auditArea === f.auditArea)
    && (!f.findingType || r.findingType === f.findingType)
    && (!f.riskLevel || r.riskLevel === f.riskLevel)
    && (!f.auditTeamLead || r.auditTeamLeadId === f.auditTeamLead)
    && (!f.actionTaker || r.actionTakers.some(a => a.id === f.actionTaker))
    && (!q || [r.findingNumber, r.auditId, r.auditTitle, r.description, r.clauseReference].some(v => v?.toLowerCase().includes(q))));
}
