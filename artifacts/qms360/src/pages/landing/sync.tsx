import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { getListSyncJobsQueryKey, useListSyncJobs, useRetrySyncJob } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

export function SyncPage() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const jobs = useListSyncJobs({ page, limit: 20 });
  const retry = useRetrySyncJob({ mutation: {
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListSyncJobsQueryKey() }); toast({ title: 'Sync retry queued' }); },
    onError: () => toast({ title: 'Could not retry sync job', variant: 'destructive' }),
  } });
  return <div className="space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-accent">Platform integration</p><h1 className="mt-2 text-3xl font-bold">Project Sync View</h1><p className="mt-2 text-sm text-muted-foreground">Monitor project and master-data synchronization.</p></header>
    {jobs.isLoading ? <Skeleton className="h-80" /> : jobs.isError ? <State title="Sync jobs unavailable" detail="The integration service could not return its jobs." /> : !jobs.data?.items.length ? <State title="No sync jobs" detail="No synchronization runs have been recorded." /> :
      <div className="overflow-hidden rounded-xl border border-border bg-card"><Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Status</TableHead><TableHead>Started</TableHead><TableHead>Records</TableHead><TableHead>Duration</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {jobs.data.items.map(job => <TableRow key={job.id}><TableCell><p className="font-mono text-xs">{job.id}</p><p className="text-xs text-muted-foreground">{job.connectorId}</p></TableCell><TableCell><Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'}>{job.status}</Badge></TableCell><TableCell className="text-xs">{new Date(job.startedAt).toLocaleString()}</TableCell><TableCell>{job.sourceCount ?? '—'} / {job.targetCount ?? '—'}</TableCell><TableCell>{job.durationMs == null ? '—' : `${(job.durationMs / 1000).toFixed(1)}s`}</TableCell><TableCell className="text-right">{job.status === 'failed' && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: job.id })}><RefreshCw className="h-4 w-4" />Retry</Button>}</TableCell></TableRow>)}
      </TableBody></Table></div>}
    <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page}</span><Button variant="outline" disabled={!jobs.data || page * jobs.data.limit >= jobs.data.total} onClick={() => setPage(value => value + 1)}>Next</Button></div>
  </div>;
}

function State({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center"><p className="font-semibold">{title}</p><p className="mt-2 text-sm text-muted-foreground">{detail}</p></div>;
}