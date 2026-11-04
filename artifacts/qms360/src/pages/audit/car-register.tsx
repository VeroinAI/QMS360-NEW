import { responseFieldLabels } from "@/lib/response-field-labels";
import { useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAuditCarNumberingQueryKey } from "@workspace/api-client-react";
import { Download } from "lucide-react";
import {
   customFetch, getGetCorrectiveActionReportQueryKey, getListCarActivityQueryKey, getListCarRegisterQueryKey, useListAuditEvidence, useListCarRegister,
  useReviewCorrectiveActionReport, useStartFindingCar, useUpdateCorrectiveActionReport,
  useOpenCarEditSession, useGetCurrentUser,
} from "@workspace/api-client-react";
import type { CarRegisterEntry, CorrectiveActionReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { canEditCarEntry, CarRegisterTable } from "./car-register-table";
import { CarResponseDetails, CarLogDialog } from "./car-register-details";
import { useFieldControls } from "@/lib/field-controls";
import { useFieldAccess } from "@/lib/use-field-access";
import { useLov } from "@/lib/use-lov";
import { AuditAttachments } from "./audit-attachments";
import { ALL, buildCarRegisterParams, CAR_FILTERS, EMPTY_CAR_FILTERS, filterOptions } from "./car-register-filters";
import type { CarFilterKey, CarFilterState, CarRegisterPageWithOptions } from "./car-register-filters";
import { useAuditCapabilities } from "@/lib/use-audit-capabilities";
import { CarApprovalDetails } from "./car-approval-details";

const LIMIT = 10;
const EDITABLE = ["Open", "Draft", "Rejected", "Returned for query", "Returned for rework"];
const errorText = (e: unknown) => e instanceof Error ? e.message : "Please try again.";
const outcomeLabel = (o?: string | null) => o === "query" ? "Query" : o === "rework" ? "Rework" : o === "reject" ? "Rejected" : o === "accept" ? "Accepted" : o ?? "";

export function useCarRefresh(carId?: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: getListCarRegisterQueryKey().slice(0, 1) });
    void qc.invalidateQueries({ queryKey: ["/api/audit/cars"] });
    if (carId) {
      void qc.invalidateQueries({ queryKey: getGetCorrectiveActionReportQueryKey(carId) });
      void qc.invalidateQueries({ queryKey: getListCarActivityQueryKey(carId).slice(0, 1) });
    }
    void qc.invalidateQueries({ queryKey: ["/api/audit/my-actions"] });
  };
}

export function CarReviewNotes({ car }: { car: CorrectiveActionReport }) {
  if (!car.reviewComments && !car.reviewOutcome) return null;
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950" data-testid={`text-review-${car.id}`}>
    <b>Review{car.reviewOutcome ? ` — ${outcomeLabel(car.reviewOutcome)}` : ""}:</b> <span className="whitespace-pre-wrap">{car.reviewComments || "No comments."}</span></div>;
}

export function CarResponseDialog({ car, entry, auditAreaLabel, evidence, open, onClose, readOnly = false }: {
  car?: CorrectiveActionReport; entry?: CarRegisterEntry; auditAreaLabel?: string; evidence?: ReactNode;
  open: boolean; onClose: () => void; readOnly?: boolean;
}) {
  const { toast } = useToast();
  const refresh = useCarRefresh(car?.id);
  const qc = useQueryClient();
  const update = useUpdateCorrectiveActionReport();
  const controls = useFieldControls("audit", "car");
  const access = useFieldAccess("audit");
  const permissions = useAuditCapabilities();
  const viewOnly = readOnly || !car || car.canRespond !== true || !EDITABLE.includes(car.status);
  const [f, setF] = useState({ rootCause: car?.rootCause ?? "", correction: car?.correction ?? "", correctiveAction: car?.correctiveAction ?? "" });
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = update.isPending || uploading;
  const valid = !!f.rootCause.trim() && !!f.correction.trim() && !!f.correctiveAction.trim();
  const clean = { rootCause: f.rootCause.trim(), correction: f.correction.trim(), correctiveAction: f.correctiveAction.trim() };
  const run = async (andSubmit: boolean) => {
    if (viewOnly || !car || busy || (andSubmit && !permissions.can("cars", "submit"))) return;
    setErr("");
    if (andSubmit && !valid) { setErr(`${responseFieldLabels.rootCause}, ${responseFieldLabels.correction} and ${responseFieldLabels.correctiveAction} are all required to submit.`); return; }
    const body = { ...car, ...clean };
    const missing = controls.mandatoryFieldKeys().filter(key => {
      const value = (body as unknown as Record<string, unknown>)[key];
      return value == null || (typeof value === "string" && !value.trim());
    });
    if (missing.length) { setErr(`Complete required fields: ${missing.join(", ")}.`); return; }
    try {
      const saved = await update.mutateAsync({ id: car.id, data: { ...clean, saveAndSubmit: andSubmit } });
      refresh();
      void qc.invalidateQueries({ queryKey: getGetAuditCarNumberingQueryKey() });
      const num = (saved as CorrectiveActionReport | undefined)?.carNumber;
      toast({ title: andSubmit ? "CAR submitted" : "Response saved", description: num ? `CAR Number ${num}` : undefined });
      onClose();
    } catch (e) { setErr(errorText(e)); refresh(); }
  };
  const field = (key: keyof typeof f, label: string) => <div className="space-y-1"><Label htmlFor={`car-${key}`}>{label}{!viewOnly && " *"}</Label>
    <Textarea id={`car-${key}`} data-testid={`input-car-${key}`} rows={3} value={f[key]} readOnly={viewOnly} disabled={!viewOnly && (busy || controls.fieldProps(key).disabled || access.readOnly("car", key))} onChange={e => { if (!viewOnly) setF(v => ({ ...v, [key]: e.target.value })); }}/></div>;
  return <Dialog open={open} onOpenChange={v => { if (!v && !busy) onClose(); }}>
    <DialogContent className={`max-h-[90dvh] overflow-y-auto ${entry ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
       <DialogHeader><DialogTitle>CAR Response</DialogTitle><DialogDescription>{viewOnly ? "Read-only CAR response. Editing requires the assigned Action Taker and an editable CAR status." : "Finding details are read-only. Enter the root cause, correction and corrective action below."}</DialogDescription></DialogHeader>
      <div className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="text-car-number">
        <span className="text-xs uppercase text-muted-foreground">CAR Number</span>
        {car?.carNumber ? <p className="font-mono font-semibold">{car.carNumber}</p>
          : <p className="text-muted-foreground">{viewOnly ? "Not numbered" : "Not numbered yet. A CAR Number is assigned on the first successful Save response or Save & submit and is retained on later edits and retries."}</p>}
      </div>
      {entry && <CarResponseDetails entry={entry} auditAreaLabel={auditAreaLabel ?? entry.auditArea} evidence={evidence ?? "—"} />}
      {car && <CarReviewNotes car={car}/>}
      {car && <CarApprovalDetails car={car}/>}
      {field("rootCause", responseFieldLabels.rootCause)}{field("correction", responseFieldLabels.correction)}{field("correctiveAction", responseFieldLabels.correctiveAction)}
      {car && <AuditAttachments auditId={car.id} recordType="car" readOnly={viewOnly || update.isPending} onUploadingChange={setUploading}/>}
      {err && <p role="alert" data-testid="status-car-error" className="text-sm text-destructive">{err}</p>}
       <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{viewOnly ? "Close" : "Cancel"}</Button>
         {!viewOnly && <><Button variant="outline" data-testid="button-save-car" disabled={busy} onClick={() => void run(false)}>Save response</Button>
         <Button data-testid="button-save-submit-car" disabled={busy || !permissions.can("cars", "submit")} onClick={() => void run(true)}>{busy ? "Working…" : "Save & submit"}</Button></>}</DialogFooter>
    </DialogContent></Dialog>;
}

export function CarReviewDialog({ car, open, onClose }: { car: CorrectiveActionReport; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useCarRefresh(car.id);
  const review = useReviewCorrectiveActionReport();
  const [decision, setDecision] = useState<"accept" | "query" | "rework">("accept");
  const [comments, setComments] = useState("");
  const [err, setErr] = useState("");
  const go = () => {
    if (decision !== "accept" && !comments.trim()) { setErr("Comments are required for query or rework."); return; }
    review.mutate({ id: car.id, data: { decision, comments: comments.trim() || null } }, {
      onSuccess: saved => { refresh(); toast({ title: decision === "accept" ? saved.status === "Closed" ? "CAR closed" : "CAR advanced to next Approval Level" : decision === "query" ? "Query sent" : "Sent for rework" }); onClose(); },
      onError: e => { setErr(errorText(e)); refresh(); },
    });
  };
  return <Dialog open={open} onOpenChange={v => { if (!v && !review.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Review CAR response{car.approval?.pendingLevel != null ? ` — Level ${car.approval.pendingLevel}` : ""}</DialogTitle><DialogDescription>{car.approval?.pendingLevel != null && car.approval.pendingLevel !== car.approval.finalLevel ? "Accepting advances this response to the next Approval Level without closing the CAR." : "Final acceptance closes the CAR. Query or rework returns the response to the Action Taker."}</DialogDescription></DialogHeader>
      <CarApprovalDetails car={car}/>
      <div className="space-y-1 text-sm"><p><b>{responseFieldLabels.rootCause}:</b> {car.rootCause}</p><p><b>{responseFieldLabels.correction}:</b> {car.correction}</p><p><b>{responseFieldLabels.correctiveAction}:</b> {car.correctiveAction}</p></div>
      <Select value={decision} onValueChange={v => { setDecision(v as typeof decision); setErr(""); }}>
        <SelectTrigger data-testid="select-review-decision"><SelectValue/></SelectTrigger>
        <SelectContent><SelectItem value="accept">{car.approval?.pendingLevel != null && car.approval.pendingLevel !== car.approval.finalLevel ? "Accept and advance" : "Accept and close"}</SelectItem><SelectItem value="query">Query</SelectItem><SelectItem value="rework">Rework</SelectItem></SelectContent></Select>
      <div className="space-y-1"><Label htmlFor="review-comments">Comments{decision !== "accept" ? " *" : ""}</Label><Textarea id="review-comments" data-testid="input-review-comments" rows={3} value={comments} onChange={e => setComments(e.target.value)}/></div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <DialogFooter><Button variant="outline" disabled={review.isPending} onClick={onClose}>Cancel</Button><Button data-testid="button-confirm-review" disabled={review.isPending} onClick={go}>{review.isPending ? "Saving…" : "Submit review"}</Button></DialogFooter>
    </DialogContent></Dialog>;
}

function Evidence({ entry }: { entry: CarRegisterEntry }) {
  const { toast } = useToast();
  const has = entry.evidenceIds.length > 0;
  const ev = useListAuditEvidence({ recordType: "audit", recordId: entry.auditId, page: 1, limit: 200 }, { query: { enabled: has } as never });
  if (!has) return <>—</>;
  const files = new Map((ev.data?.items ?? []).map(x => [x.id, x]));
  const download = async (url: string, name: string) => {
    try {
      const blob = await customFetch<Blob>(url, { responseType: "blob" });
      const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click();
      window.setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (e) { toast({ title: "Unable to download evidence", description: errorText(e), variant: "destructive" }); }
  };
  return <>{entry.evidenceIds.map(id => { const x = files.get(id);
    return x?.storageUrl ? <button key={id} type="button" className="mb-1 flex items-start gap-1 text-left text-primary hover:underline" onClick={() => void download(x.storageUrl!, x.fileName)}><Download className="mt-0.5 size-3.5 shrink-0"/><span className="break-all">{x.fileName}</span></button>
      : <span key={id} className="mb-1 block text-muted-foreground">{ev.isLoading ? "Loading…" : "File unavailable"}</span>; })}</>;
}

export function CarRegister() {
  const { toast } = useToast();
  const auditAreas = useLov("Audit Area");
  const refresh = useCarRefresh();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CarFilterState>(EMPTY_CAR_FILTERS);
  const [legacy, setLegacy] = useState(false);
  const [respond, setRespond] = useState<{ car: CorrectiveActionReport; entry: CarRegisterEntry }>();
  const [reviewing, setReviewing] = useState<CorrectiveActionReport>();
  const [displaying, setDisplaying] = useState<CarRegisterEntry>();
  const [logging, setLogging] = useState<CarRegisterEntry>();
  const currentUser = useGetCurrentUser();
  const userKey = currentUser.data?.id;
  const params = buildCarRegisterParams(filters, page, LIMIT, legacy);
  const query = useListCarRegister(params, { query: { queryKey: [...getListCarRegisterQueryKey(params), userKey], enabled: !!userKey, refetchInterval: 20_000, staleTime: 10_000, refetchOnWindowFocus: true } });
  const start = useStartFindingCar();
  const editSession = useOpenCarEditSession();
  const data = query.data as CarRegisterPageWithOptions | undefined;
  const setFilter = (key: CarFilterKey, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };
  const open = (e: CarRegisterEntry) => {
    if (!canEditCarEntry(e)) return;
    if (e.car) {
      editSession.mutate({ id: e.car.id }, {
        onSuccess: car => setRespond({ car, entry: { ...e, car } }),
        onError: err => toast({ title: "Unable to open CAR", description: errorText(err), variant: "destructive" }),
      });
      return;
    }
    start.mutate({ data: { auditId: e.auditId, itemId: e.itemId } }, {
      onSuccess: car => { refresh(); setRespond({ car, entry: { ...e, car } }); },
      onError: err => toast({ title: "Unable to start CAR", description: errorText(err), variant: "destructive" }),
    });
  };
  const latestEntry = (entry: CarRegisterEntry) => data?.items.find(item => item.id === entry.id) ?? entry;
  const responseDetails = (entry: CarRegisterEntry) => ({
    entry,
    auditAreaLabel: auditAreas.isLoading && entry.auditArea ? "Loading Audit Area…"
      : auditAreas.options.find(option => option.value === entry.auditArea)?.label ?? entry.auditArea,
    evidence: <Evidence entry={entry} />,
  });
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">Corrective Action Register</h1><p className="mt-1 text-sm text-muted-foreground">Audit findings and the corrective action responses raised against them</p></div>
    <div className="rounded-lg border border-[hsl(268_30%_88%)] bg-[hsl(270_40%_99%)] p-3" role="group" aria-label="CAR Register filters">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {CAR_FILTERS.map(f => <div key={f.key} className="min-w-0 space-y-1">
          <Label htmlFor={`car-filter-${f.testId}`} className="text-xs font-medium text-[hsl(268_40%_30%)]">{f.label}</Label>
          <Select value={filters[f.key]} onValueChange={v => setFilter(f.key, v)}>
            <SelectTrigger id={`car-filter-${f.testId}`} aria-label={f.label} className="w-full bg-background" data-testid={`select-car-${f.testId}`}><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All</SelectItem>{filterOptions(data, f.option).map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm"><Checkbox data-testid="checkbox-include-legacy" checked={legacy} onCheckedChange={v => { setLegacy(v === true); setPage(1); }}/>Include historical findings</label>
        <Button variant="ghost" size="sm" data-testid="button-clear-car-filters" onClick={() => { setFilters(EMPTY_CAR_FILTERS); setPage(1); }}>Clear filters</Button>
        {data && <span className="ml-auto text-sm text-muted-foreground" data-testid="text-car-result-count">{data.total} {data.total === 1 ? "result" : "results"}</span>}
      </div>
    </div>
    {query.isLoading && <Card><CardContent className="animate-pulse py-14 text-center text-muted-foreground">Loading…</CardContent></Card>}
    {query.error && <Card className="border-destructive"><CardContent className="py-8 text-center text-destructive">{errorText(query.error)} <Button size="sm" variant="outline" className="ml-2" onClick={() => void query.refetch()}>Retry</Button></CardContent></Card>}
    {auditAreas.error && <p role="alert" className="text-sm text-destructive">Unable to load Audit Area labels. <button type="button" className="underline" onClick={() => void auditAreas.refetch()}>Retry</button></p>}
    {data && <CarRegisterTable entries={data.items} auditAreaOptions={auditAreas.options} auditAreasLoading={auditAreas.isLoading} page={page} limit={LIMIT} busy={start.isPending || editSession.isPending}
      renderEvidence={entry => <Evidence entry={entry} />} onEdit={open} onDisplay={setDisplaying}
      onOpenResponse={entry => { if (canEditCarEntry(entry)) open(entry); else setDisplaying(entry); }}
      onReview={entry => { if (entry.car) setReviewing(entry.car); }} onLog={setLogging} />}
    {data && data.items.length > 0 && <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground"><span>Page {page} of {Math.max(1, Math.ceil(data.total / LIMIT))}</span>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * LIMIT >= data.total} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    {respond && <CarResponseDialog key={respond.car.id} car={respond.car} {...responseDetails(latestEntry(respond.entry))}
      readOnly={!canEditCarEntry(latestEntry(respond.entry))} open onClose={() => setRespond(undefined)}/>}
    {reviewing && <CarReviewDialog key={reviewing.id} car={reviewing} open onClose={() => setReviewing(undefined)}/>}
    {displaying && <CarResponseDialog key={`display-${displaying.id}`} car={latestEntry(displaying).car}
      {...responseDetails(latestEntry(displaying))} open readOnly onClose={() => setDisplaying(undefined)} />}
    {logging && <CarLogDialog key={logging.id} entry={logging} onClose={() => setLogging(undefined)} />}
  </div>;
}
