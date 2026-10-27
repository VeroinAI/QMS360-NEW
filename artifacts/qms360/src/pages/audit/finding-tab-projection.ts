import type { ChecklistItem } from "@workspace/api-client-react";
import type { FindingRegisterItem } from "./finding-register";

export const FINDING_TAB_COLUMNS = [
  "Finding ID", "Audit ID", "Audit Title", "Project/Department", "Clause Reference", "Audit Area",
  "Description", "Finding Type", "Risk Level", "Audit Team Lead", "Action Taker",
  "Finding Date", "Evidence", "Recommended priority actions",
] as const;

export const FINDING_TAB_FILTERS = [
  ["auditTitle", "Audit Title"], ["projectDepartment", "Project/Department"], ["auditArea", "Audit Area"],
  ["findingType", "Finding Type"], ["riskLevel", "Risk Level"], ["auditTeamLead", "Audit Team Lead"], ["actionTaker", "Action Taker"],
] as const;

export type FindingTabRow =
  | { kind: "current"; key: string; item: ChecklistItem; reg: FindingRegisterItem }
  | { kind: "legacy"; key: string; reg: FindingRegisterItem };

export const isFindingItem = (item: ChecklistItem) => {
  const c = item.auditFinding || item.result;
  return !!c && c.trim().toLowerCase() !== "not applicable";
};

/**
 * Projects current checklist items (authoritative for editable fields) with read-only
 * register metadata for the same Audit only. Cross-audit and orphan metadata rows are ignored.
 */
export function projectFindingTab(opts: {
  auditId: string; auditTitle: string; items: ChecklistItem[];
  registerRows?: readonly FindingRegisterItem[] | null;
  areaLabel?: (value: string) => string; userName?: (id: string) => string | null;
}): FindingTabRow[] {
  const { auditId, auditTitle, items } = opts;
  const own = (opts.registerRows ?? []).filter(r => r.auditExecutionId === auditId);
  const meta = new Map(own.filter(r => r.source === "checklist").map(r => [r.id, r]));
  const area = (v?: string | null) => (v ? (opts.areaLabel?.(v) ?? v) : null);
  const current: FindingTabRow[] = items.filter(isFindingItem).map(item => {
    const m = meta.get(`checklist:${auditId}:${item.id}`);
    const takerId = item.actionTakerId || null;
    const takerName = takerId ? (opts.userName?.(takerId) ?? m?.actionTakers.find(a => a.id === takerId)?.name ?? null) : null;
    const reg: FindingRegisterItem = {
      id: `checklist:${auditId}:${item.id}`, source: "checklist", auditExecutionId: auditId,
      findingNumber: item.findingNumber?.trim() || null,
      auditId: m?.auditId ?? null, auditTitle: m?.auditTitle || auditTitle,
      projectDepartment: m?.projectDepartment ?? null,
      clauseReference: item.clause?.trim() || null, auditArea: area(item.auditArea),
      description: (item.description || item.notes)?.trim() || null,
      findingType: (item.auditFinding || item.result) ?? null,
      riskLevel: m?.riskLevel ?? null,
      auditTeamLeadId: m?.auditTeamLeadId ?? null, auditTeamLeadName: m?.auditTeamLeadName ?? null,
      actionTakers: takerId ? [{ id: takerId, name: takerName }] : [],
    };
    return { kind: "current", key: item.id, item, reg };
  });
  const legacy: FindingTabRow[] = own.filter(r => r.source === "legacy").map(r => ({
    kind: "legacy", key: r.id, reg: { ...r, auditTitle: r.auditTitle || auditTitle, auditArea: area(r.auditArea) },
  }));
  return [...current, ...legacy];
}
