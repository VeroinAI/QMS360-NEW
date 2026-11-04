import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { listAuditFindingRegister, useGetCurrentUser } from "@workspace/api-client-react";
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, FilterX, RefreshCw, Search, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuditCapabilities } from "@/lib/use-audit-capabilities";
import { loadPlanOptionPages } from "./plan-schedule-options";
import type { Option } from "./schedule-register";
import { EMPTY_FINDING_FILTERS, filterFindingRows, findingFilterOptions, type FindingFilters, type FindingRegisterItem } from "./finding-register";

const ALL = "__all__";
const PAGE_SIZE = 20;

const listFindingRegister = listAuditFindingRegister;

export function useFindingRegister() {
  const user = useGetCurrentUser();
  const userId = user.data?.id;
  const findings = useQuery({
    queryKey: ["/api/audit/finding-register", { purpose: "finding-register-all" }, userId],
    queryFn: ({ signal }) => loadPlanOptionPages(page => listFindingRegister({ page, limit: 100 }, { signal })),
    enabled: !!userId, staleTime: 30_000, refetchOnMount: "always" as const, refetchOnWindowFocus: true,
  });
  return { user, findings };
}

function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
    <Select value={value || ALL} onValueChange={v => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} data-testid={id} className="h-9"><SelectValue/></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>All</SelectItem>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select></div>;
}

export const FINDING_COLUMNS = ["Finding ID", "Audit ID", "Audit Title", "Project/Department", "Clause Reference", "Audit Area", "Description", "Finding Type", "Risk Level", "Audit Team Lead", "Action Taker"];
const dash = <span className="text-muted-foreground" aria-label="Not recorded">—</span>;
const v = (x: string | null | undefined) => x?.trim() ? x : dash;

export function FindingRegisterTable({ rows, canOpenAudit }: { rows: FindingRegisterItem[]; canOpenAudit: boolean }) {
  const head = "h-11 whitespace-nowrap font-semibold text-primary-foreground";
  return <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Audit finding register" tabIndex={0}>
    <table className="w-full min-w-[1600px] caption-bottom text-sm">
      <TableHeader><TableRow className="bg-primary hover:bg-primary">
        {FINDING_COLUMNS.map(h => <TableHead key={h} scope="col" className={head}>{h}</TableHead>)}
        {canOpenAudit && <TableHead scope="col" className={`${head} text-right`}>Actions</TableHead>}
      </TableRow></TableHeader>
      <TableBody>{rows.map(r => <TableRow key={r.id} data-testid={`row-finding-${r.id}`}>
        <TableCell className="whitespace-nowrap font-mono text-sm" data-testid={`text-finding-number-${r.id}`}>{r.findingNumber ?? <span className="italic text-muted-foreground">Not numbered</span>}</TableCell>
        <TableCell className="whitespace-nowrap font-mono text-sm">{v(r.auditId)}</TableCell>
        <TableCell className="min-w-52 font-medium" data-testid={`text-finding-audit-title-${r.id}`}>{r.auditTitle}</TableCell>
        <TableCell className="min-w-40">{v(r.projectDepartment)}</TableCell>
        <TableCell className="min-w-28">{v(r.clauseReference)}</TableCell>
        <TableCell className="min-w-36">{v(r.auditArea)}</TableCell>
        <TableCell className="min-w-72 max-w-md whitespace-pre-wrap">{v(r.description)}</TableCell>
        <TableCell className="min-w-32">{r.findingType ? <Badge variant="secondary">{r.findingType}</Badge> : dash}</TableCell>
        <TableCell className="min-w-24">{r.riskLevel ? <Badge variant="outline">{r.riskLevel}</Badge> : dash}</TableCell>
        <TableCell className="min-w-36">{v(r.auditTeamLeadName)}</TableCell>
        <TableCell className="min-w-40">{r.actionTakers.length ? r.actionTakers.map(a => a.name || "Unnamed user").join(", ") : dash}</TableCell>
        {canOpenAudit && <TableCell className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/audit/audits/${r.auditExecutionId}`} data-testid={`link-open-audit-${r.id}`}><Eye className="mr-1 size-4"/>Open audit</Link></Button></TableCell>}
      </TableRow>)}</TableBody>
    </table>
  </div>;
}

export function FindingRegister() {
  const { user, findings } = useFindingRegister();
  const { canRead } = useAuditCapabilities();
  const [filters, setFilters] = useState<FindingFilters>(EMPTY_FINDING_FILTERS);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => findings.data ?? [], [findings.data]);
  const options = useMemo(() => findingFilterOptions(rows), [rows]);
  const filtered = useMemo(() => filterFindingRows(rows, filters), [rows, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const set = (k: keyof FindingFilters) => (val: string) => { setFilters(f => ({ ...f, [k]: val })); setPage(1); };
  const active = Object.values(filters).some(Boolean);
  const loading = user.isLoading || (findings.isLoading && !!user.data);

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">Audit findings</h1>
        <p className="text-sm text-muted-foreground">Every finding recorded across the audits you can access.</p></div>
      {findings.data && <p className="text-sm text-muted-foreground" data-testid="text-finding-count">{filtered.length} of {rows.length} findings</p>}
    </div>
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
        <Input aria-label="Search findings" placeholder="Search finding ID, audit, clause or description" className="pl-9" value={filters.search} onChange={e => set("search")(e.target.value)} data-testid="input-search-findings"/></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <FilterSelect id="filter-finding-audit-title" label="Audit Title" value={filters.auditTitle} options={options.auditTitles} onChange={set("auditTitle")}/>
        <FilterSelect id="filter-finding-project-department" label="Project/Department" value={filters.projectDepartment} options={options.projectDepartments} onChange={set("projectDepartment")}/>
        <FilterSelect id="filter-finding-audit-area" label="Audit Area" value={filters.auditArea} options={options.auditAreas} onChange={set("auditArea")}/>
        <FilterSelect id="filter-finding-type" label="Finding Type" value={filters.findingType} options={options.findingTypes} onChange={set("findingType")}/>
        <FilterSelect id="filter-finding-risk-level" label="Risk Level" value={filters.riskLevel} options={options.riskLevels} onChange={set("riskLevel")}/>
        <FilterSelect id="filter-finding-team-lead" label="Audit Team Lead" value={filters.auditTeamLead} options={options.leads} onChange={set("auditTeamLead")}/>
        <FilterSelect id="filter-finding-action-taker" label="Action Taker" value={filters.actionTaker} options={options.actionTakers} onChange={set("actionTaker")}/>
      </div>
      <div className="flex justify-end"><Button size="sm" variant="ghost" disabled={!active} data-testid="button-clear-finding-filters" onClick={() => { setFilters(EMPTY_FINDING_FILTERS); setPage(1); }}><FilterX className="mr-2 size-4"/>Clear filters</Button></div>
    </div>

    {loading ? <div className="space-y-2" data-testid="status-findings-loading">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11 w-full"/>)}</div>
      : user.isError || findings.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="status-findings-error">
        <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-destructive"/>Findings could not be loaded. {findings.error instanceof Error ? findings.error.message : ""}</span>
        <Button size="sm" variant="outline" onClick={() => { void user.refetch(); void findings.refetch(); }} data-testid="button-retry-findings"><RefreshCw className="mr-2 size-4"/>Retry</Button></div>
      : rows.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center" data-testid="status-findings-empty"><SearchX className="mx-auto mb-2 size-8 text-primary/60"/><p className="font-medium">No findings recorded yet</p><p className="text-sm text-muted-foreground">Findings raised during audit execution will appear here.</p></div>
      : filtered.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center" data-testid="status-findings-no-match"><p className="font-medium">No findings match these filters</p><Button size="sm" variant="link" onClick={() => { setFilters(EMPTY_FINDING_FILTERS); setPage(1); }}>Clear filters</Button></div>
      : <>
        <FindingRegisterTable rows={visible} canOpenAudit={canRead("audits")}/>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="text-finding-page">Page {current} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)} data-testid="button-finding-prev"><ChevronLeft className="size-4"/>Previous</Button>
            <Button size="sm" variant="outline" disabled={current >= pages} onClick={() => setPage(current + 1)} data-testid="button-finding-next">Next<ChevronRight className="size-4"/></Button>
          </div>
        </div>
      </>}
  </section>;
}
