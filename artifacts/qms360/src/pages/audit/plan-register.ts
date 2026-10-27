import type { AuditPlan, AuditSchedule } from "@workspace/api-client-react";
import { scheduleScopes, type Option, type ScopeLookups, type ScopeRef } from "./schedule-register";

export type PlanFilters = { auditId: string; auditType: string; processOwner: string; planStatus: string; approvalStatus: string };
export const EMPTY_PLAN_FILTERS: PlanFilters = { auditId: "", auditType: "", processOwner: "", planStatus: "", approvalStatus: "" };

/** Linked-schedule lookup state; `failed` means we could not load schedules, so linked fields are unavailable (never guessed). */
export type ScheduleLookup = { byId: Map<string, AuditSchedule>; failed: boolean; loading: boolean };

export type FieldValue = { value: string | null; source: "schedule" | "plan" | "none" | "unavailable" };

export type PlanRow = {
  plan: AuditPlan;
  schedule?: AuditSchedule;
  auditId: FieldValue;
  /** Audit Plan Reference Number — always plan.planNumber, never the QA/QC reference. */
  planReference: string | null;
  processOwner: FieldValue;
  /** Approval status of the linked audit schedule (plans have no separate approval). */
  approvalStatus: FieldValue;
  planStatus: string;
  scopes: ScopeRef[] | null;
};

const clean = (v?: string | null) => (v ?? "").trim() || null;

export function buildPlanRow(plan: AuditPlan, lookup: ScheduleLookup, scopeLookups: ScopeLookups): PlanRow {
  const schedule = lookup.byId.get(plan.scheduleId);
  const unresolved = !schedule && (lookup.failed || lookup.loading);
  const linked = (pick: (s: AuditSchedule) => string | null | undefined): FieldValue => {
    if (schedule) { const v = clean(pick(schedule)); return v ? { value: v, source: "schedule" } : { value: null, source: "none" }; }
    return unresolved ? { value: null, source: "unavailable" } : { value: null, source: "none" };
  };
  let auditId = linked(s => s.qaqcReference);
  // Legacy / missing-linked records fall back to the reference saved on the plan itself.
  if (!schedule && !unresolved && clean(plan.qaqcReference)) auditId = { value: clean(plan.qaqcReference), source: "plan" };
  if (schedule && !auditId.value && clean(plan.qaqcReference)) auditId = { value: clean(plan.qaqcReference), source: "plan" };
  return {
    plan, schedule, auditId,
    planReference: clean(plan.planNumber),
    processOwner: linked(s => s.processProductOwner),
    approvalStatus: linked(s => s.workflowState),
    planStatus: plan.status,
    scopes: schedule ? scheduleScopes(schedule, scopeLookups) : unresolved ? null : [],
  };
}

export function filterPlanRows(rows: PlanRow[], filters: PlanFilters, search: string): PlanRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter(r =>
    (!q || r.plan.auditTitle.toLowerCase().includes(q))
    && (!filters.auditId || r.auditId.value === filters.auditId)
    && (!filters.auditType || r.plan.auditTypes.includes(filters.auditType))
    && (!filters.processOwner || r.processOwner.value === filters.processOwner)
    && (!filters.planStatus || r.planStatus === filters.planStatus)
    && (!filters.approvalStatus || r.approvalStatus.value === filters.approvalStatus));
}

const sorted = (m: Map<string, string>): Option[] => [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));

/** Options derived only from authorized plan rows; missing values are not offered. */
export function planFilterOptions(rows: PlanRow[], typeLabels: Map<string, string>) {
  const ids = new Map<string, string>(), types = new Map<string, string>(), owners = new Map<string, string>(), plan = new Map<string, string>(), approval = new Map<string, string>();
  for (const r of rows) {
    if (r.auditId.value) ids.set(r.auditId.value, r.auditId.value);
    for (const t of r.plan.auditTypes) if (t) types.set(t, typeLabels.get(t) ?? t);
    if (r.processOwner.value) owners.set(r.processOwner.value, r.processOwner.value);
    if (r.planStatus) plan.set(r.planStatus, r.planStatus);
    if (r.approvalStatus.value) approval.set(r.approvalStatus.value, r.approvalStatus.value);
  }
  return { auditIds: sorted(ids), types: sorted(types), owners: sorted(owners), planStatuses: sorted(plan), approvalStatuses: sorted(approval) };
}

/** Schedules already occupied by any loaded plan (all pages), plus server-side hasPlan. */
export function availablePlanSchedules(schedules: AuditSchedule[], plans: AuditPlan[]) {
  const occupied = new Set(plans.map(p => p.scheduleId));
  return schedules.filter(s => !s.hasPlan && !occupied.has(s.id) && s.feasibilityDecision !== "cancelled");
}
