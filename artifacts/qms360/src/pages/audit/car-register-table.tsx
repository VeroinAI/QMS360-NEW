import { responseFieldLabel } from "@/lib/response-field-labels";
import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import type { CarRegisterEntry } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CarWordDownloadButton } from "./car-word-download";

export const CAR_REGISTER_COLUMNS = [
  "Audit Schedule", "Audit Title", "Audit Type", "Project / Department", "Audit Area", "Description",
  "Audit Findings", "Evidence", "Action Taker", "Corrective Action Recorded", "Edit", "Display", "Close / Resent CAR", "Download", "Log",
] as const;

const EDITABLE = ["Open", "Draft", "Rejected", "Returned for query", "Returned for rework"];
const tone = (s: string) => s === "Closed" || s === "Accepted" ? "default" as const : s === "Rejected" ? "destructive" as const : "secondary" as const;

export interface CarRegisterTableProps {
  entries: CarRegisterEntry[];
  auditAreaOptions?: ReadonlyArray<{ value: string; label: string }>;
  auditAreasLoading?: boolean;
  page: number;
  limit: number;
  busy: boolean;
  renderEvidence: (entry: CarRegisterEntry) => ReactNode;
  onEdit: (entry: CarRegisterEntry) => void;
  onDisplay: (entry: CarRegisterEntry) => void;
  onReview: (entry: CarRegisterEntry) => void;
  onLog: (entry: CarRegisterEntry) => void;
}

export function CarRegisterTable({ entries, auditAreaOptions = [], auditAreasLoading = false, page, limit, busy, renderEvidence, onEdit, onDisplay, onReview, onLog }: CarRegisterTableProps) {
  const cell = "border border-border px-2 py-1.5 align-top text-xs whitespace-normal break-words";
  return <div className="max-h-[70dvh] overflow-auto rounded-md border border-border" data-testid="table-car-register">
    <table className="w-full min-w-[1600px] border-collapse text-left">
      <caption className="sr-only">Corrective action register, page {page}, up to {limit} findings per page</caption>
      <thead>
        <tr>{CAR_REGISTER_COLUMNS.map(c => <th key={c} scope="col" className="sticky top-0 z-10 border border-border bg-muted px-2 py-2 text-xs font-semibold">{responseFieldLabel(c)}</th>)}</tr>
      </thead>
      <tbody>
        {entries.length === 0 && <tr data-testid="row-car-empty"><td colSpan={CAR_REGISTER_COLUMNS.length} className="border border-border px-3 py-10 text-center text-sm text-muted-foreground">No findings match these filters.</td></tr>}
        {entries.map(e => {
          const car = e.car;
          const canEdit = !!e.canRespond && !busy
            && (car ? EDITABLE.includes(car.status) : !e.legacy && EDITABLE.includes(e.status));
          const canReview = !!e.canReview && car?.status === "Submitted";
          const done = !!car?.correctiveAction?.trim();
          return <tr key={e.id} data-testid={`row-car-${e.id}`} className="odd:bg-background even:bg-muted/30">
            <td className={cell}>{e.scheduleName}</td>
            <td className={cell}>{e.auditTitle}</td>
            <td className={cell}>{e.auditTypes?.join(", ")}</td>
            <td className={cell}>{e.department || e.projectName}</td>
            <td className={cell}>{auditAreasLoading && e.auditArea ? "Loading Audit Area…" : auditAreaOptions.find(option => option.value === e.auditArea)?.label ?? e.auditArea}</td>
            <td className={`${cell} min-w-[240px] whitespace-pre-wrap`}>{e.description}</td>
            <td className={cell}>
              <div className="mb-1 whitespace-pre-wrap">{e.classification}</div>
              <div className="flex flex-wrap gap-1"><Badge variant={tone(e.status)}>{e.status}</Badge>{e.legacy && <Badge variant="outline">Historical</Badge>}</div>
            </td>
            <td className={cell}>{renderEvidence(e)}</td>
            <td className={cell}>{e.actionTakerName}</td>
            <td className={`${cell.replace("align-top", "align-middle")} text-center`} data-testid={`cell-action-recorded-${e.id}`}>{done && <CircleCheck className="mx-auto size-5 text-green-600" role="img" aria-label={responseFieldLabel("Corrective action recorded")} data-testid={`icon-action-taken-${e.id}`} />}</td>
            <td className={cell}><Button size="sm" variant="outline" data-testid={`button-respond-${e.id}`} disabled={!canEdit} onClick={() => onEdit(e)}>Edit</Button></td>
            <td className={cell}><Button size="sm" variant="outline" data-testid={`button-display-${e.id}`} onClick={() => onDisplay(e)}>Display</Button></td>
            <td className={cell}><Button size="sm" variant="outline" data-testid={`button-review-${e.id}`} disabled={!canReview} onClick={() => onReview(e)}>Close / Return CAR</Button></td>
            <td className={cell}><CarWordDownloadButton entry={e} /></td>
            <td className={cell}><Button size="sm" variant="outline" data-testid={`button-log-${e.id}`} onClick={() => onLog(e)}>Log</Button></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
