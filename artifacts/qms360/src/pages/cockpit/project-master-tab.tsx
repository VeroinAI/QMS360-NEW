import { useEffect, useState } from 'react';
import { getListDronaProjectMasterQueryKey, useListDronaProjectMaster, useGetCurrentUser } from '@workspace/api-client-react';
import type { DronaProjectMasterRecord, ListDronaProjectMaster200, ProjectCostCentreResult } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, ChevronRight, Info, RefreshCw, Search } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { ProjectCostCentreEditor } from './project-cost-centre-editor';

const LIMIT = 20;
const dash = '—';
const show = (v: string | null | undefined) => (v && String(v).trim() ? v : dash);
function fmt(v: string | Date | null | undefined) {
  if (!v) return dash;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? dash : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function dronaIds(r: DronaProjectMasterRecord) {
  const ids = (r.dronaLinks ?? []).map((l) => l.externalProjectId);
  if (r.recordSource === 'drona' && r.externalId && !ids.includes(r.externalId)) ids.unshift(r.externalId);
  return ids;
}

export function ProjectMasterTab() {
  const currentUser = useGetCurrentUser();
  const canEditCostCentre = ['Super Admin', 'Org Admin'].includes(currentUser.data?.platformRole ?? '');
  const client = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DronaProjectMasterRecord | null>(null);
  const [savingCostCentre, setSavingCostCentre] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [input]);
  const params = { page, limit: LIMIT, ...(search ? { search } : {}) };
  const q = useListDronaProjectMaster(params, { query: { queryKey: getListDronaProjectMasterQueryKey(params), staleTime: 15_000, refetchOnMount: 'always', refetchOnWindowFocus: true } });
  const data = q.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(page * LIMIT, total);
  useEffect(() => {
    if (data && !q.isFetching && page > pages) setPage(pages);
  }, [data, q.isFetching, page, pages]);
  useEffect(() => {
    if (data) setSelected(record => record ? data.items.find(item => item.id === record.id) ?? null : null);
  }, [data]);
  const savedCostCentre = (result: ProjectCostCentreResult) => {
    setSelected(record => record?.id === result.id ? null : record);
    client.setQueriesData<ListDronaProjectMaster200>({ queryKey: getListDronaProjectMasterQueryKey() }, previous =>
      previous ? { ...previous, items: previous.items.map(record => record.id === result.id ? { ...record, ...result } : record) } : previous);
    void client.invalidateQueries({ queryKey: getListDronaProjectMasterQueryKey() });
    toast({ title: 'Cost center saved' });
  };

  return <div className="space-y-4" data-testid="project-master-tab">
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl"><CardTitle>Project Master</CardTitle>
          <CardDescription>Saved QMS360 project records transferred from Drona, within your current project access. Project details remain read-only; administrators can manage the QMS360 cost center for Lessons Learned numbering.</CardDescription></div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-project-master"><RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && data.linkMetadataAvailable === false && <Alert data-testid="alert-link-metadata"><Info className="h-4 w-4" /><AlertTitle>Link metadata not installed</AlertTitle><AlertDescription>Drona link metadata is not installed in this environment. Saved Drona records can still be displayed; Drona IDs for legacy linked local records may be unavailable.</AlertDescription></Alert>}
        <div className="relative max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search Project Master" maxLength={120} placeholder="Search code, name or Drona ID" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-search-project-master" /></div>
        {q.isLoading && <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
        {q.isError && !data && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Could not load project master</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{q.error instanceof Error ? q.error.message : 'The request did not complete.'}<Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-retry-project-master">Retry</Button></AlertDescription></Alert>}
        {q.isError && data && <p className="text-sm text-destructive">Refresh failed; showing previously loaded data.</p>}
        {data && items.length === 0 && <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground" data-testid="empty-project-master">{search ? `No saved projects match “${search}”.` : 'No saved Drona projects are available within your current project access.'}</div>}
        {items.length > 0 && <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow>
          <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Business unit</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead><TableHead>Cost center</TableHead><TableHead>Drona ID</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>
          {items.map((r) => { const ids = dronaIds(r); return <TableRow key={r.id} className="cursor-pointer" tabIndex={0} aria-label={`View ${r.code} project details`} onClick={() => setSelected(r)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(r); } }} data-testid={`row-project-master-${r.id}`}>
            <TableCell className="whitespace-nowrap font-medium">{show(r.code)}</TableCell><TableCell>{show(r.name)}</TableCell><TableCell>{show(r.businessUnit)}</TableCell><TableCell>{show(r.location)}</TableCell>
            <TableCell><Badge variant={r.status === 'active' ? 'default' : 'secondary'}>{show(r.status)}</Badge></TableCell>
             <TableCell><div className="whitespace-nowrap">{show(r.costCentre)}</div>{canEditCostCentre && <Button variant="link" size="sm" className="h-auto p-0" aria-label={`${r.costCentre ? 'Edit' : 'Set'} cost center for ${r.code}`} onClick={event => { event.stopPropagation(); setSelected(r); }} data-testid={`button-edit-cost-centre-${r.id}`}>{r.costCentre ? 'Edit cost center' : 'Set cost center'}</Button>}</TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs">{ids.length ? ids.join(', ') : dash}</TableCell><TableCell>{show(r.recordSource)}</TableCell></TableRow>; })}
        </TableBody></Table></div>}
        {data && total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span data-testid="text-project-master-range">Showing {from}–{to} of {total}</span>
          <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || q.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-prev-page"><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages || q.isFetching} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}
      </CardContent>
    </Card>
    <Dialog open={!!selected} onOpenChange={(o) => { if (!o && !savingCostCentre) setSelected(null); }}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"
      onEscapeKeyDown={event => { if (savingCostCentre) event.preventDefault(); }}
      onPointerDownOutside={event => { if (savingCostCentre) event.preventDefault(); }}>
      {selected && <><DialogHeader><DialogTitle>{show(selected.code)} — {show(selected.name)}</DialogTitle><DialogDescription>Drona master fields remain read-only. Administrators can maintain this project's QMS360 cost center below.</DialogDescription></DialogHeader>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {([['QMS UUID', selected.id], ['Code', selected.code], ['Name', selected.name], ['Business unit', selected.businessUnit], ['Location', selected.location], ['Status', selected.status], ['Cost center', selected.costCentre], ['Record source', selected.recordSource], ['Created', fmt(selected.createdAt)], ['Record updated', fmt(selected.updatedAt)]] as Array<[string, string | null]>).map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-all font-medium">{show(v)}</dd></div>)}
        </dl>
         {canEditCostCentre && <ProjectCostCentreEditor key={selected.id} record={selected} onSaved={savedCostCentre} onPendingChange={setSavingCostCentre} />}
        <div><p className="mb-2 text-sm font-medium">Drona links</p>
          {(() => { const links = selected.dronaLinks ?? []; const direct = selected.recordSource === 'drona' && selected.externalId && !links.some((l) => l.externalProjectId === selected.externalId);
            if (!links.length && !direct) return <p className="text-sm text-muted-foreground">No Drona link recorded.</p>;
            return <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Drona ID</TableHead><TableHead>Environment</TableHead><TableHead>Linked</TableHead></TableRow></TableHeader><TableBody>
              {direct && <TableRow><TableCell className="font-mono text-xs">{selected.externalId}</TableCell><TableCell>{dash}</TableCell><TableCell>{dash}</TableCell></TableRow>}
              {links.map((l) => <TableRow key={`${l.environment}-${l.externalProjectId}`}><TableCell className="font-mono text-xs">{l.externalProjectId}</TableCell><TableCell>{show(l.environment)}</TableCell><TableCell className="whitespace-nowrap">{fmt(l.linkedAt)}</TableCell></TableRow>)}
            </TableBody></Table></div>; })()}
        </div></>}
    </DialogContent></Dialog>
  </div>;
}
