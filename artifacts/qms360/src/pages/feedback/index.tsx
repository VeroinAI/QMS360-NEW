import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, Loader2, MessageSquarePlus, Sparkles } from 'lucide-react';
import {
  useGetCurrentUser, useListFeedbackEntries, useRunFeedbackTriage, useUpdateFeedbackResolution,
  type FeedbackEntry,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';

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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(error: unknown) {
  return (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
    ?? (error as { message?: string })?.message ?? 'Something went wrong';
}

export function FeedbackPage() {
  const user = useGetCurrentUser();
  const isAdmin = ['Super Admin', 'Org Admin'].includes(user.data?.platformRole ?? '')
    || (user.data?.workspaceRoles.some((role) => /\b(admin|administrator)\b/i.test(role)) ?? false);
  const feedback = useListFeedbackEntries({ page: 1, limit: 200 }, { query: { enabled: isAdmin, queryKey: ['/api/feedback', { page: 1, limit: 200 }] } });
  const queryClient = useQueryClient();
  const resolution = useUpdateFeedbackResolution({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/feedback'] }); toast({ title: 'Resolution updated' }); },
      onError: (e) => toast({ title: 'Update failed', description: errorMessage(e), variant: 'destructive' }),
    },
  });
  const triage = useRunFeedbackTriage({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/feedback'] }); toast({ title: 'AI triage completed' }); },
      onError: (e) => toast({ title: 'AI triage unavailable', description: errorMessage(e), variant: 'destructive' }),
    },
  });
  const [triagingId, setTriagingId] = useState<string | null>(null);
  const runTriage = (id: string) => {
    setTriagingId(id);
    triage.mutate({ id }, { onSettled: () => setTriagingId(null) });
  };
  const [expanded, setExpanded] = useState<string | null>(null);

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
        <p className="mt-2 max-w-2xl opacity-80">Feedback submitted through the in-app feedback button, including AI triage results, user details, and submission time.</p>
      </div>
    </header>
    <div className="mx-auto max-w-7xl px-5 py-6 md:px-10">
      {feedback.isLoading ? <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : items.length === 0 ? <Card><CardContent className="flex flex-col items-center gap-3 p-16 text-center">
          <MessageSquarePlus className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">No feedback yet</p>
          <p className="text-sm text-muted-foreground">Entries submitted via the floating feedback button will appear here.</p>
        </CardContent></Card>
        : <div className="space-y-3">{items.map((entry: FeedbackEntry) => <Card key={entry.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="capitalize">{entry.category}</Badge>
                  {entry.module && <Badge variant="secondary">{moduleLabels[entry.module] ?? entry.module}</Badge>}
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
              </div>
              <div className="w-44 shrink-0 space-y-2">
                <Button variant="secondary" size="sm" className="w-full" disabled={triagingId === entry.id}
                  onClick={() => runTriage(entry.id)}>
                  {triagingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {entry.triage ? 'Re-run AI triage' : 'Run AI triage'}
                </Button>
                <Select value={entry.resolution} onValueChange={(value) => resolution.mutate({ id: entry.id, data: { resolution: value as 'open' | 'reviewing' | 'resolved' } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="reviewing">Reviewing</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>)}</div>}
    </div>
  </main>;
}
