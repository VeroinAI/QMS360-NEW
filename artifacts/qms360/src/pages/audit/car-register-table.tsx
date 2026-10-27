import { responseFieldLabel } from "@/lib/response-field-labels";
import { formatDate } from "@workspace/spreadsheet-dates";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGenerateMissingCarNumber, getListCarRegisterQueryKey, getGetAuditCarNumberingQueryKey, getGetCorrectiveActionReportQueryKey, getListCarActivityQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { ReactNode } from "react";
import { CircleCheck, Paperclip } from "lucide-react";
import type { CarRegisterEntry } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CarWordDownloadButton } from "./car-word-download";
import type { CarRegisterRow } from "./car-register-filters";

export const CAR_REGISTER_COLUMNS = [
  "CAR Number", "Audit Title", "Finding ID", "Project/Department", "Audit Area", "Audit Finding", "Risk Level",
  "Action Taker", "Assigned Date", "Due Date", "Actual Closure Date", "CAR Status", "Pending with", "Actions",
] as const;

const EDITABLE = ["Open", "Draft", "Rejected", "Returned for query", "Returned for rework"];
export const canEditCarEntry = (entry: CarRegisterEntry) => entry.canRespond === true
  && (entry.car ? EDITABLE.includes(entry.car.status) : !entry.legacy && EDITABLE.includes(entry.status));
const tone = (s: string) => s === "Closed" || s === "Accepted" ? "default" as const : s === "Rejected" ? "destructive" as const : "secondary" as const;
const DASH = "—";
const date = (v?: string | null) => v ? formatDate(v) : DASH;

export interface CarRegisterTableProps {
  entries: CarRegisterEntry[];
  auditAreaOptions?: ReadonlyArray<{ value: string; label: string }>;
  auditAreasLoading?: boolean;
  page: number;
  limit: number;
  busy: boolean;
  renderEvidence: (entry: CarRegisterEntry) => ReactNode;
  onEdit: (entry: CarRegisterEntry) => void;
  onOpenResponse: (entry: CarRegisterEntry) => void;
  onDisplay: (entry: CarRegisterEntry) => void;
  onReview: (entry: CarRegisterEntry) => void;
  onLog: (entry: CarRegisterEntry) => void;
}

function CarNumberRepair({ entry, busy }: { entry: CarRegisterEntry; busy: boolean }) {
  const generate = useGenerateMissingCarNumber();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [numberingError, setNumberingError] = useState("");
  const issueNumber = (entry: CarRegisterEntry) => {
    if (!entry.car || !window.confirm("Generate the missing CAR number using the saved number range? Response content and approval status will remain unchanged. An issued number cannot be reset.")) return;
    setNumberingError("");
    generate.mutate({ id: entry.car.id }, {
      onSuccess: result => {
        toast({ title: "CAR number generated", description: result.carNumber || undefined });
        void queryClient.invalidateQueries({ queryKey: getListCarRegisterQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAuditCarNumberingQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCorrectiveActionReportQueryKey(entry.car!.id) });
        void queryClient.invalidateQueries({ queryKey: getListCarActivityQueryKey(entry.car!.id) });
      },
      onError: error => setNumberingError(error instanceof Error ? error.message : "Could not generate the CAR number."),
    });
  };
  return <><Button size="sm" variant="outline" className="mt-2 font-sans" data-testid={`button-generate-car-number-${entry.id}`} disabled={busy || generate.isPending} onClick={() => issueNumber(entry)}>Generate CAR number</Button>
    {numberingError && <p role="alert" className="mt-2 font-sans text-destructive">{numberingError}</p>}</>;
}

export function CarRegisterTable({ entries, auditAreaOptions = [], auditAreasLoading = false, page, limit, busy, renderEvidence, onEdit, onOpenResponse, onDisplay, onReview, onLog }: CarRegisterTableProps) {
  const cell = "border-b border-r border-[hsl(268_30%_90%)] px-3 py-2 align-top text-xs leading-relaxed whitespace-normal break-words";
  return <div tabIndex={0} role="region" aria-label="Corrective Action Register table, scroll horizontally for more columns"
    className="max-h-[70dvh] overflow-auto rounded-lg border border-[hsl(268_30%_86%)] bg-[hsl(270_40%_99%)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(268_55%_45%)]"
    data-testid="table-car-register">
    <table className="w-full min-w-[1900px] border-collapse text-left">
      <caption className="sr-only">Corrective action register, page {page}, up to {limit} findings per page</caption>
      <thead>
        <tr>{CAR_REGISTER_COLUMNS.map(c => <th key={c} scope="col" className="sticky top-0 z-10 whitespace-nowrap border-r border-[hsl(268_45%_38%)] bg-[hsl(268_55%_32%)] px-3 py-2.5 text-xs font-semibold tracking-wide text-[hsl(270_60%_98%)]">{c}</th>)}</tr>
      </thead>
      <tbody>
        {entries.length === 0 && <tr data-testid="row-car-empty"><td colSpan={CAR_REGISTER_COLUMNS.length} className="px-3 py-12 text-center text-sm text-muted-foreground">No findings match these filters.</td></tr>}
        {entries.map(raw => {
          const e = raw as CarRegisterRow;
          const car = e.car;
          const canEdit = canEditCarEntry(e) && !busy;
          const canReview = !!e.canReview && car?.status === "Submitted";
          const done = !!car?.correctiveAction?.trim();
          const status = car?.status ?? e.status;
          return <tr key={e.id} data-testid={`row-car-${e.id}`} className="bg-[hsl(270_40%_99%)] even:bg-[hsl(268_40%_97%)] hover:bg-[hsl(268_50%_95%)]">
            <td className={`${cell} min-w-[150px] font-mono`} data-testid={`text-car-number-${e.id}`}>{car?.carNumber || <span className="font-sans text-muted-foreground">{car ? "Not numbered" : "Assigned on first response save"}</span>}
              {e.canNumber && <CarNumberRepair entry={e} busy={busy} />}
            </td>
            <td className={`${cell} min-w-[180px]`}><button type="button" className="text-left font-medium text-[hsl(268_55%_38%)] underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(268_55%_45%)] disabled:opacity-50"
              data-testid={`link-car-audit-title-${e.id}`} aria-haspopup="dialog" aria-label={`Open CAR Response for ${e.auditTitle}`} disabled={busy} onClick={() => onOpenResponse(e)}>{e.auditTitle}</button></td>
            <td className={cell} data-testid={`text-finding-id-${e.id}`}>{e.findingNumber || <span className="text-muted-foreground">Not numbered</span>}</td>
            <td className={`${cell} min-w-[150px]`}>{e.department || e.projectName || DASH}</td>
            <td className={`${cell} min-w-[140px]`}>{auditAreasLoading && e.auditArea ? "Loading Audit Area…" : auditAreaOptions.find(option => option.value === e.auditArea)?.label ?? e.auditArea}</td>
            <td className={`${cell} min-w-[260px] whitespace-pre-wrap`} data-testid={`text-audit-finding-${e.id}`}>
              <div className="font-medium">{e.classification}</div>
              {e.description && <div className="mt-1 text-muted-foreground">{e.description}</div>}
            </td>
            <td className={cell} data-testid={`text-risk-level-${e.id}`}>{e.riskLevel || DASH}</td>
            <td className={`${cell} min-w-[140px]`}>{e.actionTakerName || DASH}</td>
            <td className={`${cell} whitespace-nowrap`} data-testid={`text-assigned-date-${e.id}`}>{date(e.assignedAt)}</td>
            <td className={`${cell} whitespace-nowrap`} data-testid={`text-car-due-date-${e.id}`}>{e.dueDate ? formatDate(e.dueDate)
              : <span tabIndex={0} title="Finding Date missing or no due-date rule configured" aria-label="Due date unavailable: Finding Date missing or no due-date rule configured" className="cursor-help text-muted-foreground underline decoration-dotted">{DASH}</span>}</td>
            <td className={`${cell} whitespace-nowrap`} data-testid={`text-actual-closure-date-${e.id}`}>{date(e.actualClosedAt)}</td>
            <td className={cell} data-testid={`text-car-status-${e.id}`}>
              <div className="flex flex-wrap gap-1"><Badge variant={tone(status)}>{status}</Badge>{e.legacy && <Badge variant="outline">Historical</Badge>}</div>
              {car?.approval?.pendingLevel != null && <p className="mt-1">Approval Level {car.approval.pendingLevel}</p>}
            </td>
            <td className={`${cell} min-w-[140px]`} data-testid={`text-pending-with-${e.id}`}>{e.pendingWith || DASH}</td>
            <td className={`${cell} min-w-[300px]`} data-testid={`cell-actions-${e.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                {done && <CircleCheck className="size-5 text-green-600" role="img" aria-label={responseFieldLabel("Corrective action recorded")} data-testid={`icon-action-taken-${e.id}`} />}
                <Button size="sm" variant="outline" data-testid={`button-respond-${e.id}`} disabled={!canEdit} onClick={() => onEdit(e)}>Edit</Button>
                <Button size="sm" variant="outline" data-testid={`button-display-${e.id}`} onClick={() => onDisplay(e)}>Display</Button>
                <Button size="sm" variant="outline" data-testid={`button-review-${e.id}`} disabled={!canReview} onClick={() => onReview(e)}>Close / Return CAR</Button>
                <CarWordDownloadButton entry={e} />
                <Button size="sm" variant="outline" data-testid={`button-log-${e.id}`} onClick={() => onLog(e)}>Log</Button>
              </div>
              {e.evidenceIds.length > 0 && <details className="mt-2" data-testid={`details-evidence-${e.id}`}>
                <summary className="flex cursor-pointer items-center gap-1 text-[hsl(268_55%_38%)]"><Paperclip className="size-3.5"/>Evidence ({e.evidenceIds.length})</summary>
                <div className="mt-1">{renderEvidence(e)}</div>
              </details>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
