import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { findingPriorityActions, type FindingPriorityAction } from "@workspace/field-controls";
import { Download, FileText, Lock, Plus, Upload, X } from "lucide-react";
import {
  customFetch,
  getGetAuditQueryKey,
  getGetAuditFindingNumberingQueryKey,
  useAssignAuditFindingActionTaker,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useCreateAuditFindingItem,
  useListAuditEvidence,
  useListAuditMeetingAttendees,
} from "@workspace/api-client-react";
import type { AuditFindingItemInput, AuditFindingRegisterItem, ChecklistItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLov } from "@/lib/use-lov";
import { checklistFindings } from "./checklist-workbook";
import { useAuditCapabilities } from "@/lib/use-audit-capabilities";
import { canRepairFindingNumber, FindingNumberRepair } from "./finding-number-repair";
import { FindingDate } from "./finding-date";
import { EMPTY_FINDING_FILTERS, filterFindingRows, findingFilterOptions, type FindingFilters } from "./finding-register";
import { FINDING_TAB_COLUMNS, FINDING_TAB_FILTERS, projectFindingTab } from "./finding-tab-projection";

const findingOptions = checklistFindings.filter(value => value !== "Not applicable");
const findingSchema = z.object({
  findingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Finding Date is required"),
  clause: z.string().trim().min(1, "Clause is required"),
  auditArea: z.string().min(1, "Audit Area is required"),
  description: z.string(),
  auditFinding: z.enum(["Minor NC", "Moderate NC", "Major NC", "OFI"], { required_error: "Audit Findings is required" }),
  actionTakerId: z.string().min(1, "Action Taker is required"),
  recommendedPriorityAction: z.enum(findingPriorityActions).or(z.literal("")),
}).superRefine((value, ctx) => {
  if (value.actionTakerId && !value.recommendedPriorityAction) ctx.addIssue({
    code: z.ZodIssueCode.custom, path: ["recommendedPriorityAction"],
    message: "Recommended priority actions is required when an Action Taker is selected.",
  });
});
type FindingForm = z.infer<typeof findingSchema>;
const emptyForm = (): FindingForm => ({
  findingDate: "",
  clause: "", auditArea: "", description: "", auditFinding: undefined as unknown as FindingForm["auditFinding"], actionTakerId: "", recommendedPriorityAction: "",
});
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";
const supportedFile = (file: File) =>
  /\.(xlsx?|docx?|pdf|pptx?|png|jpe?g|gif|webp)$/i.test(file.name) ||
  file.type.startsWith("image/");

const ALL = "__all";
const dash = <span className="text-muted-foreground">—</span>;
const cell = "border-r border-b border-border/60 px-3 py-2 align-top";

export function FindingsGrid({ auditId, items, auditTitle = "", registerRows }: {
  auditId: string; items: ChecklistItem[]; auditTitle?: string; registerRows?: readonly AuditFindingRegisterItem[] | null;
}) {
  const permissions = useAuditCapabilities();
  const readOnly = !permissions.can("findings", "create_edit");
  const { toast } = useToast();
  const qc = useQueryClient();
  const areas = useLov("Audit Area");
  const users = useListAuditMeetingAttendees(auditId);
  const evidence = useListAuditEvidence({ recordType: "audit", recordId: auditId, page: 1, limit: 200 });
  const create = useCreateAuditFindingItem();
  const assign = useAssignAuditFindingActionTaker();
  const intent = useCreateAuditEvidenceIntent();
  const confirm = useConfirmAuditEvidence();
  const form = useForm<FindingForm>({ resolver: zodResolver(findingSchema), defaultValues: emptyForm() });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, { actionTakerId: string; recommendedPriorityAction: FindingPriorityAction | "" }>>({});
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const uploadReference = useRef(crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState<FindingFilters>(EMPTY_FINDING_FILTERS);
  const filesById = new Map((evidence.data?.items ?? []).map(entry => [entry.id, entry]));
  const eligibleUsers = users.data ?? [];
  const userName = (id: string) => {
    const user = eligibleUsers.find(option => option.id === id);
    const recordedName = registerRows?.filter(row => row.auditExecutionId === auditId)
      .flatMap(row => row.actionTakers).find(person => person.id === id)?.name;
    return user?.fullName || recordedName || `Assigned user ID: ${id} (not in active users)`;
  };
  const rows = useMemo(() => projectFindingTab({
    auditId, auditTitle, items, registerRows,
    areaLabel: v => areas.options.find(a => a.value === v)?.label ?? v,
    userName: id => eligibleUsers.find(u => u.id === id)?.fullName ?? null,
  }), [auditId, auditTitle, items, registerRows, areas.options, eligibleUsers]);
  const options = useMemo(() => findingFilterOptions(rows.map(r => r.reg)), [rows]);
  const visible = useMemo(() => {
    const keep = new Set(filterFindingRows(rows.map(r => r.reg), { ...filters, search: "" }).map(r => r.id));
    return rows.filter(r => keep.has(r.reg.id));
  }, [rows, filters]);
  const optionList: Record<(typeof FINDING_TAB_FILTERS)[number][0], { value: string; label: string }[]> = {
    auditTitle: options.auditTitles, projectDepartment: options.projectDepartments, auditArea: options.auditAreas,
    findingType: options.findingTypes, riskLevel: options.riskLevels, auditTeamLead: options.leads, actionTaker: options.actionTakers,
  };
  const activeFilters = FINDING_TAB_FILTERS.filter(([k]) => filters[k]).length;
  const syncAudit = (updated: unknown) => {
    // Mutation responses omit read-only register metadata; keep the previous projection until refetch.
    qc.setQueryData(getGetAuditQueryKey(auditId), (prev: unknown) => {
      const before = prev as { findingRegister?: unknown } | undefined;
      const next = updated as Record<string, unknown>;
      return next && next.findingRegister === undefined && before?.findingRegister !== undefined ? { ...next, findingRegister: before.findingRegister } : next;
    });
    void qc.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
  };
  const reset = () => {
    setOpen(false);
    form.reset(emptyForm());
    setFile(null);
    setFileError("");
    setUploadedId(null);
    uploadReference.current = crypto.randomUUID();
    if (inputRef.current) inputRef.current.value = "";
  };
  const chooseFile = (selected: File | null) => {
    setFile(null);
    setUploadedId(null);
    uploadReference.current = crypto.randomUUID();
    if (!selected) { setFileError(""); return; }
    if (!supportedFile(selected)) {
      setFileError("Choose an image, Excel, Word, PDF or PowerPoint file.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const maxSize = selected.type.startsWith("image/") ? 8 : 25;
    if (!selected.size || selected.size > maxSize * 1024 * 1024) {
      setFileError(`Choose a nonempty file smaller than ${maxSize} MB.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFileError("");
    setFile(selected);
  };
  const save = form.handleSubmit(async values => {
    if (!values.recommendedPriorityAction) {
      form.setError("recommendedPriorityAction", { message: "Select Recommended priority actions." });
      return;
    }
    if (!areas.options.some(area => area.value === values.auditArea)) {
      form.setError("auditArea", { message: "Select an active Audit Area from master data." });
      return;
    }
    if (!eligibleUsers.some(user => user.id === values.actionTakerId)) {
      form.setError("actionTakerId", { message: "Select an active Audit user." });
      return;
    }
    if (fileError) return;
    setSaving(true);
    try {
      let fileId = uploadedId;
      if (file && !fileId) {
        const type = file.type || "application/octet-stream";
        const upload = await intent.mutateAsync({ data: {
          recordType: "audit", recordId: auditId, category: "finding_evidence",
          fileName: file.name, mimeType: type, sizeBytes: file.size, clientReference: uploadReference.current,
        } });
        await customFetch(upload.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": type } });
        await confirm.mutateAsync({ id: upload.id });
        fileId = upload.id;
        setUploadedId(fileId); // A failed record save can be retried without uploading the file twice.
      }
      const payload: AuditFindingItemInput = {
        findingDate: values.findingDate,
        clause: values.clause, auditArea: values.auditArea, description: values.description.trim(),
        auditFinding: values.auditFinding, actionTakerId: values.actionTakerId,
        recommendedPriorityAction: values.recommendedPriorityAction,
        evidenceIds: fileId ? [fileId] : [], clientReference: uploadReference.current,
      };
      const updated = await create.mutateAsync({ id: auditId, data: payload });
      syncAudit(updated);
      void qc.invalidateQueries({ queryKey: getGetAuditFindingNumberingQueryKey() });
      const added = updated.checklist?.find(item => item.source === "finding" && item.clientReference === payload.clientReference);
      if (fileId) void qc.invalidateQueries({ queryKey: ["/api/audit/evidence"] });
      toast({ title: "Finding added", description: added?.findingNumber ? `Finding number ${added.findingNumber} assigned.` : undefined });
      reset();
    } catch (error) {
      toast({ title: "Unable to add finding", description: errorText(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  });
  const assignUser = async (item: ChecklistItem, change: Partial<{ actionTakerId: string; recommendedPriorityAction: FindingPriorityAction }>) => {
    if (assigningId) return;
    const next: { actionTakerId: string; recommendedPriorityAction: FindingPriorityAction | "" } = {
      ...(assignmentDrafts[item.id] ?? {
        actionTakerId: item.actionTakerId ?? "",
        recommendedPriorityAction: item.recommendedPriorityAction ?? "",
      }),
      ...change,
    };
    setAssignmentDrafts(current => ({ ...current, [item.id]: next }));
    if (!next.actionTakerId || !next.recommendedPriorityAction) return;
    const { actionTakerId, recommendedPriorityAction } = next;
    setAssigningId(item.id);
    try {
      const updated = await assign.mutateAsync({ id: auditId, itemId: item.id, data: { actionTakerId, recommendedPriorityAction } });
      syncAudit(updated);
      setAssignmentDrafts(current => { const copy = { ...current }; delete copy[item.id]; return copy; });
      toast({ title: "Finding assignment updated" });
    } catch (error) {
      toast({ title: "Unable to save finding assignment", description: errorText(error), variant: "destructive" });
    } finally {
      setAssigningId(null);
    }
  };
  const download = async (url: string, name: string) => {
    try {
      const blob = await customFetch<Blob>(url, { responseType: "blob" });
      const linkUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = linkUrl;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(linkUrl), 60_000);
    } catch (error) {
      toast({ title: "Unable to download evidence", description: errorText(error), variant: "destructive" });
    }
  };

  return <Card>
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
      <div><CardTitle>Findings</CardTitle><CardDescription>Clause-level findings and the people responsible for action.</CardDescription></div>
      <Button disabled={readOnly} type="button" data-testid="button-add-finding" onClick={() => setOpen(true)}><Plus className="mr-2 size-4" aria-hidden="true"/>Add Finding</Button>
    </CardHeader>
    <CardContent>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" data-testid="finding-filters">
        {FINDING_TAB_FILTERS.map(([key, label]) => <div key={key} className="space-y-1">
          <label id={`finding-filter-label-${key}`} className="block break-words text-[11px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground">{label}</label>
          <Select value={filters[key] || ALL} onValueChange={v => setFilters(f => ({ ...f, [key]: v === ALL ? "" : v }))}>
            <SelectTrigger aria-labelledby={`finding-filter-label-${key}`} data-testid={`filter-finding-${key}`} className="h-9"><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All</SelectItem>{optionList[key].map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>)}
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status" data-testid="text-finding-count">Showing {visible.length} of {rows.length} findings</span>
        <Button type="button" size="sm" variant="ghost" data-testid="button-clear-finding-filters" disabled={!activeFilters} onClick={() => setFilters(EMPTY_FINDING_FILTERS)}><X className="mr-1 size-3.5" aria-hidden="true"/>Clear filters</Button>
      </div>
      <div className="overflow-x-auto rounded-md border" role="region" aria-label="Audit findings spreadsheet" tabIndex={0} data-testid="region-findings-scroll">
        <table className="w-full min-w-[2100px] border-collapse text-sm">
          <thead><tr className="bg-primary text-primary-foreground">
            {FINDING_TAB_COLUMNS.map(column =>
              <th key={column} scope="col" className="h-10 whitespace-nowrap border-r border-primary-foreground/20 px-3 text-left text-xs font-semibold uppercase tracking-wide last:border-r-0">{column}</th>)}
          </tr></thead>
          <tbody>
            {visible.map(row => {
              const r = row.reg;
              const common = <>
                <td data-testid={`text-audit-id-${row.key}`} className={`${cell} whitespace-nowrap font-mono text-xs`}>{r.auditId || dash}</td>
                <td className={`${cell} min-w-48`}>{r.auditTitle || dash}</td>
                <td className={`${cell} min-w-44`}>{r.projectDepartment || dash}</td>
                <td data-testid={`text-clause-${row.key}`} className={`${cell} w-28 font-medium`}>{r.clauseReference || dash}</td>
                <td data-testid={`text-audit-area-${row.key}`} className={`${cell} w-44`}>{r.auditArea || dash}</td>
                <td data-testid={`text-description-${row.key}`} className={`${cell} min-w-64 max-w-sm whitespace-pre-wrap`}>{r.description || dash}</td>
                <td data-testid={`text-finding-${row.key}`} className={`${cell} w-32 font-medium`}>{r.findingType || dash}</td>
                <td data-testid={`text-risk-${row.key}`} className={`${cell} w-28`}>{r.riskLevel || dash}</td>
                <td className={`${cell} min-w-40`}>{r.auditTeamLeadName || dash}</td>
              </>;
              if (row.kind === "legacy") return <tr key={row.key} data-testid={`row-legacy-finding-${row.key}`} className="bg-muted/20">
                <td data-testid={`text-finding-number-${row.key}`} className={`${cell} w-40 whitespace-nowrap font-mono text-xs`}>{r.findingNumber || dash}
                  <span className="mt-1 flex items-center gap-1 font-sans text-[11px] text-muted-foreground"><Lock className="size-3" aria-hidden="true"/>Legacy, read-only</span></td>
                {common}
                <td className={`${cell} min-w-56`}>{r.actionTakers.length ? r.actionTakers.map(a => a.name || a.id).join(", ") : dash}</td>
                <td className={cell}>{dash}</td><td className={cell}>{dash}</td><td className="border-b border-border/60 px-3 py-2 align-top">{dash}</td>
              </tr>;
              const item = row.item;
              return <tr key={item.id} data-testid={`row-finding-${item.id}`} className="hover:bg-muted/30">
              <td data-testid={`text-finding-number-${item.id}`} className={`${cell} w-40 whitespace-nowrap font-mono text-xs`}>{item.findingNumber?.trim() || <span className="text-muted-foreground">Not numbered</span>}
                {!readOnly && canRepairFindingNumber(item.auditFinding, item.findingNumber) && <FindingNumberRepair auditId={auditId} itemId={item.id}/>}
              </td>
              {common}
              <td className={`${cell} w-64`}>
                <Select value={assignmentDrafts[item.id]?.actionTakerId || item.actionTakerId || ""} onValueChange={value => void assignUser(item, { actionTakerId: value })} disabled={readOnly || users.isLoading || !!users.error || !!assigningId || !eligibleUsers.length}>
                  <SelectTrigger data-testid={`select-action-taker-${item.id}`} aria-label={`Action Taker for clause ${item.clause || item.id}`} className="h-9 w-full text-left"><SelectValue placeholder={users.isLoading ? "Loading users…" : "Assign a user"}>{(assignmentDrafts[item.id]?.actionTakerId || item.actionTakerId) ? userName(assignmentDrafts[item.id]?.actionTakerId || item.actionTakerId!) : undefined}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {item.actionTakerId && !eligibleUsers.some(user => user.id === item.actionTakerId) &&
                      <SelectItem value={item.actionTakerId} disabled>{userName(item.actionTakerId)}</SelectItem>}
                    {eligibleUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                {assigningId === item.id && <span role="status" className="mt-1 block text-xs text-muted-foreground">Saving assignment…</span>}
              </td>
              <td className={`${cell} min-w-44`} data-testid={`finding-date-${item.id}`}><FindingDate auditId={auditId} itemId={item.id} value={item.findingDate} readOnly={readOnly}/></td>
              <td className={`${cell} w-48`}>
                {item.evidenceIds?.length ? item.evidenceIds.map(id => {
                  const entry = filesById.get(id);
                  return entry?.storageUrl
                    ? <button key={id} type="button" data-testid={`button-download-evidence-${item.id}-${id}`} className="mb-1 flex items-start gap-1.5 text-left text-primary underline-offset-2 hover:underline focus-visible:underline" onClick={() => void download(entry.storageUrl!, entry.fileName)}><Download className="mt-0.5 size-3.5 shrink-0" aria-hidden="true"/><span className="break-all">{entry.fileName}</span></button>
                    : <span key={id} className="mb-1 block text-muted-foreground" data-testid={`text-unavailable-evidence-${item.id}-${id}`}>File unavailable ({id})</span>;
                }) : dash}
              </td>
              <td className="min-w-64 border-b border-border/60 px-3 py-2 align-top">
                <Select value={assignmentDrafts[item.id]?.recommendedPriorityAction || item.recommendedPriorityAction || ""}
                  onValueChange={value => void assignUser(item, { recommendedPriorityAction: value as FindingPriorityAction })}
                  disabled={readOnly || !!assigningId || !(assignmentDrafts[item.id]?.actionTakerId || item.actionTakerId) || users.isLoading || !!users.error}>
                  <SelectTrigger data-testid={`select-priority-action-${item.id}`} aria-label={`Recommended priority actions for clause ${item.clause || item.id}`} className="h-9 w-full text-left"><SelectValue placeholder="Select priority action"/></SelectTrigger>
                  <SelectContent>{findingPriorityActions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
                {assignmentDrafts[item.id] && !assignmentDrafts[item.id].recommendedPriorityAction && <p role="alert" className="mt-1 text-xs text-destructive">Select a priority action to save this assignment.</p>}
                {assignmentDrafts[item.id]?.recommendedPriorityAction && assigningId !== item.id && <p className="mt-1 text-xs text-muted-foreground">Unsaved changes. <button type="button" className="underline" onClick={() => void assignUser(item, {})}>Retry save</button></p>}
              </td>
            </tr>;
            })}
            {!visible.length && <tr><td colSpan={FINDING_TAB_COLUMNS.length} className="py-12 text-center">
              <FileText className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true"/>
              {rows.length ? <>
                <p data-testid="text-no-matching-findings" className="font-medium">No findings match these filters</p>
                <p className="mt-1 text-sm text-muted-foreground">Clear one or more filters to see more findings.</p>
              </> : <>
                <p data-testid="text-no-findings" className="font-medium">No findings recorded yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add a finding here, or record one while completing the checklist.</p>
              </>}
            </td></tr>}
          </tbody>
        </table>
      </div>
      {(users.error || areas.error || evidence.error) && <div role="alert" data-testid="status-findings-error" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
        Some finding details could not be loaded.
        <Button type="button" size="sm" variant="outline" data-testid="button-retry-finding-data" onClick={() => { if (users.error) void users.refetch(); if (areas.error) void areas.refetch(); if (evidence.error) void evidence.refetch(); }}>Retry</Button>
      </div>}
      {(users.isLoading || evidence.isLoading || areas.isLoading) && <p role="status" className="mt-2 animate-pulse text-xs text-muted-foreground">Loading finding details…</p>}
    </CardContent>
    <Dialog open={open} onOpenChange={value => { if (!value && !saving) reset(); else if (value) setOpen(true); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Add Finding</DialogTitle><DialogDescription>Record a finding against a clause. Fields marked * are required. CAR due dates use Finding Date: Major NC +2 days, Minor NC +3 days, OFI +4 days. Finding numbering still uses the linked Schedule From Date year.</DialogDescription></DialogHeader>
        <Form {...form}><form onSubmit={event => void save(event)} className="space-y-4">
          <FormField control={form.control} name="findingDate" render={({ field }) => <FormItem><FormLabel>Finding Date *</FormLabel><FormControl><Input {...field} type="date" required data-testid="input-finding-date"/></FormControl><FormMessage/></FormItem>}/>
          <FormField control={form.control} name="clause" render={({ field }) => <FormItem><FormLabel>Clause *</FormLabel><FormControl><Input {...field} data-testid="input-finding-clause" placeholder="Enter audit clause" autoFocus/></FormControl><FormMessage/></FormItem>}/>
          <FormField control={form.control} name="auditArea" render={({ field, fieldState }) => <FormItem><FormLabel>Audit Area *</FormLabel><Select value={field.value || undefined} onValueChange={field.onChange} disabled={areas.isLoading || !!areas.error || !areas.options.length}><FormControl><SelectTrigger data-testid="select-finding-audit-area" aria-invalid={!!fieldState.error}><SelectValue placeholder="Select Audit Area"/></SelectTrigger></FormControl><SelectContent>{areas.options.map(area => <SelectItem key={area.value} value={area.value}>{area.label}</SelectItem>)}</SelectContent></Select><FormMessage/>{areas.error && <p className="text-sm text-destructive">Unable to load Audit Areas. <button type="button" data-testid="button-retry-audit-areas" className="underline" onClick={() => void areas.refetch()}>Retry</button></p>}{!areas.isLoading && !areas.error && !areas.options.length && <p className="text-sm text-muted-foreground">No active Audit Areas are configured.</p>}</FormItem>}/>
          <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} data-testid="input-finding-description" rows={3} placeholder="Describe what was observed"/></FormControl><FormMessage/></FormItem>}/>
          <FormField control={form.control} name="auditFinding" render={({ field, fieldState }) => <FormItem><FormLabel>Audit Findings *</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger data-testid="select-finding-classification" aria-invalid={!!fieldState.error}><SelectValue placeholder="Select a finding"/></SelectTrigger></FormControl><SelectContent>{findingOptions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>}/>
          <FormField control={form.control} name="actionTakerId" render={({ field, fieldState }) => <FormItem><FormLabel>Action Taker *</FormLabel><Select value={field.value || undefined} onValueChange={field.onChange} disabled={users.isLoading || !!users.error || !eligibleUsers.length}><FormControl><SelectTrigger data-testid="select-finding-action-taker" aria-invalid={!!fieldState.error}><SelectValue placeholder={users.isLoading ? "Loading Audit users…" : "Select an Audit user"}/></SelectTrigger></FormControl><SelectContent>{eligibleUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select><FormMessage/>{users.error && <p className="text-sm text-destructive">Unable to load Audit users. <button type="button" data-testid="button-retry-audit-users" className="underline" onClick={() => void users.refetch()}>Retry</button></p>}{!users.isLoading && !users.error && !eligibleUsers.length && <p className="text-sm text-muted-foreground">No eligible Audit users are available.</p>}</FormItem>}/>
          <FormField control={form.control} name="recommendedPriorityAction" render={({ field, fieldState }) => <FormItem>
            <FormLabel>Recommended priority actions{form.watch("actionTakerId") ? " *" : ""}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={!form.watch("actionTakerId") || saving}>
              <FormControl><SelectTrigger data-testid="select-finding-priority-action" aria-invalid={!!fieldState.error}><SelectValue placeholder="Select priority action"/></SelectTrigger></FormControl>
              <SelectContent>{findingPriorityActions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select><FormMessage/>
          </FormItem>}/>
          <div className="space-y-2"><label htmlFor="finding-evidence" className="text-sm font-medium">Evidence (optional)</label><Input ref={inputRef} id="finding-evidence" data-testid="input-finding-evidence" type="file" accept="image/*,.xlsx,.xls,.doc,.docx,.pdf,.ppt,.pptx" onChange={event => chooseFile(event.target.files?.[0] ?? null)} disabled={saving}/>{file && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Upload className="size-3.5" aria-hidden="true"/>{file.name}</p>}{fileError && <p role="alert" data-testid="status-finding-file-error" className="text-sm text-destructive">{fileError}</p>}</div>
          <DialogFooter><Button type="button" variant="outline" data-testid="button-cancel-finding" disabled={saving} onClick={reset}>Cancel</Button><Button type="submit" data-testid="button-save-finding" disabled={saving || areas.isLoading || !!areas.error || !areas.options.length || users.isLoading || !!users.error || !eligibleUsers.length || !!fileError}>{saving ? "Saving…" : "Save Finding"}</Button></DialogFooter>
        </form></Form>
      </DialogContent>
    </Dialog>
  </Card>;
}