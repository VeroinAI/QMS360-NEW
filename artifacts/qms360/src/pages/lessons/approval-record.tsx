import type { ReactNode } from "react";
import type { LessonApprovalHistoryEntry } from "@workspace/api-client-react";
import { formatDateTime } from "@workspace/spreadsheet-dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const labels: Record<string, string> = {
  submit: "Submitted for approval by", approve: "Approved by",
  send_back: "Sent back by", transfer: "Approval reassigned by",
  review: "Reviewed by",
};
export function LessonApprovalRecord({ items, loading, error, onRetry, renderSignature }: {
  items: LessonApprovalHistoryEntry[]; loading?: boolean; error?: string; onRetry?: () => void;
  renderSignature?: (url: string) => ReactNode;
}) {
  return <Card>
    <CardHeader><CardTitle>Approval record</CardTitle>
      <p className="text-xs text-muted-foreground">Complete history · Latest action first</p>
    </CardHeader>
    <CardContent>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading approval history…</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>}
      {!loading && !error && !items.length && <p className="text-sm text-muted-foreground">No approval actions recorded yet.</p>}
      {!!items.length && <ol aria-label="Approval history, newest first" className="max-h-[36rem] space-y-4 overflow-y-auto pr-2">
        {items.map(entry => <li key={entry.id} className="border-t border-border pt-4 first:border-0 first:pt-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels[entry.action] ?? entry.action}</p>
          <p className="break-words font-medium">{entry.actorName}{entry.actorDesignation ? ` — ${entry.actorDesignation}` : ""}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(entry.occurredAt)}</p>
          {entry.comments && <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-sm"><span className="font-medium">Comments: </span>{entry.comments}</p>}
          {entry.signatureUrl && renderSignature?.(entry.signatureUrl)}
        </li>)}
      </ol>}
    </CardContent>
  </Card>;
}
