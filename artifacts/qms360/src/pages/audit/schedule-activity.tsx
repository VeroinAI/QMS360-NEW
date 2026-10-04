import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { useListAuditProgrammeActivity, useListAuditScheduleActivity, getListAuditProgrammeActivityQueryKey, getListAuditScheduleActivityQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PAGE_SIZE = 20;
const actions: Record<string, string> = {
  create: "Created", restore: "Restored", update: "Updated", delete: "Deleted",
  submit: "Submitted", resubmit: "Resubmitted", approve: "Approval recorded", send_back: "Sent back",
  update_team_leads: "Team Leads changed", assign_reference: "QA/QC reference assigned",
  programme_submit: "Submitted with schedule", programme_send_back: "Returned to Draft with schedule",
  programme_approve: "Approved with schedule", cancel_audit: "Audit cancelled", reschedule_audit: "Rescheduling requested",
  confirm: "Attachment upload confirmed",
};
export function ScheduleActivityButton({ id, title, programme = false }: { id: string; title: string; programme?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="outline" aria-label={`Audit Log for ${title}`} onClick={() => setOpen(true)}><History className="mr-1 size-4"/>Audit Log</Button>
    {open && <ScheduleActivityDialog key={id} id={id} title={title} programme={programme} onClose={() => setOpen(false)}/>}
  </>;
}
function ScheduleActivityDialog({ id, title, programme, onClose }: { id: string; title: string; programme: boolean; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const options = { query: { queryKey: getListAuditProgrammeActivityQueryKey(id, { page, limit: PAGE_SIZE }), enabled: programme, refetchOnMount: "always" as const, refetchInterval: 30_000 } };
  const parent = useListAuditProgrammeActivity(id, { page, limit: PAGE_SIZE }, options);
  const child = useListAuditScheduleActivity(id, { page, limit: PAGE_SIZE }, {
    query: { ...options.query, queryKey: getListAuditScheduleActivityQueryKey(id, { page, limit: PAGE_SIZE }), enabled: !programme },
  });
  const query = programme ? parent : child;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timestamp = (value: string) => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "long",
  }).format(new Date(value));
  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
      <DialogHeader><DialogTitle>Audit Log — {title}</DialogTitle>
        <DialogDescription>Read-only event history, newest first. Times shown in {timezone}. {programme ? "Includes visible child audits and retained deletion events." : "Includes audit changes and attachment activity."} Older events appear only where historical records exist.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{query.data?.total ?? 0} events</span>
        <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="mr-1 size-4"/>Refresh</Button>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {query.isLoading && <p className="py-6 text-sm text-muted-foreground">Loading audit log…</p>}
        {query.isError && <p role="alert" className="py-6 text-sm text-destructive">Unable to load the audit log. Use Refresh to retry.</p>}
        {!query.isLoading && !query.isError && !query.data?.items.length && <p className="py-6 text-sm text-muted-foreground">No recorded events for this schedule.</p>}
        {!query.isError && query.data?.items.map(entry => <article key={entry.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{actions[entry.action] ?? entry.action.replaceAll("_", " ")}</Badge>
              <span className="text-sm font-medium">{entry.recordKind === "programme" ? "Schedule" : entry.recordKind === "attachment" ? "Attachment" : "Audit"}: {entry.recordTitle}</span></div>
              <p className="mt-2 text-sm">By <span className="font-medium">{entry.actorName}</span></p></div>
            <time dateTime={entry.occurredAt} className="text-xs text-muted-foreground">{timestamp(entry.occurredAt)}</time>
          </div>
          {(entry.previousStatus || entry.status) && <p className="text-sm capitalize">{entry.previousStatus ?? "Not recorded"} → {entry.status ?? "Not recorded"}</p>}
          {entry.remarks && <p className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">Remarks: </span>{entry.remarks}</p>}
          {!!entry.changes.length && <details className="text-sm"><summary className="cursor-pointer font-medium">{entry.changes.length} recorded field {entry.changes.length === 1 ? "change" : "changes"}</summary>
            <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs">
              <thead><tr className="border-b"><th className="p-2">Field</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead>
              <tbody>{entry.changes.map(change => <tr key={change.field} className="border-b align-top">
                <th className="p-2 font-medium">{change.label}</th><td className="max-w-64 whitespace-pre-wrap break-words p-2">{change.before ?? "—"}</td><td className="max-w-64 whitespace-pre-wrap break-words p-2">{change.after ?? "—"}</td>
              </tr>)}</tbody></table></div>
          </details>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Event identifiers</summary><p className="mt-1 break-all">Event: {entry.id}<br/>Record: {entry.recordId}<br/>Actor: {entry.actorId ?? "System"}{entry.requestId && <><br/>Request: {entry.requestId}</>}</p></details>
        </article>)}
      </div>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button size="sm" variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>Previous</Button>
        <span className="self-center text-sm">Page {page}</span>
        <Button size="sm" variant="outline" disabled={!query.data || page * PAGE_SIZE >= query.data.total || query.isFetching} onClick={() => setPage(value => value + 1)}>Next</Button>
      </div>
    </DialogContent>
  </Dialog>;
}