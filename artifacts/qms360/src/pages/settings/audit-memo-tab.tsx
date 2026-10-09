import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPlatformAuditMemoDefaultsQueryKey, useGetCurrentUser,
  useGetPlatformAuditMemoDefaults, useUpdatePlatformAuditMemoDefaults, type AuditMemoDefaults,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { userFacingApiError } from '@/lib/api-error';

export function AuditMemoTab() {
  const user = useGetCurrentUser();
  const queryKey = [...getGetPlatformAuditMemoDefaultsQueryKey(), user.data?.id ?? ''];
  const query = useGetPlatformAuditMemoDefaults({ query: { queryKey, enabled: Boolean(user.data), staleTime: 0 } });
  const update = useUpdatePlatformAuditMemoDefaults();
  const client = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<AuditMemoDefaults | null>(null);
  const values = draft ?? query.data;
  const canEdit = ['Super Admin', 'Org Admin'].includes(user.data?.platformRole ?? '');
  const changed = Boolean(values && query.data && (values.from !== query.data.from || values.to !== query.data.to));
  const save = () => {
    if (!canEdit || !values) return;
    update.mutate({ data: values }, {
      onSuccess: saved => {
        client.setQueryData(queryKey, saved);
        void client.invalidateQueries({ queryKey: getGetPlatformAuditMemoDefaultsQueryKey() });
        setDraft(null);
        toast({ title: 'Audit memo defaults saved' });
      },
      onError: error => toast({ title: 'Unable to save memo defaults', description: userFacingApiError(error, 'Memo defaults could not be saved.').message, variant: 'destructive' }),
    });
  };
  return <Card>
    <CardHeader><CardTitle>Audit Schedule memo defaults</CardTitle><CardDescription>Reusable From and To text for schedule submission and resubmission. These are memo headings, not email sender or recipient addresses.</CardDescription></CardHeader>
    <CardContent className="max-w-xl space-y-4">
      {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading memo defaults…</p>}
      {query.isError && <div role="alert" className="text-sm text-destructive">Memo defaults could not be loaded. <Button variant="link" onClick={() => void query.refetch()}>Retry</Button></div>}
      {values && <>
        <div className="space-y-2"><Label htmlFor="audit-memo-default-from">Default From</Label><Input id="audit-memo-default-from" data-testid="input-audit-memo-default-from" value={values.from} onChange={event => setDraft({ ...values, from: event.target.value })} placeholder="e.g. Quality Department" maxLength={500} disabled={!canEdit || update.isPending}/></div>
        <div className="space-y-2"><Label htmlFor="audit-memo-default-to">Default To</Label><Input id="audit-memo-default-to" data-testid="input-audit-memo-default-to" value={values.to} onChange={event => setDraft({ ...values, to: event.target.value })} placeholder="e.g. All BU's, Function Heads and PM's" maxLength={500} disabled={!canEdit || update.isPending}/></div>
        <p className="text-sm text-muted-foreground">Saved values prefill the read-only From and To fields each time Submit or Resubmit is opened. Change these headings here, not in the submission popup. An empty default retains any heading already saved on the schedule.</p>
        {!canEdit && <p className="text-sm text-muted-foreground">Only organization administrators can change these defaults.</p>}
        {canEdit && <div className="flex gap-2"><Button onClick={save} data-testid="button-save-audit-memo-defaults" disabled={!changed || update.isPending || query.isError}>{update.isPending ? 'Saving…' : 'Save defaults'}</Button><Button variant="outline" onClick={() => setDraft(null)} disabled={!changed || update.isPending}>Reset</Button></div>}
      </>}
    </CardContent>
  </Card>;
}
