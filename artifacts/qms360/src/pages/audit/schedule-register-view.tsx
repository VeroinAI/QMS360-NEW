import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAuditSchedules, listPlatformProjects, useGetCurrentUser, type AuditSchedule } from "@workspace/api-client-react";
import { formatDate } from "@workspace/spreadsheet-dates";
import { AlertTriangle, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLov } from "@/lib/use-lov";
import { loadPlanOptionPages } from "./plan-schedule-options";
import { EMPTY_FILTERS, dateRangeError, filterOptions, locationKey, NO_LOCATION, scheduleScopes, type Option, type RegisterFilters, type ScopeLookups } from "./schedule-register";

const ALL = "__all__";
const date = (value?: string | null) => value ? formatDate(value) : null;

/** Loads every authorized child audit page (optionally within one programme) plus label lookups. */
export function useScheduleRegister(parentId?: string) {
  const user = useGetCurrentUser();
  const userId = user.data?.id;
  const schedules = useQuery({
    queryKey: ["/api/audit/schedules", { purpose: "register-all", parentId: parentId ?? null }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listAuditSchedules({ page, limit: 100, ...(parentId ? { parentId } : {}) }, { signal })),
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const projects = useQuery({
    queryKey: ["/api/platform/projects", { purpose: "register-labels" }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listPlatformProjects({ page, limit: 100 }, { signal })),
    enabled: !!userId,
  });
  const departments = useLov("departments");
  const auditTypes = useLov("audit_types");
  const categories = useLov("audit_categories");
  const lookups = useMemo<ScopeLookups>(() => ({
    projects: new Map((projects.data ?? []).map(project => [project.id, project.code ? `${project.code} · ${project.name}` : project.name])),
    projectsFailed: !!projects.error,
    departments: new Map(departments.options.map(option => [option.value, option.label])),
  }), [projects.data, projects.error, departments.options]);
  const typeLabels = useMemo(() => new Map(auditTypes.options.map(o => [o.value, o.label])), [auditTypes.options]);
  const categoryLabels = useMemo(() => new Map(categories.options.map(o => [o.value, o.label])), [categories.options]);
  const masterErrors = [projects.error && { label: "project names", retry: () => void projects.refetch() }, departments.error && { label: "department names", retry: () => void departments.refetch() }].filter(Boolean) as { label: string; retry: () => void }[];
  return { schedules, lookups, typeLabels, categoryLabels, masterErrors, loading: user.isLoading || schedules.isLoading || projects.isLoading || departments.isLoading, error: user.error ?? schedules.error };
}

function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
    <Select value={value || ALL} onValueChange={v => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} data-testid={id} className="h-9"><SelectValue/></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>All</SelectItem>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select></div>;
}

export function ScheduleRegisterFilters({ items, filters, onChange, lookups, typeLabels, categoryLabels, masterErrors }: { items: AuditSchedule[]; filters: RegisterFilters; onChange: (next: RegisterFilters) => void; lookups: ScopeLookups; typeLabels: Map<string, string>; categoryLabels: Map<string, string>; masterErrors: { label: string; retry: () => void }[] }) {
  const options = useMemo(() => filterOptions(items, lookups, typeLabels, categoryLabels), [items, lookups, typeLabels, categoryLabels]);
  const set = (key: keyof RegisterFilters) => (value: string) => onChange({ ...filters, [key]: value });
  const rangeError = dateRangeError(filters.from, filters.to);
  const active = Object.values(filters).some(Boolean);
  return <div className="space-y-3 rounded-lg border bg-card p-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <FilterSelect id="filter-audit-type" label="Audit Type" value={filters.auditType} options={options.types} onChange={set("auditType")}/>
      <FilterSelect id="filter-audit-category" label="Audit Category" value={filters.auditCategory} options={options.categories} onChange={set("auditCategory")}/>
      <FilterSelect id="filter-scope" label="Project/Department" value={filters.scope} options={options.scopes} onChange={set("scope")}/>
      <FilterSelect id="filter-location" label="Location" value={filters.location} options={options.locations} onChange={set("location")}/>
      <div className="space-y-1.5"><Label htmlFor="filter-from" className="text-xs font-medium text-muted-foreground">Dates from</Label><Input id="filter-from" data-testid="input-filter-from" type="date" className="h-9" value={filters.from} max={filters.to || undefined} aria-invalid={!!rangeError} onChange={e => set("from")(e.target.value)}/></div>
      <div className="space-y-1.5"><Label htmlFor="filter-to" className="text-xs font-medium text-muted-foreground">Dates to</Label><Input id="filter-to" data-testid="input-filter-to" type="date" className="h-9" value={filters.to} min={filters.from || undefined} aria-invalid={!!rangeError} onChange={e => set("to")(e.target.value)}/></div>
      <FilterSelect id="filter-status" label="Status" value={filters.status} options={options.statuses} onChange={set("status")}/>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Dates match any audit whose planned period overlaps the range (inclusive).</p>
      <Button size="sm" variant="ghost" disabled={!active} data-testid="button-clear-filters" onClick={() => onChange(EMPTY_FILTERS)}><FilterX className="mr-2 size-4"/>Clear filters</Button>
    </div>
    {rangeError && <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-date-range-error">{rangeError}</p>}
    {masterErrors.map(e => <div key={e.label} role="status" className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="flex items-center gap-2"><AlertTriangle className="size-4"/>Unable to load {e.label}; affected labels are shown as unavailable.</span><Button size="sm" variant="outline" onClick={e.retry}>Retry</Button></div>)}
  </div>;
}

/** Seven requested columns in order; optional trailing Actions column. */
export function ScheduleRegisterTable({ rows, lookups, typeLabels, categoryLabels, renderTitle, renderStatus, renderActions }: { rows: AuditSchedule[]; lookups: ScopeLookups; typeLabels: Map<string, string>; categoryLabels: Map<string, string>; renderTitle: (item: AuditSchedule) => React.ReactNode; renderStatus: (item: AuditSchedule) => React.ReactNode; renderActions?: (item: AuditSchedule) => React.ReactNode }) {
  const head = "h-11 whitespace-nowrap font-semibold text-primary-foreground";
  const muted = <span className="text-muted-foreground">—</span>;
  return <Table>
    <TableHeader><TableRow className="bg-primary hover:bg-primary">
      {["Audit Title", "Audit Type", "Audit Category", "Project/Department", "Location", "Dates", "Status"].map(h => <TableHead key={h} className={head}>{h}</TableHead>)}
      {renderActions && <TableHead className={`${head} text-right`}>Actions</TableHead>}
    </TableRow></TableHeader>
    <TableBody>{rows.map(item => {
      const scopes = scheduleScopes(item, lookups);
      const start = date(item.plannedStartDate), end = date(item.plannedEndDate);
      return <TableRow key={item.id} data-testid={`row-schedule-${item.id}`}>
        <TableCell className="min-w-48">{renderTitle(item)}</TableCell>
        <TableCell>{item.auditTypes?.length ? item.auditTypes.map(t => typeLabels.get(t) ?? t).join(", ") : muted}</TableCell>
        <TableCell>{item.auditCategory ? categoryLabels.get(item.auditCategory) ?? item.auditCategory : muted}</TableCell>
        <TableCell className="min-w-44">{scopes.length ? <ul className="space-y-1">{scopes.map(s => <li key={s.key}><span className={s.resolved ? "font-medium" : "italic text-muted-foreground"}>{s.label}</span> <span className="text-xs text-muted-foreground">{s.source}</span></li>)}</ul> : muted}</TableCell>
        <TableCell>{locationKey(item) === NO_LOCATION ? muted : item.location}</TableCell>
        <TableCell className="whitespace-nowrap">{start || end ? `${start ?? "—"} – ${end ?? "—"}` : <span className="text-muted-foreground">Not scheduled</span>}</TableCell>
        <TableCell>{renderStatus(item)}</TableCell>
        {renderActions && <TableCell>{renderActions(item)}</TableCell>}
      </TableRow>;
    })}</TableBody>
  </Table>;
}
