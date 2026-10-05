import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
   customFetch, getGetCorrectiveActionReportQueryKey, getListCarActivityQueryKey, getListCarRegisterQueryKey, useListAuditEvidence, useListCarRegister,
  useReviewCorrectiveActionReport, useStartFindingCar, useUpdateCorrectiveActionReport,
  useOpenCarEditSession,
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
import { CarRegisterTable } from "./car-register-table";
import { CarDisplayDialog, CarLogDialog } from "./car-register-details";
import { useFieldControls } from "@/lib/field-controls";
import { useFieldAccess } from "@/lib/use-field-access";

const LIMIT = 10;
const EDITABLE = ["Open", "Draft", "Rejected", "Returned for query", "Returned for rework"];
const STATUSES = ["Open", "Draft", "Submitted", "Returned for query", "Returned for rework", "Accepted", "Rejected", "Extension Requested", "Closed"];
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

export function CarResponseDialog({ car, open, onClose, readOnly = false }: { car: CorrectiveActionReport; open: boolean; onClose: () => void; readOnly?: boolean }) {
  const { toast } = useToast();
  const refresh = useCarRefresh(car.id);
  const update = useUpdateCorrectiveActionReport();
  const controls = useFieldControls("audit", "car");
  const access = useFieldAccess("audit");
  const viewOnly = readOnly || car.canRespond !== true;
  const [f, setF] = useState({ rootCause: car.rootCause ?? "", correction: car.correction ?? "", correctiveAction: car.correctiveAction ?? "" });
  const [err, setErr] = useState("");
  const busy = update.isPending;
  const valid = !!f.rootCause.trim() && !!f.correction.trim() && !!f.correctiveAction.trim();
  const clean = { rootCause: f.rootCause.trim(), correction: f.correction.trim(), correctiveAction: f.correctiveAction.trim() };
  const run = async (andSubmit: boolean) => {
    if (viewOnly) return;
    setErr("");
    if (andSubmit && !valid) { setErr("Root cause, correction and corrective action are all required to submit."); return; }
    const body = { ...car, ...clean };
    const missing = controls.mandatoryFieldKeys().filter(key => {
      const value = (body as unknown as Record<string, unknown>)[key];
      return value == null || (typeof value === "string" && !value.trim());
    });
    if (missing.length) { setErr(`Complete required fields: ${missing.join(", ")}.`); return; }
    try {
      await update.mutateAsync({ id: car.id, data: { ...clean, saveAndSubmit: andSubmit } });
      refresh();
      toast({ title: andSubmit ? "CAR submitted" : "Response saved" });
      onClose();
    } catch (e) { setErr(errorText(e)); refresh(); }
  };
  const field = (key: keyof typeof f, label: string) => <div className="space-y-1"><Label htmlFor={`car-${key}`}>{label}{!viewOnly && " *"}</Label>
    <Textarea id={`car-${key}`} data-testid={`input-car-${key}`} rows={3} value={f[key]} readOnly={viewOnly} disabled={!viewOnly && (busy || controls.fieldProps(key).disabled || access.readOnly("car", key))} onChange={e => { if (!viewOnly) setF(v => ({ ...v, [key]: e.target.value })); }}/></div>;
  return <Dialog open={open} onOpenChange={v => { if (!v && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
       <DialogHeader><DialogTitle>CAR Response</DialogTitle><DialogDescription>{viewOnly ? "Read-only CAR response. Only the assigned Action Taker can edit this response." : "Describe the cause and the actions taken for this finding."}</DialogDescription></DialogHeader>
      <CarReviewNotes car={car}/>
      {field("rootCause", "Root cause")}{field("correction", "Correction")}{field("correctiveAction", "Corrective action")}
      {err && <p role="alert" data-testid="status-car-error" className="text-sm text-destructive">{err}</p>}
       <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{viewOnly ? "Close" : "Cancel"}</Button>
         {!viewOnly && <><Button variant="outline" data-testid="button-save-car" disabled={busy} onClick={() => void run(false)}>Save response</Button>
         <Button data-testid="button-save-submit-car" disabled={busy} onClick={() => void run(true)}>{busy ? "Working…" : "Save & submit"}</Button></>}</DialogFooter>
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
      onSuccess: () => { refresh(); toast({ title: decision === "accept" ? "CAR closed" : decision === "query" ? "Query sent" : "Sent for rework" }); onClose(); },
      onError: e => { setErr(errorText(e)); refresh(); },
    });
  };
  return <Dialog open={open} onOpenChange={v => { if (!v && !review.isPending) onClose(); }}>
    <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Review CAR response</DialogTitle><DialogDescription>Accepting closes the CAR immediately.</DialogDescription></DialogHeader>
      <div className="space-y-1 text-sm"><p><b>Root cause:</b> {car.rootCause}</p><p><b>Correction:</b> {car.correction}</p><p><b>Corrective action:</b> {car.correctiveAction}</p></div>
      <Select value={decision} onValueChange={v => { setDecision(v as typeof decision); setErr(""); }}>
        <SelectTrigger data-testid="select-review-decision"><SelectValue/></SelectTrigger>
        <SelectContent><SelectItem value="accept">Accept and close</SelectItem><SelectItem value="query">Query</SelectItem><SelectItem value="rework">Rework</SelectItem></SelectContent></Select>
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
  const refresh = useCarRefresh();
  const [page, setPage] = useState(1);
  const [projectId, setProjectId] = useState("all");
  const [scheduleId, setScheduleId] = useState("all");
  const [auditTitle, setAuditTitle] = useState("all");
  const [auditType, setAuditType] = useState("all");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [legacy, setLegacy] = useState(false);
  const [respond, setRespond] = useState<CorrectiveActionReport>();
  const [reviewing, setReviewing] = useState<CorrectiveActionReport>();
  const [displaying, setDisplaying] = useState<CarRegisterEntry>();
  const [logging, setLogging] = useState<CarRegisterEntry>();
  const params = { page, limit: LIMIT, includeLegacy: legacy, ...(projectId !== "all" && { projectId }), ...(scheduleId !== "all" && { scheduleId }), ...(auditTitle !== "all" && { auditTitle }), ...(auditType !== "all" && { auditType }), ...(department !== "all" && { department }), ...(status !== "all" && { status }) };
  const query = useListCarRegister(params, { query: { queryKey: getListCarRegisterQueryKey(params), refetchInterval: 20_000, staleTime: 10_000, refetchOnWindowFocus: true } });
  const start = useStartFindingCar();
  const editSession = useOpenCarEditSession();
  const data = query.data;
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const open = (e: CarRegisterEntry) => {
    if (!e.canRespond) return;
    if (e.car) {
      editSession.mutate({ id: e.car.id }, {
        onSuccess: car => setRespond(car),
        onError: err => toast({ title: "Unable to open CAR", description: errorText(err), variant: "destructive" }),
      });
      return;
    }
    start.mutate({ data: { auditId: e.auditId, itemId: e.itemId } }, {
      onSuccess: car => { refresh(); setRespond(car as CorrectiveActionReport); },
      onError: err => toast({ title: "Unable to start CAR", description: errorText(err), variant: "destructive" }),
    });
  };
  const opts = (label: string, list?: { id: string; name: string }[]) => [<SelectItem key="all" value="all">{label}</SelectItem>, ...(list ?? []).map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)];
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">Corrective Action Register</h1><p className="mt-1 text-sm text-muted-foreground">Audit findings and the corrective action responses raised against them</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <Select value={scheduleId} onValueChange={reset(setScheduleId)}><SelectTrigger aria-label="Audit Schedule" className="w-52" data-testid="select-car-schedule"><SelectValue/></SelectTrigger><SelectContent>{opts("All audit schedules", data?.schedules)}</SelectContent></Select>
      <Select value={auditTitle} onValueChange={reset(setAuditTitle)}><SelectTrigger aria-label="Audit Title" className="w-52" data-testid="select-car-audit-title"><SelectValue/></SelectTrigger><SelectContent>{opts("All audit titles", data?.auditTitles)}</SelectContent></Select>
      <Select value={auditType} onValueChange={v => { setAuditType(v); setProjectId("all"); setDepartment("all"); setPage(1); }}><SelectTrigger aria-label="Audit Type" className="w-64" data-testid="select-car-audit-type"><SelectValue/></SelectTrigger><SelectContent>{opts("All audit types", data?.auditTypes)}</SelectContent></Select>
      {auditType !== "Quality Internal Process Audit" && <Select value={projectId} onValueChange={reset(setProjectId)}><SelectTrigger aria-label="Project" className="w-52" data-testid="select-car-project"><SelectValue/></SelectTrigger><SelectContent>{opts("All projects", data?.projects)}</SelectContent></Select>}
      {(auditType === "all" || auditType === "Quality Internal Process Audit") && <Select value={department} onValueChange={reset(setDepartment)}><SelectTrigger aria-label="Department" className="w-52" data-testid="select-car-department"><SelectValue/></SelectTrigger><SelectContent>{opts("All departments", data?.departments)}</SelectContent></Select>}
      <Select value={status} onValueChange={reset(setStatus)}><SelectTrigger aria-label="Status" className="w-44" data-testid="select-car-status"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      <Button variant="ghost" size="sm" data-testid="button-clear-car-filters" onClick={() => { setScheduleId("all"); setAuditTitle("all"); setAuditType("all"); setProjectId("all"); setDepartment("all"); setStatus("all"); setPage(1); }}>Clear filters</Button>
      <label className="flex items-center gap-2 text-sm"><Checkbox data-testid="checkbox-include-legacy" checked={legacy} onCheckedChange={v => { setLegacy(v === true); setPage(1); }}/>Include historical findings</label>
    </div>
    {query.isLoading && <Card><CardContent className="animate-pulse py-14 text-center text-muted-foreground">Loading…</CardContent></Card>}
    {query.error && <Card className="border-destructive"><CardContent className="py-8 text-center text-destructive">{errorText(query.error)} <Button size="sm" variant="outline" className="ml-2" onClick={() => void query.refetch()}>Retry</Button></CardContent></Card>}
    {data && <CarRegisterTable entries={data.items} page={page} limit={LIMIT} busy={start.isPending || editSession.isPending}
      renderEvidence={entry => <Evidence entry={entry} />} onEdit={open} onDisplay={setDisplaying}
      onReview={entry => { if (entry.car) setReviewing(entry.car); }} onLog={setLogging} />}
    {data && data.items.length > 0 && <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground"><span>{data.total} total</span>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * LIMIT >= data.total} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    {respond && <CarResponseDialog key={respond.id} car={respond} open onClose={() => setRespond(undefined)}/>}
    {reviewing && <CarReviewDialog key={reviewing.id} car={reviewing} open onClose={() => setReviewing(undefined)}/>}
    {displaying && (displaying.car
      ? <CarResponseDialog key={`display-${displaying.car.id}`} car={displaying.car} open readOnly onClose={() => setDisplaying(undefined)} />
      : <CarDisplayDialog entry={displaying} onClose={() => setDisplaying(undefined)} />)}
    {logging && <CarLogDialog key={logging.id} entry={logging} onClose={() => setLogging(undefined)} />}
  </div>;
}
