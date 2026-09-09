import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, Download, Loader2, MessageSquarePlus, Paperclip, Sparkles } from 'lucide-react';
import {
  downloadFeedbackAttachment,
  exportFeedbackEntries,
  useGetCurrentUser,
  getListFeedbackEntriesQueryKey,
  useListFeedbackEntries,
  useRunFeedbackTriage,
  useUpdateFeedbackResolution,
  type FeedbackEntry,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { userFacingApiError } from '@/lib/api-error';

const verdictLabels: Record<string, string> = {
  valid_issue: 'Valid issue',
  awareness_gap: 'Awareness gap',
  suggestion: 'Suggestion',
  unclear: 'Unclear',
};

const moduleLabels: Record<string, string> = {
  qaqc: 'QA/QC & Document Governance',
  lessons: 'Lessons Learned',
  audit: 'QMS Audit Management',
  system: 'System / General',
};

type Resolution = 'open' | 'reviewing' | 'hold' | 'additional_info_required' | 'resolved' | 'closed';

const resolutionLabels: Record<Resolution, string> = {
  open: 'Open',
  reviewing: 'Reviewing',
  hold: 'Hold',
  additional_info_required: 'Additional info required',
  resolved: 'Resolved',
  closed: 'Closed',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function FeedbackPage() {
  const [moduleFilter, setModuleFilter] = useState('all');
  const [triagingId, setTriagingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolutionEntry, setResolutionEntry] = useState<FeedbackEntry | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<Resolution>('open');
  const [resolutionResponse, setResolutionResponse] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const user = useGetCurrentUser();
  const isAdmin = ['Super Admin', 'Org Admin'].includes(user.data?.platformRole ?? '')
    || (user.data?.workspaceRoles.some((role) => /\b(admin|administrator)\b/i.test(role)) ?? false);
  const feedbackParams = {
    page: 1,
    limit: 200,
    module: moduleFilter === 'all' ? undefined : moduleFilter as 'qaqc' | 'lessons' | 'audit' | 'system',
  };
  const feedback = useListFeedbackEntries(feedbackParams, { query: { enabled: isAdmin, queryKey: getListFeedbackEntriesQueryKey(feedbackParams) } });
  const queryClient = useQueryClient();
  const resolution = useUpdateFeedbackResolution({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/feedback'] });
        setResolutionEntry(null);
        toast({ title: 'Resolution updated', description: 'The person who raised this feedback can now see your response.' });
      },
      onError: (error) => {
        const details = userFacingApiError(error, 'The resolution could not be updated.');
        toast({ title: details.title, description: `${details.message} (${details.technicalCode})`, variant: 'destructive' });
      },
    },
  });
  const triage = useRunFeedbackTriage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/feedback'] });
        toast({ title: 'AI triage completed' });
      },
      onError: (error) => {
        const details = userFacingApiError(error, 'AI triage could not be completed.');
        toast({ title: details.title, description: `${details.message} (${details.technicalCode})`, variant: 'destructive' });
      },
    },
  });

  const runTriage = (id: string) => {
    setTriagingId(id);
    triage.mutate({ id }, { onSettled: () => setTriagingId(null) });
  };

  const openResolution = (entry: FeedbackEntry) => {
    setResolutionEntry(entry);
    setResolutionStatus(entry.resolution);
    setResolutionResponse(entry.resolutionResponse ?? '');
  };

  const downloadAttachment = async (id: string, name: string) => {
    try {
      const blob = await downloadFeedbackAttachment(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const details = userFacingApiError(error, 'The attachment could not be downloaded.');
      toast({ title: details.title, description: `${details.message} (${details.technicalCode})`, variant: 'destructive' });
    }
  };

  const downloadExcel = async () => {
    setIsExporting(true);
    try {
      const blob = await exportFeedbackEntries(moduleFilter === 'all' ? undefined : {
        module: moduleFilter as 'qaqc' | 'lessons' | 'audit' | 'system',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `feedback-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const details = userFacingApiError(error, 'The feedback workbook could not be downloaded.');
      toast({ title: details.title, description: `${details.message} (${details.technicalCode})`, variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  if (user.isLoading) return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAdmin) return <main className="mx-auto max-w-3xl p-10 text-center">
    <h1 className="text-xl font-bold">Administrator access required</h1>
    <p className="mt-2 text-sm text-muted-foreground">Only administrators can review user feedback.</p>
    <Button asChild variant="outline" className="mt-4"><Link href="/">Back to home</Link></Button>
  </main>;

  const items = feedback.data?.items ?? [];
  return <main className="min-h-screen bg-background">
    <header className="bg-primary px-5 py-8 text-primary-foreground md:px-10">
      <div className="mx-auto max-w-7xl">
        <Link href="/" className="mb-5 inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"><ArrowLeft className="h-4 w-4" />Back to application</Link>
        <h1 className="font-display text-3xl font-bold">User Feedback &amp; Testing Issues</h1>
        <p className="mt-2 max-w-2xl opacity-80">Filter feedback by application, review AI triage, and share resolution updates with the person who raised each item.</p>
      </div>
    </header>
    <div className="mx-auto max-w-7xl px-5 py-6 md:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <Label className="mb-2 block">Filter by module</Label>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {Object.entries(moduleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{feedback.data?.total ?? 0} feedback item{feedback.data?.total === 1 ? '' : 's'}</p>
          <Button variant="outline" onClick={downloadExcel} disabled={isExporting || feedback.isLoading}>
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download Excel
          </Button>
        </div>
      </div>

      {feedback.isLoading ? <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : items.length === 0 ? <Card><CardContent className="flex flex-col items-center gap-3 p-16 text-center">
          <MessageSquarePlus className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">No feedback found</p>
          <p className="text-sm text-muted-foreground">{moduleFilter === 'all' ? 'Entries submitted via the floating feedback button will appear here.' : `There is no feedback for ${moduleLabels[moduleFilter]}.`}</p>
        </CardContent></Card>
        : <div className="space-y-3">{items.map((entry: FeedbackEntry) => <Card key={entry.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="capitalize">{entry.category}</Badge>
                  {entry.module && <Badge variant="secondary">{moduleLabels[entry.module] ?? entry.module}</Badge>}
                  <Badge variant={entry.resolution === 'closed' ? 'secondary' : entry.resolution === 'resolved' ? 'default' : 'outline'}>
                    {resolutionLabels[entry.resolution]}
                  </Badge>
                  {entry.triage && <Badge variant={entry.triage.verdict === 'valid_issue' ? 'destructive' : entry.triage.verdict === 'awareness_gap' ? 'secondary' : 'default'}>
                    AI: {verdictLabels[entry.triage.verdict] ?? entry.triage.verdict}
                  </Badge>}
                  <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm">{entry.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {entry.user.fullName} · {entry.user.email}
                  {entry.pagePath && <> · Page: {entry.pagePath}</>}
                  {entry.appKey && <> · App: {entry.appKey}</>}
                </p>
                {entry.triage && <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <p><span className="font-semibold">AI assessment:</span> {entry.triage.summary}</p>
                  {entry.triage.guidance && <p className="mt-1 whitespace-pre-line"><span className="font-semibold">Guidance shown to user:</span> {expanded === entry.id ? entry.triage.guidance : `${entry.triage.guidance.slice(0, 120)}${entry.triage.guidance.length > 120 ? '…' : ''}`}
                    {entry.triage.guidance.length > 120 && <button className="ml-1 text-primary underline" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>{expanded === entry.id ? 'Show less' : 'Show more'}</button>}
                  </p>}
                  {entry.triage.resolutionSuggestion && <p className="mt-2 rounded-md bg-background p-2"><span className="font-semibold">Resolution suggestion:</span> {entry.triage.resolutionSuggestion}</p>}
                </div>}
                {entry.resolutionResponse && <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
                  <p className="font-semibold">Response to user</p>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{entry.resolutionResponse}</p>
                </div>}
                {entry.statusHistory.length > 0 && <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                  <p className="font-semibold">Status history</p>
                  <div className="mt-2 space-y-2">
                    {entry.statusHistory.map((change) => <div key={change.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span>{formatDateTime(change.changedAt)}</span>
                      <span className="text-foreground">{resolutionLabels[change.fromStatus]} → {resolutionLabels[change.toStatus]}</span>
                      <span>by {change.changedByName || 'User'} · User ID: <span className="font-mono">{change.changedById}</span></span>
                    </div>)}
                  </div>
                </div>}
                {(entry.attachments?.length ?? 0) > 0 && <div className="mt-3">
                  <p className="mb-2 text-sm font-semibold">Reference files</p>
                  <div className="flex flex-wrap gap-2">
                    {entry.attachments?.map((attachment) => <Button key={attachment.id} type="button" variant="outline" size="sm"
                      onClick={() => downloadAttachment(attachment.id, attachment.fileName)}>
                      <Paperclip className="h-4 w-4" /><span className="max-w-64 truncate">{attachment.fileName}</span>
                    </Button>)}
                  </div>
                </div>}
              </div>
              <div className="w-44 shrink-0 space-y-2">
                <Button variant="secondary" size="sm" className="w-full" disabled={triagingId === entry.id} onClick={() => runTriage(entry.id)}>
                  {triagingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {entry.triage ? 'Re-run AI triage' : 'Run AI triage'}
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => openResolution(entry)}>
                  Update resolution
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>)}</div>}
    </div>

    <Dialog open={!!resolutionEntry} onOpenChange={(open) => !open && setResolutionEntry(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update feedback resolution</DialogTitle>
          <DialogDescription>Set the status and optionally explain what was reviewed, changed, or resolved. The person who raised the feedback will see this response.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Status</Label>
            <Select value={resolutionStatus} onValueChange={(value) => setResolutionStatus(value as Resolution)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="additional_info_required">Additional info required</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed" disabled={resolutionEntry?.resolution !== 'resolved' && resolutionEntry?.resolution !== 'closed'}>Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-2 block">Response to user <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea rows={5} maxLength={4000} value={resolutionResponse} onChange={(event) => setResolutionResponse(event.target.value)}
              placeholder="Describe what was fixed, changed, or clarified…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setResolutionEntry(null)}>Cancel</Button>
          <Button disabled={!resolutionEntry || resolution.isPending} onClick={() => resolutionEntry && resolution.mutate({
            id: resolutionEntry.id,
            data: { resolution: resolutionStatus, response: resolutionResponse.trim() || null },
          })}>
            {resolution.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </main>;
}