import { formatDateTime } from '@workspace/spreadsheet-dates';
import { responseFieldLabel } from "@/lib/response-field-labels";
import { useState } from "react";
import type { ReactNode } from "react";
import { getListCarActivityQueryKey, useListCarActivity } from "@workspace/api-client-react";
import type { CarRegisterEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CarDisplayDialog({ entry, onClose, reviewNotes }: { entry: CarRegisterEntry; onClose: () => void; reviewNotes?: ReactNode }) {
  const car = entry.car;
  const fields = [
    ["Audit Schedule", entry.scheduleName], ["Audit Title", entry.auditTitle],
    ["Audit Type", entry.auditTypes?.join(", ")], ["Project / Department", entry.department || entry.projectName],
    ["Audit Area", entry.auditArea], ["Clause", entry.clause], ["Description", entry.description],
    ["Audit Findings", entry.classification], ["Action Taker", entry.actionTakerName],
    ["Status", entry.status], ["Root cause", car?.rootCause], ["Correction", car?.correction],
    ["Corrective action recorded", car?.correctiveAction],
  ];
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
       <DialogHeader><DialogTitle>CAR Response</DialogTitle><DialogDescription>{car ? "Read-only finding and corrective action response." : "No CAR response has been recorded for this finding yet. Finding details are read-only."}</DialogDescription></DialogHeader>
       <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className={["Description", "Root cause", "Correction", "Corrective action recorded"].includes(label!) ? "sm:col-span-2" : ""}>
        <dt className="text-xs font-medium text-muted-foreground">{responseFieldLabel(label!)}</dt><dd className="whitespace-pre-wrap break-words text-sm">{value || "—"}</dd>
      </div>)}</dl>
      {reviewNotes}
      <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </DialogContent>
  </Dialog>;
}

const LABELS: Record<string, string> = {
  update: "Save Response", submit: "Save & Submit Response",
};

function RecordedCarLog({ carId }: { carId: string }) {
  const [page, setPage] = useState(1);
  const params = { page, limit: 20 };
  const query = useListCarActivity(carId, params, { query: { queryKey: getListCarActivityQueryKey(carId, params), refetchInterval: 20_000 } });
  return <div className="space-y-3">
    {query.isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
    {query.error && <div className="text-sm text-destructive">Unable to load history. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
    {query.data && <><div className="overflow-x-auto rounded-md border"><table className="w-full text-left text-sm">
      <thead className="bg-muted"><tr>{["Date / Time", "Action", "User", "Status", "Comments"].map(label => <th scope="col" key={label} className="border p-2">{label}</th>)}</tr></thead>
      <tbody>{query.data.items.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No recorded CAR actions.</td></tr>}
        {query.data.items.map(event => <tr key={event.id}>
          <td className="whitespace-nowrap border p-2">{formatDateTime(event.createdAt)}</td>
          <td className="border p-2">{LABELS[event.action] || event.action}</td><td className="border p-2">{event.actorName}</td>
          <td className="border p-2">{event.status || "—"}</td><td className="whitespace-pre-wrap border p-2">{event.comments || "—"}</td>
        </tr>)}</tbody>
    </table></div><div className="flex items-center justify-between text-sm"><span>{query.data.total} recorded actions</span><div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <Button size="sm" variant="outline" disabled={page * 20 >= query.data.total} onClick={() => setPage(page + 1)}>Next</Button>
    </div></div></>}
  </div>;
}

export function CarLogDialog({ entry, onClose }: { entry: CarRegisterEntry; onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto">
      <DialogHeader><DialogTitle>CAR action log</DialogTitle><DialogDescription>Successful Save Response and Save &amp; Submit Response actions, newest first.</DialogDescription></DialogHeader>
      {entry.car ? <RecordedCarLog carId={entry.car.id} /> : <p className="text-sm text-muted-foreground">No CAR response has been started. No CAR actions have been recorded.</p>}
      <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </DialogContent>
  </Dialog>;
}
