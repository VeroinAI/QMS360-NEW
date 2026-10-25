import type { CorrectiveActionReport } from "@workspace/api-client-react";
import { formatDateTime } from "@workspace/spreadsheet-dates";

export function CarApprovalDetails({ car }: { car: CorrectiveActionReport }) {
  const approval = car.approval;
  if (!approval || approval.status === "Not submitted") {
    return car.status === "Submitted" ? <p className="text-sm text-muted-foreground">Legacy review — assigned Audit Team Lead acceptance closes this CAR.</p> : null;
  }
  return <section className="space-y-2 rounded-md border p-3 text-sm" aria-label="CAR approval">
    <p className="font-medium">{approval.status}{approval.pendingLevel != null ? ` — Approval Level ${approval.pendingLevel}` : ""}</p>
    {approval.status === "Pending approval" && <p>{car.canReview ? "You can accept, query or return this response for rework at the current level." : "Awaiting an eligible reviewer at the current level. Contact your administrator if reviewer assignments are unavailable."} The response is locked until returned. Only final-level acceptance closes the CAR.</p>}
    {approval.status === "Sent back" && <p>The Action Taker can revise and resubmit. Resubmission restarts the configured Approval Levels.</p>}
    {approval.history.length > 0 && <div className="space-y-2"><h3 className="font-medium">Decision history</h3>
      {approval.history.map((entry, index) => <div key={`${entry.at}-${index}`} className="border-t pt-2">
        <p>Level {entry.level} — {entry.decision === "accept" ? "Accepted" : entry.decision === "query" ? "Query" : "Rework"} — {entry.userName}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</p>
        {entry.remarks && <p className="whitespace-pre-wrap">{entry.remarks}</p>}
      </div>)}
    </div>}
  </section>;
}
