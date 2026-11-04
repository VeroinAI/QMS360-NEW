import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAuditPlans, listAuditSchedules, listPlatformProjects, useGetCurrentUser } from "@workspace/api-client-react";
import { formatDateTime } from "@workspace/spreadsheet-dates";
import { AlertTriangle, FilterX, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLov } from "@/lib/use-lov";
import { loadPlanOptionPages } from "./plan-schedule-options";
import type { Option, ScopeLookups } from "./schedule-register";
import { EMPTY_PLAN_FILTERS, planFilterOptions, type FieldValue, type PlanFilters, type PlanRow } from "./plan-register";

const ALL = "__all__";
const tone = (s?: string | null): "default" | "secondary" | "destructive" | "outline" =>
  !s ? "outline" : /reject|cancel/i.test(s) ? "destructive" : /approv|complete|sent|closed/i.test(s) ? "default" : "secondary";

/** Loads all authorized plans and linked (plan-context) schedules, plus label lookups. */
export function usePlanRegister() {
  const user = useGetCurrentUser();
  const userId = user.data?.id;
  const common = { enabled: !!userId, staleTime: 30_000, refetchOnMount: "always" as const, refetchOnWindowFocus: true };
  const plans = useQuery({
    queryKey: ["/api/audit/plans", { purpose: "plan-register-all" }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listAuditPlans({ page, limit: 100 }, { signal })),
    ...common,
  });
  const schedules = useQuery({
    queryKey: ["/api/audit/schedules", { purpose: "plan-register-linked", context: "plan" }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listAuditSchedules({ page, limit: 100, context: "plan" }, { signal })),
    ...common,
  });
  const projects = useQuery({
    queryKey: ["/api/platform/projects", { purpose: "plan-register-labels" }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listPlatformProjects({ page, limit: 100 }, { signal })),
    enabled: !!userId, staleTime: 60_000,
  });
  const departments = useLov("departments");
  const auditTypes = useLov("audit_types");
  const lookups = useMemo<ScopeLookups>(() => ({
    projects: new Map((projects.data ?? []).map(p => [p.id, p.code ? `${p.code} · ${p.name}` : p.name])),
    projectsFailed: !!projects.error,
    departments: new Map(departments.options.map(o => [o.value, o.label])),
  }), [projects.data, projects.error, departments.options]);
  const typeLabels = useMemo(() => new Map(auditTypes.options.map(o => [o.value, o.label])), [auditTypes.options]);
  const scheduleMap = useMemo(() => new Map((schedules.data ?? []).map(s => [s.id, s])), [schedules.data]);
  const lookupErrors = [
    schedules.error && { label: "linked audit schedules (Audit ID, Process Owner, Approval Status)", retry: () => void schedules.refetch() },
    projects.error && { label: "project names", retry: () => void projects.refetch() },
    departments.error && { label: "department names", retry: () => void departments.refetch() },
  ].filter(Boolean) as { label: string; retry: () => void }[];
  return { user, plans, schedules, scheduleMap, lookups, typeLabels, lookupErrors };
}

function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
    <Select value={value || ALL} onValueChange={v => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} data-testid={id} className="h-9"><SelectValue/></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>All</SelectItem>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select></div>;
}

export function PlanRegisterFilters({ rows, filters, onChange, typeLabels, lookupErrors }: { rows: PlanRow[]; filters: PlanFilters; onChange: (f: PlanFilters) => void; typeLabels: Map<string, string>; lookupErrors: { label: string; retry: () => void }[] }) {
  const o = useMemo(() => planFilterOptions(rows, typeLabels), [rows, typeLabels]);
  const set = (k: keyof PlanFilters) => (v: string) => onChange({ ...filters, [k]: v });
  const active = Object.values(filters).some(Boolean);
  return <div className="space-y-3 rounded-lg border bg-card p-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <FilterSelect id="filter-plan-audit-id" label="Audit ID" value={filters.auditId} options={o.auditIds} onChange={set("auditId")}/>
      <FilterSelect id="filter-plan-audit-type" label="Audit Type" value={filters.auditType} options={o.types} onChange={set("auditType")}/>
      <FilterSelect id="filter-plan-process-owner" label="Process Owner" value={filters.processOwner} options={o.owners} onChange={set("processOwner")}/>
      <FilterSelect id="filter-plan-status" label="Plan Status" value={filters.planStatus} options={o.planStatuses} onChange={set("planStatus")}/>
      <FilterSelect id="filter-plan-approval-status" label="Approval Status (audit schedule)" value={filters.approvalStatus} options={o.approvalStatuses} onChange={set("approvalStatus")}/>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5"/>Approval Status is the workflow state of the linked audit schedule; Audit Plans have no separate approval.</p>
      <Button size="sm" variant="ghost" disabled={!active} data-testid="button-clear-plan-filters" onClick={() => onChange(EMPTY_PLAN_FILTERS)}><FilterX className="mr-2 size-4"/>Clear filters</Button>
    </div>
    {lookupErrors.map(e => <div key={e.label} role="status" className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0"/>Unable to load {e.label}; affected values are shown as unavailable.</span><Button size="sm" variant="outline" onClick={e.retry}>Retry</Button></div>)}
  </div>;
}

const dash = <span className="text-muted-foreground" aria-label="Not recorded">—</span>;
const unavailable = <span className="italic text-muted-foreground">Unavailable</span>;
const field = (f: FieldValue, render: (v: string) => React.ReactNode = v => v) => f.value ? render(f.value) : f.source === "unavailable" ? unavailable : dash;
const dt = (v?: string | null) => v ? formatDateTime(v) : null;

const COLUMNS = ["Audit ID", "Audit Title", "Audit Type", "Audit Plan Reference Number", "Project/Department", "Process Owner", "Opening Meeting Date", "Closing Meeting Date", "Plan Status", "Approval Status"];

export function PlanRegisterTable({ rows, typeLabels, renderTitle, renderActions }: { rows: PlanRow[]; typeLabels: Map<string, string>; renderTitle: (r: PlanRow) => React.ReactNode; renderActions: (r: PlanRow) => React.ReactNode }) {
  const head = "h-11 whitespace-nowrap font-semibold text-primary-foreground";
  return <div className="overflow-x-auto rounded-lg border" role="region" aria-label="Audit plans register" tabIndex={0}>
    <Table>
      <TableHeader><TableRow className="bg-primary hover:bg-primary">
        {COLUMNS.map(h => <TableHead key={h} scope="col" className={head} title={h === "Approval Status" ? "Workflow state of the linked audit schedule" : undefined}>{h === "Approval Status" ? <>Approval Status<span className="block text-[10px] font-normal opacity-80">Audit schedule</span></> : h}</TableHead>)}
        <TableHead scope="col" className={`${head} text-right`}>Actions</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map(r => {
        const open = dt(r.plan.openingMeetingDateTime), close = dt(r.plan.closingMeetingDateTime);
        return <TableRow key={r.plan.id} data-testid={`row-plan-${r.plan.id}`}>
          <TableCell className="whitespace-nowrap font-mono text-sm" data-testid={`text-audit-id-${r.plan.id}`}>{field(r.auditId)}</TableCell>
          <TableCell className="min-w-48">{renderTitle(r)}</TableCell>
          <TableCell className="min-w-32">{r.plan.auditTypes.length ? r.plan.auditTypes.map(t => typeLabels.get(t) ?? t).join(", ") : dash}</TableCell>
          <TableCell className="whitespace-nowrap font-mono text-sm" data-testid={`text-plan-number-${r.plan.id}`}>{r.planReference ?? dash}</TableCell>
          <TableCell className="min-w-44">{r.scopes === null ? unavailable : r.scopes.length ? <ul className="space-y-1">{r.scopes.map(s => <li key={s.key}><span className={s.resolved ? "font-medium" : "italic text-muted-foreground"}>{s.label}</span> <span className="text-xs text-muted-foreground">{s.source}</span></li>)}</ul> : dash}</TableCell>
          <TableCell className="min-w-36" data-testid={`text-process-owner-${r.plan.id}`}>{field(r.processOwner)}</TableCell>
          <TableCell className="whitespace-nowrap">{open ?? dash}</TableCell>
          <TableCell className="whitespace-nowrap">{close ?? dash}</TableCell>
          <TableCell data-testid={`status-plan-${r.plan.id}`}><Badge variant={tone(r.planStatus)}>{r.planStatus}</Badge></TableCell>
          <TableCell data-testid={`status-approval-${r.plan.id}`}>{field(r.approvalStatus, v => <Badge variant={tone(v)}>{v}</Badge>)}</TableCell>
          <TableCell><div className="flex justify-end gap-2 whitespace-nowrap">{renderActions(r)}</div></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </div>;
}
