import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCurrentUser, useUpdatePlatformDateFormat } from '@workspace/api-client-react';
import { DATE_FORMATS, formatDate } from '@workspace/spreadsheet-dates';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { dateFormatQueryKey } from '@/components/date-format-provider';
import { useOrgDateFormat } from '@/hooks/use-org-date-format';

const SAMPLE = '2026-03-09';
const exampleFor = (format: string) => formatDate(SAMPLE, format as never);

export function DateFormatTab() {
  const { toast } = useToast();
  const client = useQueryClient();
  const user = useGetCurrentUser();
  const canEdit = ['Super Admin', 'Org Admin'].includes(user.data?.platformRole ?? '');
  const org = user.data?.organizationName ?? '';
  const { format: saved, query } = useOrgDateFormat();
  const [draft, setDraft] = useState<string>(saved ?? 'DD/MM/YYYY');
  useEffect(() => { if (saved) setDraft(saved); }, [saved]);
  const update = useUpdatePlatformDateFormat();
  const dirty = draft !== saved;
  const save = () => update.mutate({ data: { dateFormat: draft as never } }, {
    onSuccess: (result) => {
      client.setQueryData(dateFormatQueryKey(user.data?.id ?? '', org), result);
      void client.invalidateQueries({ queryKey: dateFormatQueryKey(user.data?.id ?? '', org) });
      toast({ title: 'Date format saved', description: `Dates now display as ${result.dateFormat} for the whole organization.` });
    },
    onError: (error) => toast({ title: 'Could not save date format', description: error instanceof Error ? error.message : 'The platform did not accept the change.', variant: 'destructive' }),
  });
  return <Card><CardHeader><CardTitle>Date format</CardTitle><CardDescription>One format for every date in QMS360: screens, date entry, spreadsheet imports and exports. Calendar and wall-clock dates are never shifted.</CardDescription></CardHeader><CardContent className="max-w-xl space-y-4">
    {query.isLoading && <div className="h-9 animate-pulse rounded bg-muted" />}
    {query.isError && <p className="text-sm text-destructive" role="alert">Date format could not be loaded. <Button variant="link" className="h-auto p-0" onClick={() => void query.refetch()}>Retry</Button></p>}
    {saved && <>
      <div><Label htmlFor="org-date-format">Organization date format</Label>
        <Select value={draft} onValueChange={setDraft} disabled={!canEdit || update.isPending}>
          <SelectTrigger id="org-date-format" data-testid="select-date-format"><SelectValue /></SelectTrigger>
          <SelectContent>{(DATE_FORMATS as readonly string[]).map((f) => <SelectItem key={f} value={f}>{f} — {exampleFor(f)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="text-date-format-example">Example: 9 March 2026 will appear as <b>{exampleFor(draft)}</b>.</p>
      {!canEdit && <p className="text-sm text-muted-foreground">Only organization administrators can change the date format. Current format: {saved}.</p>}
      {canEdit && <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-muted-foreground">Unsaved change</span>}
        <Button variant="outline" disabled={!dirty || update.isPending} onClick={() => setDraft(saved)}>Reset</Button>
        <Button data-testid="button-save-date-format" disabled={!dirty || update.isPending} onClick={save}><Save className="mr-2 h-4 w-4" />{update.isPending ? 'Saving…' : 'Save format'}</Button>
      </div>}
    </>}
  </CardContent></Card>;
}
