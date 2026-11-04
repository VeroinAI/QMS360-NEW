import type { AuditSchedule } from "@workspace/api-client-react";
import { parseSpreadsheetDate } from "@workspace/spreadsheet-dates";

/** One project/department reference on an audit, keyed so projects and departments never collide. */
export type ScopeRef = { key: string; source: "Project" | "Department"; label: string; resolved: boolean };

export type RegisterFilters = {
  auditType: string;
  auditCategory: string;
  scope: string;
  location: string;
  status: string;
  from: string;
  to: string;
};

export const EMPTY_FILTERS: RegisterFilters = { auditType: "", auditCategory: "", scope: "", location: "", status: "", from: "", to: "" };
export const NO_LOCATION = "__none__";

export type ScopeLookups = {
  projects: Map<string, string>;
  projectsFailed: boolean;
  departments: Map<string, string>;
};

/** Resolve project IDs / department values to readable labels; never surface raw IDs. */
export function scheduleScopes(schedule: Pick<AuditSchedule, "projectIds" | "departmentProject">, lookups: ScopeLookups): ScopeRef[] {
  const ids = (schedule.projectIds ?? []).filter(Boolean);
  if (ids.length) {
    return ids.map(id => {
      const name = lookups.projects.get(id);
      return {
        key: `project:${id}`,
        source: "Project" as const,
        label: name ?? (lookups.projectsFailed ? "Project name unavailable" : "Project not accessible"),
        resolved: !!name,
      };
    });
  }
  const department = schedule.departmentProject?.trim();
  if (department) {
    const label = lookups.departments.get(department) ?? department;
    return [{ key: `department:${department}`, source: "Department", label, resolved: true }];
  }
  return [];
}

export const locationKey = (schedule: Pick<AuditSchedule, "location">) => schedule.location?.trim() || NO_LOCATION;

/** Calendar date (YYYY-MM-DD) from an ISO date or datetime string. */
const day = (value?: string | null) => value ? value.slice(0, 10) : "";

export function dateRangeError(from: string, to: string): string | null {
  for (const [value, name] of [[from, "From"], [to, "To"]]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parseSpreadsheetDate(value, { dateFormat: "YYYY-MM-DD" }))) {
      return `Enter a valid ${name} date.`;
    }
  }
  return from && to && from > to ? "The From date must be on or before the To date." : null;
}

/** Inclusive overlap between the audit interval and an optional From/To filter. */
export function overlapsRange(schedule: Pick<AuditSchedule, "plannedStartDate" | "plannedEndDate">, from: string, to: string): boolean {
  if (!from && !to) return true;
  const start = day(schedule.plannedStartDate) || day(schedule.plannedEndDate);
  const end = day(schedule.plannedEndDate) || start;
  if (!start) return false; // undated audits cannot match a date filter
  if (from && end < from) return false;
  if (to && start > to) return false;
  return true;
}

export function filterSchedules(items: AuditSchedule[], filters: RegisterFilters, lookups: ScopeLookups): AuditSchedule[] {
  if (dateRangeError(filters.from, filters.to)) return [];
  return items.filter(item =>
    (!filters.auditType || (item.auditTypes ?? []).includes(filters.auditType))
    && (!filters.auditCategory || item.auditCategory === filters.auditCategory)
    && (!filters.scope || scheduleScopes(item, lookups).some(scope => scope.key === filters.scope))
    && (!filters.location || locationKey(item) === filters.location)
    && (!filters.status || item.workflowState === filters.status)
    && overlapsRange(item, filters.from, filters.to));
}

export function paginate<T>(items: T[], page: number, size: number): { rows: T[]; page: number } {
  const last = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), last);
  return { rows: items.slice((current - 1) * size, current * size), page: current };
}

export type Option = { value: string; label: string };

const sorted = (map: Map<string, string>) => [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));

/** Filter choices derived from authorized rows, labelled from master data where available. */
export function filterOptions(items: AuditSchedule[], lookups: ScopeLookups, typeLabels: Map<string, string>, categoryLabels: Map<string, string>) {
  const types = new Map<string, string>(), categories = new Map<string, string>(), scopes = new Map<string, string>(), locations = new Map<string, string>(), statuses = new Map<string, string>();
  for (const item of items) {
    for (const type of item.auditTypes ?? []) if (type) types.set(type, typeLabels.get(type) ?? type);
    if (item.auditCategory) categories.set(item.auditCategory, categoryLabels.get(item.auditCategory) ?? item.auditCategory);
    for (const scope of scheduleScopes(item, lookups)) scopes.set(scope.key, `${scope.label} (${scope.source})`);
    const loc = locationKey(item);
    locations.set(loc, loc === NO_LOCATION ? "No location recorded" : loc);
    statuses.set(item.workflowState, item.workflowState);
  }
  return { types: sorted(types), categories: sorted(categories), scopes: sorted(scopes), locations: sorted(locations), statuses: sorted(statuses) };
}
