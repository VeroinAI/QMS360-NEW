import type { Audit, AuditExecutionSummary } from "@workspace/api-client-react";
import type { Option } from "./schedule-register";

/** List-only read model supplied by the API. Absent means unavailable — never inferred. */
export type ExecutionSummary = AuditExecutionSummary;

export type ExecutionFilters = { auditId: string; auditLead: string; projectDepartment: string; auditStatus: string; reportStatus: string };
export const EMPTY_EXECUTION_FILTERS: ExecutionFilters = { auditId: "", auditLead: "", projectDepartment: "", auditStatus: "", reportStatus: "" };

export type ExecutionRow = {
  audit: Audit;
  /** null when the API did not provide a summary for this row. */
  summary: ExecutionSummary | null;
  auditStatus: string;
  /** Report approval status; null when not provided (never assumed Approved). */
  reportStatus: string | null;
};

const clean = (v?: string | null) => (v ?? "").trim() || null;

export function buildExecutionRow(audit: Audit): ExecutionRow {
  const raw = audit.executionSummary;
  const summary = raw && typeof raw === "object" ? {
    auditId: clean(raw.auditId),
    auditTypes: Array.isArray(raw.auditTypes) ? raw.auditTypes : [],
    projectDepartment: clean(raw.projectDepartment),
    auditLeadId: clean(raw.auditLeadId),
    auditLeadName: clean(raw.auditLeadName),
    findingCount: raw.findingCount,
    openFindingCount: raw.openFindingCount,
  } : null;
  const report = audit.reportApproval;
  return { audit, summary, auditStatus: audit.status, reportStatus: clean(report?.status) };
}

export const hasMissingSummaries = (rows: ExecutionRow[]) => rows.some(r => !r.summary);

export function filterExecutionRows(rows: ExecutionRow[], f: ExecutionFilters, search: string): ExecutionRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter(r =>
    (!q || r.audit.title.toLowerCase().includes(q))
    && (!f.auditId || r.summary?.auditId === f.auditId)
    && (!f.auditLead || r.summary?.auditLeadId === f.auditLead)
    && (!f.projectDepartment || r.summary?.projectDepartment === f.projectDepartment)
    && (!f.auditStatus || r.auditStatus === f.auditStatus)
    && (!f.reportStatus || r.reportStatus === f.reportStatus));
}

const sortOpts = (m: Map<string, string>): Option[] => [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));

/** Options derived only from loaded (authorized) rows. Leads keyed by stable user ID; duplicate names disambiguated. */
export function executionFilterOptions(rows: ExecutionRow[]) {
  const ids = new Map<string, string>(), scopes = new Map<string, string>(), audit = new Map<string, string>(), report = new Map<string, string>();
  const leads = new Map<string, string>();
  for (const r of rows) {
    const s = r.summary;
    if (s?.auditId) ids.set(s.auditId, s.auditId);
    if (s?.projectDepartment) scopes.set(s.projectDepartment, s.projectDepartment);
    if (s?.auditLeadId) leads.set(s.auditLeadId, s.auditLeadName ?? s.auditLeadId);
    audit.set(r.auditStatus, r.auditStatus);
    if (r.reportStatus) report.set(r.reportStatus, r.reportStatus);
  }
  const counts = new Map<string, number>();
  for (const n of leads.values()) counts.set(n, (counts.get(n) ?? 0) + 1);
  const leadLabels = new Map([...leads].map(([id, n]) => [id, (counts.get(n) ?? 0) > 1 ? `${n} (${id.slice(0, 8)})` : n]));
  return { auditIds: sortOpts(ids), leads: sortOpts(leadLabels), scopes: sortOpts(scopes), auditStatuses: sortOpts(audit), reportStatuses: sortOpts(report) };
}
