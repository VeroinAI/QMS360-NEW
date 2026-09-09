import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, MessageSquarePlus, Paperclip, Sparkles, X } from 'lucide-react';
import { customFetch, downloadFeedbackAttachment, getListMyFeedbackEntriesQueryKey, useCreateFeedbackAttachment, useListMyFeedbackEntries, useSubmitFeedback, useTriageFeedback, type FeedbackTriage } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { userFacingApiError } from '@/lib/api-error';

type Category = 'issue' | 'suggestion' | 'question';
type ModuleKey = 'qaqc' | 'lessons' | 'audit' | 'system';
const acceptedFileTypes = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp';

export const feedbackModules: { value: ModuleKey; label: string }[] = [
  { value: 'qaqc', label: 'QA/QC & Document Governance' },
  { value: 'lessons', label: 'Lessons Learned' },
  { value: 'audit', label: 'QMS Audit Management' },
  { value: 'system', label: 'System / General (access, navigation, settings)' },
];

const verdictLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  valid_issue: { label: 'Valid issue', variant: 'destructive' },
  awareness_gap: { label: 'Feature already available', variant: 'secondary' },
  suggestion: { label: 'Enhancement suggestion', variant: 'default' },
  unclear: { label: 'Needs clarification', variant: 'outline' },
};

function errorMessage(error: unknown) {
  const details = userFacingApiError(error, 'The server could not complete the request.');
  return `${details.message} (${details.technicalCode})`;
}

export function FeedbackWidget() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState<ModuleKey | ''>('');
  const [moduleError, setModuleError] = useState(false);
  const [category, setCategory] = useState<Category>('issue');
  const [message, setMessage] = useState('');
  const [triage, setTriage] = useState<FeedbackTriage | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const queryClient = useQueryClient();
  const myFeedbackParams = { page: 1, limit: 5 };
  const myFeedback = useListMyFeedbackEntries(myFeedbackParams, { query: { enabled: open, queryKey: getListMyFeedbackEntriesQueryKey(myFeedbackParams) } });

  const pagePath = location;
  const appKey = location.startsWith('/qaqc') ? 'qaqc' : location.startsWith('/lessons') ? 'lessons' : location.startsWith('/audit') ? 'audit' : null;
  const openDialog = (value: boolean) => {
    setOpen(value);
    if (value) { setModule(appKey ?? ''); setModuleError(false); }
    else { setTriage(null); setAttachments([]); }
  };
  const canTriage = message.trim().length >= 10;

  const triageMutation = useTriageFeedback({
    mutation: {
      onSuccess: (result) => setTriage(result),
      onError: (e) => toast({ title: 'AI triage unavailable', description: errorMessage(e), variant: 'destructive' }),
    },
  });
  const submit = useSubmitFeedback({
    mutation: {
      onError: (e) => toast({ title: 'Unable to submit feedback', description: errorMessage(e), variant: 'destructive' }),
    },
  });
  const createAttachment = useCreateFeedbackAttachment();

  const chooseAttachments = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files);
    const tooLarge = next.find((file) => file.size > 10 * 1024 * 1024);
    if (tooLarge) {
      toast({ title: 'File is too large', description: `${tooLarge.name} exceeds the 10 MB limit.`, variant: 'destructive' });
      return;
    }
    setAttachments((current) => {
      const combined = [...current, ...next];
      if (combined.length > 5) toast({ title: 'Attachment limit reached', description: 'You can attach up to 5 reference files.', variant: 'destructive' });
      return combined.slice(0, 5);
    });
  };

  const submitFeedback = async () => {
    if (!module) { setModuleError(true); return; }
    try {
      const created = await submit.mutateAsync({ data: { module, category, message: message.trim(), appKey, pagePath, triage: triage ?? null } });
      let failedUploads = 0;
      if (attachments.length) {
        setUploadingAttachments(true);
        for (const file of attachments) {
          try {
            const intent = await createAttachment.mutateAsync({
              id: created.id,
              data: { fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
            });
            await customFetch(intent.uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
              body: file,
            });
          } catch {
            failedUploads += 1;
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ['/api/feedback'] });
      queryClient.invalidateQueries({ queryKey: ['/api/feedback/mine'] });
      setOpen(false); setModule(''); setModuleError(false); setMessage(''); setCategory('issue'); setTriage(null); setAttachments([]);
      if (failedUploads) {
        toast({ title: 'Feedback submitted with attachment errors', description: `${failedUploads} reference file${failedUploads === 1 ? '' : 's'} could not be uploaded.`, variant: 'destructive' });
      } else {
        toast({ title: 'Feedback submitted', description: 'Thank you — the admin team can now review it.' });
      }
    } finally {
      setUploadingAttachments(false);
    }
  };

  const downloadAttachment = async (id: string, name: string) => {
    try {
      const blob = await downloadFeedbackAttachment(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: 'Unable to download attachment', description: errorMessage(error), variant: 'destructive' });
    }
  };

  const verdict = triage ? verdictLabels[triage.verdict] ?? verdictLabels.unclear : null;

  return <>
    {createPortal(
      <Button aria-label="Give feedback" onClick={() => openDialog(true)}
        style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 50 }}
        className="h-12 w-12 rounded-full p-0 shadow-lg">
        <MessageSquarePlus className="h-5 w-5" />
      </Button>,
      document.body,
    )}
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[760px] w-[calc(100vw-2rem)] max-w-xl grid-rows-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-10 sm:px-6">
          <DialogTitle>Report an issue or share feedback</DialogTitle>
          <DialogDescription>
            Tell us what happened while testing. You can optionally run AI Triage before submitting — it checks whether the capability already exists and shows you how to use it. Your feedback is logged either way.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
          <div>
            <Label className="mb-2 block">Module / Functionality <span className="text-destructive">*</span></Label>
            <Select value={module} onValueChange={(value) => { setModule(value as ModuleKey); setModuleError(false); setTriage(null); }}>
              <SelectTrigger className={moduleError ? 'border-destructive focus-visible:ring-destructive' : ''} aria-invalid={moduleError}>
                <SelectValue placeholder="Select the module this relates to" />
              </SelectTrigger>
              <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">
                {feedbackModules.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {moduleError && <p className="mt-1 text-sm font-medium text-destructive" role="alert">Please select a module or functionality.</p>}
          </div>
          <div>
            <Label className="mb-2 block">Type</Label>
            <Select value={category} onValueChange={(value) => { setCategory(value as Category); setTriage(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">
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
          <div>
            <Label className="mb-2 block">Reference files <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
              <Paperclip className="h-4 w-4" />
              Attach files
              <input className="sr-only" type="file" multiple accept={acceptedFileTypes} onChange={(event) => { chooseAttachments(event.target.files); event.target.value = ''; }} />
            </label>
            <p className="mt-1 text-xs text-muted-foreground">Up to 5 files, 10 MB each. Documents, spreadsheets, text files, and images are supported.</p>
            {attachments.length > 0 && <div className="mt-2 space-y-1">
              {attachments.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-sm">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X className="h-4 w-4" />
                </button>
              </div>)}
            </div>}
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
          {(myFeedback.data?.items.length ?? 0) > 0 && <div className="border-t pt-4">
            <p className="mb-2 text-sm font-semibold">Your recent feedback</p>
            <div className="space-y-2">
              {myFeedback.data?.items.map((entry) => <div key={entry.id} className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{entry.message}</span>
                   <Badge variant={entry.resolution === 'closed' ? 'secondary' : entry.resolution === 'resolved' ? 'default' : 'outline'} className="shrink-0 capitalize">{entry.resolution}</Badge>
                </div>
                {entry.resolutionResponse && <p className="mt-2 whitespace-pre-line rounded bg-background p-2 text-muted-foreground">
                  <span className="font-medium text-foreground">Admin response:</span> {entry.resolutionResponse}
                </p>}
                 {(entry.attachments?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1">
                   {entry.attachments?.map((attachment) => <Button key={attachment.id} type="button" variant="outline" size="sm" className="h-7 max-w-full"
                     onClick={() => downloadAttachment(attachment.id, attachment.fileName)}>
                     <Paperclip className="h-3.5 w-3.5" /><span className="truncate">{attachment.fileName}</span>
                   </Button>)}
                 </div>}
              </div>)}
            </div>
          </div>}
        </div>
        <DialogFooter className="z-10 shrink-0 gap-2 border-t bg-background px-4 py-4 sm:justify-between sm:px-6">
          <Button type="button" variant="secondary" disabled={!canTriage || triageMutation.isPending}
            onClick={() => triageMutation.mutate({ data: { module: module || undefined, category, message: message.trim(), pagePath } })}>
            {triageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            AI Triage
          </Button>
           <Button type="button" className="min-w-36" disabled={message.trim().length < 5 || submit.isPending || uploadingAttachments}
             onClick={submitFeedback}>
             {(submit.isPending || uploadingAttachments) && <Loader2 className="h-4 w-4 animate-spin" />}
             {uploadingAttachments ? 'Uploading files…' : 'Submit feedback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
