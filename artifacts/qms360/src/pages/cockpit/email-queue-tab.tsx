import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListOutboundEmailsQueryKey, useGetEmailDeliverySettings, useListOutboundEmails, useRetryOutboundEmail,
  useUpdateEmailDeliverySettings,
} from '@workspace/api-client-react';
import { AlertCircle, Clock3, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const statusLabels: Record<string, string> = {
  queued: 'Queued', sending: 'Sending', retrying: 'Retrying', sent: 'Sent', failed: 'Failed',
};

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'sent') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'retrying') return 'outline';
  return 'secondary';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Email queue action failed.';
}

export function EmailQueueTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | 'queued' | 'sending' | 'retrying' | 'sent' | 'failed'>('all');
  const [app, setApp] = useState<'all' | 'qaqc' | 'lessons' | 'audit' | 'platform'>('all');
  const [search, setSearch] = useState('');
  const queue = useListOutboundEmails(
    { page, limit: 20, status, app, ...(search.trim() ? { search: search.trim() } : {}) },
    { query: { queryKey: getListOutboundEmailsQueryKey({ page, limit: 20, status, app, ...(search.trim() ? { search: search.trim() } : {}) }), refetchInterval: 10_000 } },
  );
  const settings = useGetEmailDeliverySettings();
  const updateSettings = useUpdateEmailDeliverySettings();
  const retry = useRetryOutboundEmail();
  const client = useQueryClient();
  const { toast } = useToast();
  const [policy, setPolicy] = useState({ retentionDays: 90, maxRetries: 3, retryDelayMinutes: 15 });

  useEffect(() => {
    if (settings.data) setPolicy(settings.data);
  }, [settings.data]);
  useEffect(() => setPage(1), [status, app, search]);

  const fail = (error: unknown) => toast({ title: 'Email queue action failed', description: errorMessage(error), variant: 'destructive' });
  const savePolicy = () => updateSettings.mutate({ data: policy }, {
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['/api/integrations/email-settings'] });
      toast({ title: 'Email delivery settings saved' });
    },
    onError: fail,
  });
  const retryEmail = (id: string) => retry.mutate({ id }, {
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['/api/integrations/email-queue'] });
      toast({ title: 'Email queued for another attempt' });
    },
    onError: fail,
  });
  const totalPages = Math.max(1, Math.ceil((queue.data?.total ?? 0) / 20));
  const loading = queue.isLoading || settings.isLoading;
  const error = queue.error || settings.error;

  return <div className="space-y-6">
    <Card>
      <CardHeader><CardTitle>Email delivery policy</CardTitle><CardDescription>QMS360-wide retry and log-retention settings for this organization. The initial delivery is followed by the configured number of retries.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div><Label>Keep email logs for (days)</Label><Input className="mt-2" type="number" min={1} max={3650} value={policy.retentionDays} onChange={e => setPolicy({ ...policy, retentionDays: Number(e.target.value) })} /></div>
          <div><Label>Maximum retries</Label><Input className="mt-2" type="number" min={0} max={20} value={policy.maxRetries} onChange={e => setPolicy({ ...policy, maxRetries: Number(e.target.value) })} /></div>
          <div><Label>Retry delay (minutes)</Label><Input className="mt-2" type="number" min={1} max={1440} value={policy.retryDelayMinutes} onChange={e => setPolicy({ ...policy, retryDelayMinutes: Number(e.target.value) })} /></div>
        </div>
        <div className="flex justify-end"><Button onClick={savePolicy} disabled={updateSettings.isPending || policy.retentionDays < 1 || policy.maxRetries < 0 || policy.retryDelayMinutes < 1}><Save className="mr-2 size-4" />Save policy</Button></div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Outbound email queue</CardTitle><CardDescription>Each recipient is tracked independently from event trigger through SMTP delivery.</CardDescription></div><Button variant="outline" size="sm" onClick={() => queue.refetch()} disabled={queue.isFetching}><RefreshCw className={`mr-2 size-4 ${queue.isFetching ? 'animate-spin' : ''}`} />Refresh</Button></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <Input placeholder="Search recipient, subject or event" value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={status} onValueChange={value => setStatus(value as typeof status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{['queued', 'sending', 'retrying', 'sent', 'failed'].map(value => <SelectItem key={value} value={value}>{statusLabels[value]}</SelectItem>)}</SelectContent></Select>
          <Select value={app} onValueChange={value => setApp(value as typeof app)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All applications</SelectItem><SelectItem value="qaqc">QA/QC</SelectItem><SelectItem value="lessons">Lessons</SelectItem><SelectItem value="audit">Audit</SelectItem><SelectItem value="platform">Platform</SelectItem></SelectContent></Select>
        </div>
        {loading && <div className="space-y-3 py-8"><div className="h-5 w-1/3 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted" /></div>}
        {error && <div className="flex items-center gap-3 rounded-lg border border-destructive p-4"><AlertCircle className="size-5 text-destructive" /><div><p className="font-medium">Email queue unavailable</p><p className="text-sm text-muted-foreground">{errorMessage(error)}</p></div></div>}
        {!loading && !error && (queue.data?.items.length ? <>
          <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Created</TableHead><TableHead>Application / event</TableHead><TableHead>Recipient</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Next attempt / error</TableHead><TableHead /></TableRow></TableHeader><TableBody>
            {queue.data.items.map(email => <TableRow key={email.id}>
              <TableCell className="whitespace-nowrap">{new Date(email.createdAt).toLocaleString()}</TableCell>
              <TableCell><p className="font-medium uppercase">{email.app}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{email.eventType ?? 'Direct notification'}</p>{email.senderEmail && <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground">From: {email.senderName || email.senderEmail}{email.senderName ? ` <${email.senderEmail}>` : ''}</p>}</TableCell>
              <TableCell><p className="font-medium">{email.recipientName || email.recipientEmail}</p>{email.recipientName && <p className="text-xs text-muted-foreground">{email.recipientEmail}</p>}</TableCell>
              <TableCell className="max-w-64 truncate">{email.subject}</TableCell>
              <TableCell><Badge variant={statusVariant(email.status)}>{statusLabels[email.status]}</Badge></TableCell>
              <TableCell>{email.attemptCount} / {email.maxAttempts}</TableCell>
              <TableCell className="max-w-72">{email.status === 'retrying' || email.status === 'queued' ? <span className="flex items-center gap-1 text-xs"><Clock3 className="size-3" />{new Date(email.nextAttemptAt).toLocaleString()}</span> : email.sentAt ? <span className="text-xs">{new Date(email.sentAt).toLocaleString()}</span> : '—'}{email.lastError && <p className="mt-1 line-clamp-2 text-xs text-destructive" title={email.lastError}>{email.lastError}</p>}</TableCell>
              <TableCell>{email.status === 'failed' && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retryEmail(email.id)}><RefreshCw className="mr-2 size-4" />Retry</Button>}</TableCell>
            </TableRow>)}
          </TableBody></Table></div>
          <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{queue.data.total} emails · Page {page} of {totalPages}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
        </> : <p className="py-10 text-center text-sm text-muted-foreground">No outbound emails match these filters.</p>)}
      </CardContent>
    </Card>
  </div>;
}