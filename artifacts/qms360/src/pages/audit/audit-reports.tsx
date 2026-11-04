import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { useGetAuditReportTable, getGetAuditReportTableUrl, getGetAuditReportTableQueryKey, type AuditReportTable } from "@workspace/api-client-react";
import { formatDate } from "@workspace/spreadsheet-dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuditCapabilities } from "@/lib/use-audit-capabilities";

export type AuditReportKey = "open-vs-closed" | "findings-log" | "car-status" | "schedule";
export const AUDIT_REPORT_TABS: { key: AuditReportKey; label: string }[] = [
  { key: "open-vs-closed", label: "Open vs Closed Audits" },
  { key: "findings-log", label: "Findings Log" },
  { key: "car-status", label: "CAR Status & Closure" },
  { key: "schedule", label: "Annual Audit Schedule" },
];
const PAGE_SIZE = 25;
const isReport = (v: string | null): v is AuditReportKey => AUDIT_REPORT_TABS.some(t => t.key === v);

export function formatReportCell(value: string | null | undefined, kind: string): string {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  if (kind === "date") { const d = formatDate(value); return d && d.trim() ? d : "—"; }
  return value;
}

export interface AuditReportTableViewProps {
  data?: AuditReportTable; isLoading?: boolean; isError?: boolean; onRetry?: () => void;
  page: number; onPage?: (page: number) => void;
}

export function AuditReportTableView({ data, isLoading, isError, onRetry, page, onPage }: AuditReportTableViewProps) {
  if (isLoading) return <div className="space-y-2 p-4" data-testid="status-report-loading" aria-busy="true">
    {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-full"/>)}</div>;
  if (isError || !data) return <div className="flex flex-col items-center gap-3 py-14 text-center" data-testid="status-report-error" role="alert">
    <AlertTriangle className="size-7 text-destructive"/><p className="text-sm text-muted-foreground">This report could not be loaded.</p>
    <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-report-retry"><RefreshCw className="mr-2 size-4"/>Retry</Button></div>;
  const pages = Math.max(1, Math.ceil(data.total / (data.limit || PAGE_SIZE)));
  return <div>
    <div className="max-h-[65vh] overflow-auto" tabIndex={0} role="region" aria-label={`${data.title} table`} data-testid="region-report-table">
      <table className="w-max min-w-full border-collapse text-sm">
        <thead><tr>{data.columns.map((c, i) => <th key={i} scope="col"
          className={`sticky top-0 z-10 border-b border-r border-primary/20 bg-primary px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-primary-foreground ${c.kind === "number" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
        <tbody>{data.rows.length === 0
          ? <tr><td colSpan={Math.max(1, data.columns.length)} className="py-14 text-center" data-testid="status-report-empty">
              <FileSpreadsheet className="mx-auto mb-2 size-7 text-muted-foreground"/><span className="text-sm text-muted-foreground">No records match this report and filter.</span></td></tr>
          : data.rows.map(row => <tr key={row.id} className="odd:bg-background even:bg-accent/30 hover:bg-accent/60" data-testid={`row-report-${row.id}`}>
              {data.columns.map((c, i) => <td key={i} className={`min-w-[8rem] max-w-[22rem] whitespace-pre-wrap break-words border-b border-r border-border px-3 py-2 align-top ${c.kind === "number" ? "text-right tabular-nums" : ""}`}>
                {formatReportCell(row.values[i], c.kind)}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground" data-testid="text-report-total">{data.total} {data.total === 1 ? "record" : "records"} · Generated {formatDate(data.generatedAt) || "—"}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage?.(page - 1)} data-testid="button-report-prev"><ChevronLeft className="size-4"/></Button>
        <span data-testid="text-report-page">Page {page} of {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage?.(page + 1)} data-testid="button-report-next"><ChevronRight className="size-4"/></Button>
      </div>
    </div>
  </div>;
}

export function AuditReports() {
  const capabilities = useAuditCapabilities();
  const canExport = capabilities.canExport("reports");
  const [location, navigate] = useLocation();
  const searchString = useSearch();
  const fromQuery = new URLSearchParams(searchString).get("report");
  const report: AuditReportKey = isReport(fromQuery) ? fromQuery : "open-vs-closed";
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setPage(1); }, [report]);
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setSearch(value.trim()); setPage(1); }, 400);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const submit = (e: FormEvent) => { e.preventDefault(); clearTimeout(timer.current); setSearch(searchInput.trim()); setPage(1); };
  const yearNum = /^\d{4}$/.test(year) ? Number(year) : undefined;
  const filters = { ...(search ? { search } : {}), ...(yearNum ? { year: yearNum } : {}) };
  const params = { page, limit: PAGE_SIZE, ...filters };
  const query = useGetAuditReportTable(report, params, { query: { queryKey: getGetAuditReportTableQueryKey(report, params) } });
  const exportUrl = getGetAuditReportTableUrl(report, { ...filters, format: "csv" });
  const years = (query.data?.availableYears ?? []).map(String);
  useEffect(() => {
    if (query.data?.availableYears && year && !query.data.availableYears.includes(Number(year))) {
      setYear("");
      setPage(1);
    }
  }, [query.data, year]);
  const selectTab = (key: string) => navigate(`${location}?report=${key}`, { replace: true });

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">Report centre</h1>
        <p className="text-sm text-muted-foreground">Workbook-layout audit reports from your authorized workspace data</p></div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} data-testid="button-report-refresh">
          <RefreshCw className={`mr-2 size-4 ${query.isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
        {canExport
          ? <Button asChild data-testid="link-report-csv"><a href={exportUrl} download><Download className="mr-2 size-4"/>Download CSV</a></Button>
          : <Button disabled title="Your role does not have report export access" data-testid="button-report-csv-disabled"><Download className="mr-2 size-4"/>Download CSV</Button>}
      </div>
    </div>
    {!canExport && <p className="text-sm text-muted-foreground" data-testid="text-report-no-export">Your role can open Reports but does not have report export access.</p>}
    <Tabs value={report} onValueChange={selectTab}>
      <div className="overflow-x-auto"><TabsList className="h-auto">{AUDIT_REPORT_TABS.map(t =>
        <TabsTrigger key={t.key} value={t.key} data-testid={`tab-report-${t.key}`}>{t.label}</TabsTrigger>)}</TabsList></div>
    </Tabs>
    <Card className="overflow-hidden">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3 border-b bg-accent/20 px-4 py-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"/>
          <Input value={searchInput} maxLength={200} onChange={e => onSearchChange(e.target.value)} placeholder="Search this report" className="pl-8" data-testid="input-report-search"/>
        </div>
        <select value={year} onChange={e => { setYear(e.target.value); setPage(1); }} aria-label="Year" disabled={!query.data}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-report-year">
          <option value="">All years</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button type="submit" variant="secondary" data-testid="button-report-search">Search</Button>
      </form>
      <CardContent className="p-0">
        {query.data && <div className="px-4 pt-3 text-sm font-semibold" data-testid="text-report-title">{query.data.title}</div>}
        <AuditReportTableView data={query.data} isLoading={query.isLoading} isError={query.isError} onRetry={() => query.refetch()} page={page} onPage={setPage}/>
      </CardContent>
    </Card>
  </div>;
}
