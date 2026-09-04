import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquarePlus, Sparkles } from 'lucide-react';
import { useSubmitFeedback, useTriageFeedback, type FeedbackTriage } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';

type Category = 'issue' | 'suggestion' | 'question';

const verdictLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  valid_issue: { label: 'Valid issue', variant: 'destructive' },
  awareness_gap: { label: 'Feature already available', variant: 'secondary' },
  suggestion: { label: 'Enhancement suggestion', variant: 'default' },
  unclear: { label: 'Needs clarification', variant: 'outline' },
};

function errorMessage(error: unknown) {
  return (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
    ?? (error as { message?: string })?.message ?? 'Something went wrong';
}

export function FeedbackWidget() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('issue');
  const [message, setMessage] = useState('');
  const [triage, setTriage] = useState<FeedbackTriage | null>(null);
  const queryClient = useQueryClient();

  const pagePath = location;
  const appKey = location.startsWith('/qaqc') ? 'qaqc' : location.startsWith('/lessons') ? 'lessons' : location.startsWith('/audit') ? 'audit' : null;
  const canTriage = message.trim().length >= 10;

  const triageMutation = useTriageFeedback({
    mutation: {
      onSuccess: (result) => setTriage(result),
      onError: (e) => toast({ title: 'AI triage unavailable', description: errorMessage(e), variant: 'destructive' }),
    },
  });
  const submit = useSubmitFeedback({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/feedback'] });
        toast({ title: 'Feedback submitted', description: 'Thank you — the admin team can now review it.' });
        setOpen(false); setMessage(''); setCategory('issue'); setTriage(null);
      },
      onError: (e) => toast({ title: 'Unable to submit feedback', description: errorMessage(e), variant: 'destructive' }),
    },
  });

  const verdict = triage ? verdictLabels[triage.verdict] ?? verdictLabels.unclear : null;

  return <>
    {createPortal(
      <Button aria-label="Give feedback" onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 50 }}
        className="h-12 w-12 rounded-full p-0 shadow-lg">
        <MessageSquarePlus className="h-5 w-5" />
      </Button>,
      document.body,
    )}
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) { setTriage(null); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report an issue or share feedback</DialogTitle>
          <DialogDescription>
            Tell us what happened while testing. You can optionally run AI Triage before submitting — it checks whether the capability already exists and shows you how to use it. Your feedback is logged either way.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Type</Label>
            <Select value={category} onValueChange={(value) => { setCategory(value as Category); setTriage(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="issue">Issue / bug</SelectItem>
                <SelectItem value="suggestion">Suggestion</SelectItem>
                <SelectItem value="question">Question</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-2 block">Feedback</Label>
            <Textarea rows={5} value={message} placeholder="Describe the issue, what you expected, and where it happened…"
              onChange={(e) => { setMessage(e.target.value); setTriage(null); }} />
            <p className="mt-1 text-xs text-muted-foreground">Captured from: {pagePath}</p>
          </div>
          {triage && verdict && <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">AI Triage</span>
              <Badge variant={verdict.variant}>{verdict.label}</Badge>
            </div>
            <p className="text-sm">{triage.summary}</p>
            {triage.verdict === 'awareness_gap' && triage.guidance && (
              <div className="mt-2 rounded-md bg-background p-2 text-sm whitespace-pre-line">{triage.guidance}</div>
            )}
          </div>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="secondary" disabled={!canTriage || triageMutation.isPending}
            onClick={() => triageMutation.mutate({ data: { category, message: message.trim(), pagePath } })}>
            {triageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            AI Triage
          </Button>
          <Button type="button" disabled={message.trim().length < 5 || submit.isPending}
            onClick={() => submit.mutate({ data: { category, message: message.trim(), appKey, pagePath, triage: triage ?? null } })}>
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
