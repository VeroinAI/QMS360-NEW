import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAudits, useGetCurrentUser } from "@workspace/api-client-react";
import { AlertTriangle, FilterX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadPlanOptionPages } from "./plan-schedule-options";
import type { Option } from "./schedule-register";
import { EMPTY_EXECUTION_FILTERS, executionFilterOptions, type ExecutionFilters, type ExecutionRow } from "./execution-register";

const ALL = "__all__";
const tone = (s?: string | null): "default" | "secondary" | "destructive" | "outline" =>
  !s ? "outline" : /reject|cancel|sent back/i.test(s) ? "destructive" : /approv|complete|closed/i.test(s) ? "default" : "secondary";

/** Loads every authorized audit page (no page cap) for local filtering/pagination. */
export function useExecutionRegister() {
  const user = useGetCurrentUser();
  const userId = user.data?.id;
  const audits = useQuery({
    queryKey: ["/api/audit/audits", { purpose: "execution-register-all" }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listAudits({ page, limit: 100 }, { signal })),
    enabled: !!userId, staleTime: 30_000, refetchOnMount: "always" as const, refetchOnWindowFocus: true,
  });
  return { user, audits };
}

function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
    <Select value={value || ALL} onValueChange={v => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} data-testid={id} className="h-9"><SelectValue/></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>All</SelectItem>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select></div>;
}

export function ExecutionRegisterFilters({ rows, filters, onChange, missingSummaries, onRefresh }: { rows: ExecutionRow[]; filters: ExecutionFilters; onChange: (f: ExecutionFilters) => void; missingSummaries: boolean; onRefresh: () => void }) {
  const o = useMemo(() => executionFilterOptions(rows), [rows]);
  const set = (k: keyof ExecutionFilters) => (v: string) => onChange({ ...filters, [k]: v });
  const active = Object.values(filters).some(Boolean);
  return <div className="space-y-3 rounded-lg border bg-card p-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <FilterSelect id="filter-execution-audit-id" label="Audit ID" value={filters.auditId} options={o.auditIds} onChange={set("auditId")}/>
      <FilterSelect id="filter-execution-audit-lead" label="Audit Lead" value={filters.auditLead} options={o.leads} onChange={set("auditLead")}/>
      <FilterSelect id="filter-execution-project-department" label="Project/Department" value={filters.projectDepartment} options={o.scopes} onChange={set("projectDepartment")}/>
      <FilterSelect id="filter-execution-audit-status" label="Audit Status" value={filters.auditStatus} options={o.auditStatuses} onChange={set("auditStatus")}/>
      <FilterSelect id="filter-execution-report-status" label="Report Status" value={filters.reportStatus} options={o.reportStatuses} onChange={set("reportStatus")}/>
    </div>
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" disabled={!active} data-testid="button-clear-execution-filters" onClick={() => onChange(EMPTY_EXECUTION_FILTERS)}><FilterX className="mr-2 size-4"/>Clear filters</Button>
    </div>
    {missingSummaries && <div role="status" data-testid="status-execution-summary-missing" className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0"/>Some execution details could not be loaded; affected values are shown as unavailable.</span><Button size="sm" variant="outline" data-testid="button-refresh-execution" onClick={onRefresh}>Refresh</Button></div>}
  </div>;
}

const dash = <span className="text-muted-foreground" aria-label="Not recorded">—</span>;
const unavailable = <span className="italic text-muted-foreground">Unavailable</span>;

export const EXECUTION_COLUMNS = ["Audit ID", "Audit Title", "Audit Type", "Audit Plan Reference Number", "Project/Department", "Audit Lead", "Number of Findings", "Number of Open Findings", "Audit Status", "Report Status"];

export function ExecutionRegisterTable({ rows, typeLabels, renderActions }: { rows: ExecutionRow[]; typeLabels?: Map<string, string>; renderActions: (r: ExecutionRow) => React.ReactNode }) {
  const head = "h-11 whitespace-nowrap font-semibold text-primary-foreground";
  return <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Audit execution register" tabIndex={0}>
    <table className="w-full min-w-[1400px] caption-bottom text-sm">
      <TableHeader><TableRow className="bg-primary hover:bg-primary">
        {EXECUTION_COLUMNS.map(h => <TableHead key={h} scope="col" className={head}>{h}</TableHead>)}
        <TableHead scope="col" className={`${head} text-right`}>Actions</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map(r => {
        const a = r.audit, s = r.summary, id = a.id;
        const sv = (v: React.ReactNode | null | undefined) => !s ? unavailable : v ?? dash;
        return <TableRow key={id} data-testid={`row-execution-${id}`}>
          <TableCell className="whitespace-nowrap font-mono text-sm" data-testid={`text-execution-audit-id-${id}`}>{sv(s?.auditId)}</TableCell>
          <TableCell className="min-w-52">
            <div className="font-medium" data-testid={`text-execution-title-${id}`}>{a.title}</div>
            <div className="text-xs text-muted-foreground" data-testid={`execution-audit-report-number-${id}`}>Report No. <span className="break-all font-mono">{a.reportNumber || "Issued on first report details save"}</span></div>
          </TableCell>
          <TableCell className="min-w-32">{sv(s?.auditTypes.length ? s.auditTypes.map(t => typeLabels?.get(t) ?? t).join(", ") : null)}</TableCell>
          <TableCell className="whitespace-nowrap font-mono text-sm" data-testid="execution-audit-plan-number">{a.planNumber || dash}</TableCell>
          <TableCell className="min-w-40">{sv(s?.projectDepartment)}</TableCell>
          <TableCell className="min-w-36" data-testid={`text-execution-lead-${id}`}>{sv(s?.auditLeadName)}</TableCell>
          <TableCell className="text-right tabular-nums" data-testid={`text-execution-findings-${id}`}>{sv(s ? String(s.findingCount) : null)}</TableCell>
          <TableCell className="text-right tabular-nums" data-testid={`text-execution-open-findings-${id}`}>{sv(s ? String(s.openFindingCount) : null)}</TableCell>
          <TableCell data-testid={`status-execution-audit-${id}`}><Badge variant={tone(r.auditStatus)}>{r.auditStatus}</Badge></TableCell>
          <TableCell data-testid={`status-execution-report-${id}`}>{r.reportStatus ? <Badge variant={tone(r.reportStatus)}>{r.reportStatus}</Badge> : unavailable}</TableCell>
          <TableCell><div className="flex justify-end gap-2 whitespace-nowrap">{renderActions(r)}</div></TableCell>
        </TableRow>;
      })}</TableBody>
    </table>
  </div>;
}
