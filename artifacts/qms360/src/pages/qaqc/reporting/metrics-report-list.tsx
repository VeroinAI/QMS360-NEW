import { useState } from 'react';
import { formatDate as organizationDate } from '@workspace/spreadsheet-dates';
import { Link } from 'wouter';
import { getGetQaqcSowContextQueryKey, getListQaqcSowReportsQueryKey, useGetQaqcSowContext, useListQaqcSowReports, type ListQaqcSowReportsParams, type QaqcSowReport } from '@workspace/api-client-react';
import { Download, Eye, Lock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { Empty, ErrorBox, Loading, StateBadge, errMsg, saveFile } from './shell';
import { canEditMetricsDocument, metricsDocumentHref } from './metrics-report-policy';
import { exportMonthlyReportPdf } from './monthly-report-download';

const ALL = '__all__';
const LIMIT = 20;
const FRESH = { staleTime: 30_000, refetchOnMount: 'always' as const, refetchOnWindowFocus: true };

type ProjectOption = { id: string; name: string };

export const monthInputToPeriod = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${m}-01` : undefined);
export const formatMonthYear = (period: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(period ?? '');
  if (!m) return period || '-';
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
export const pqpStatusLabel = (data: Record<string, unknown> | undefined) => {
  const s = typeof data?.pqpStatus === 'string' ? data.pqpStatus : '';
  if (!s) return '-';
  const other = typeof data?.pqpOther === 'string' ? data.pqpOther.trim() : '';
  return s === 'Others' && other ? `Others: ${other}` : s;
};
export const formatDate = (v: unknown) => {
  if (typeof v !== 'string' || !v) return '-';
  return organizationDate(v);
};

export function MetricsReportList() {
  const cap = useQaqcCapabilities();
  const canRead = cap.canAnyRead('monthly_reports');
  const canEdit = cap.can('monthly_reports', 'create_edit');
  const canExport = cap.can('monthly_reports', 'export');
  const { toast } = useToast();

  const [projectId, setProjectId] = useState(ALL);
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);

  const ctxParams = { reportType: 'monthly' as const };
  const ctx = useGetQaqcSowContext(ctxParams, { query: { enabled: canRead, queryKey: getGetQaqcSowContextQueryKey(ctxParams), ...FRESH } });
  const rawProjects = (ctx.data as { projects?: unknown } | undefined)?.projects;
  const projects: ProjectOption[] = Array.isArray(rawProjects)
    ? rawProjects.filter((p): p is ProjectOption => !!p && typeof (p as ProjectOption).id === 'string').map(p => ({ id: p.id, name: p.name ?? p.id }))
    : [];

  const period = monthInputToPeriod(month);
  const params: ListQaqcSowReportsParams = { reportType: 'monthly', page, limit: LIMIT, ...(projectId !== ALL ? { projectId } : {}), ...(period ? { period } : {}) };
  const q = useListQaqcSowReports(params, { query: { enabled: canRead, queryKey: getListQaqcSowReportsQueryKey(params), placeholderData: prev => prev, ...FRESH } });

  const items: QaqcSowReport[] = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const filtered = projectId !== ALL || !!month;

  const changeProject = (v: string) => { setProjectId(v); setPage(1); };
  const changeMonth = (v: string) => { setMonth(v); setPage(1); };
  const clear = () => { setProjectId(ALL); setMonth(''); setPage(1); };

  const download = async (r: QaqcSowReport) => {
    if (!canExport || downloading) return;
    setDownloading(r.id);
    try {
      const res = await exportMonthlyReportPdf(r.id);
      saveFile(res, `monthly-report-${(r.projectName ?? r.projectId).replace(/[^\w-]+/g, '-')}-${String(r.period).slice(0, 7)}.pdf`);
      toast({ title: 'Download started', description: `${r.projectName ?? r.projectId} - ${formatMonthYear(r.period)}` });
    } catch (e) {
      toast({ title: 'Download failed', description: errMsg(e), variant: 'destructive' });
    } finally { setDownloading(null); }
  };

  if (cap.isLoading) return <Loading />;
  if (!canRead) return <Card data-testid="state-no-permission"><CardContent className="py-14 text-center"><Lock className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">You do not have permission to view monthly reports.</p><p className="mt-1 text-sm text-muted-foreground">Ask an administrator for Monthly Reports read access.</p></CardContent></Card>;

  return <div className="space-y-4">
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Filter reports</CardTitle></CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="filter-project">Project Name</Label>
            <Select value={projectId} onValueChange={changeProject} disabled={ctx.isLoading}>
              <SelectTrigger id="filter-project" data-testid="select-filter-project"><SelectValue placeholder={ctx.isLoading ? 'Loading projects...' : 'All projects'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {ctx.error && <p className="text-xs text-destructive">Projects could not be loaded. <button className="underline" onClick={() => ctx.refetch()}>Retry</button></p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-month">Month / Year</Label>
            <Input id="filter-month" type="month" value={month} onChange={e => changeMonth(e.target.value)} data-testid="input-filter-month" />
          </div>
          <Button variant="outline" onClick={clear} disabled={!filtered} data-testid="button-clear-filters">Clear filters</Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Monthly QA/QC reports</CardTitle>{q.data && <span className="text-sm text-muted-foreground" data-testid="text-report-total">{total} report{total === 1 ? '' : 's'}</span>}</div></CardHeader>
      <CardContent>
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !items.length ? <Empty text={filtered ? 'No reports match these filters.' : 'No monthly reports yet. Use New entry to create one.'} /> :
          <div className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <Table><TableHeader><TableRow><TableHead>Project Name</TableHead><TableHead>Month / Year</TableHead><TableHead>PQP Status</TableHead><TableHead>PQP Submission Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
              {items.map(r => {
                const editable = canEditMetricsDocument(r.state, canEdit);
                const data = r.data as Record<string, unknown> | undefined;
                return <TableRow key={r.id} data-testid={`row-report-${r.id}`}>
                  <TableCell className="font-medium">{r.projectName ?? r.projectId}</TableCell>
                  <TableCell>{formatMonthYear(r.period)}</TableCell>
                  <TableCell>{pqpStatusLabel(data)}</TableCell>
                  <TableCell>{formatDate(data?.pqpSubmittedDate)}</TableCell>
                  <TableCell><StateBadge state={r.state} /></TableCell>
                  <TableCell className="text-right"><div className="flex justify-end gap-2">
                    <Link href={metricsDocumentHref(r.id, r.state, canEdit)} className="inline-flex" data-testid={`link-${editable ? 'edit' : 'display'}-report-${r.id}`}>
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted">{editable ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}{editable ? 'Edit' : 'Display'}</span>
                    </Link>
                    {canExport && <Button size="sm" variant="outline" disabled={!!downloading} onClick={() => download(r)} data-testid={`button-download-report-${r.id}`}><Download className="size-3.5" />{downloading === r.id ? 'Preparing...' : 'Download'}</Button>}
                  </div></TableCell>
                </TableRow>;
              })}
            </TableBody></Table>
            {pages > 1 && <div className="mt-4 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || q.isFetching} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="button-prev-page">Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= pages || q.isFetching} onClick={() => setPage(p => Math.min(pages, p + 1))} data-testid="button-next-page">Next</Button>
              </div>
            </div>}
          </div>}
      </CardContent>
    </Card>
  </div>;
}
