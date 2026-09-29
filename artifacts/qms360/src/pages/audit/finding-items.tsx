import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Download, FileText, Plus, Upload } from "lucide-react";
import {
  customFetch,
  getGetAuditQueryKey,
  useAssignAuditFindingActionTaker,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useCreateAuditFindingItem,
  useListAuditEvidence,
  useListAuditMeetingAttendees,
} from "@workspace/api-client-react";
import type { AuditFindingItemInput, ChecklistItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLov } from "@/lib/use-lov";
import { checklistFindings } from "./checklist-workbook";

const findingOptions = checklistFindings.filter(value => value !== "Not applicable");
const findingSchema = z.object({
  clause: z.string().trim().min(1, "Clause is required"),
  auditArea: z.string().min(1, "Audit Area is required"),
  description: z.string(),
  auditFinding: z.enum(["Minor NC", "Moderate NC", "Major NC", "OFI"], { required_error: "Audit Findings is required" }),
  actionTakerId: z.string().min(1, "Action Taker is required"),
});
type FindingForm = z.infer<typeof findingSchema>;
const emptyForm = (): FindingForm => ({
  clause: "", auditArea: "", description: "", auditFinding: undefined as unknown as FindingForm["auditFinding"], actionTakerId: "",
});
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";
const supportedFile = (file: File) =>
  /\.(xlsx?|docx?|pdf|pptx?|png|jpe?g|gif|webp)$/i.test(file.name) ||
  file.type.startsWith("image/");

export function FindingsGrid({ auditId, items }: { auditId: string; items: ChecklistItem[] }) {
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
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const uploadReference = useRef(crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);

  const findings = items.filter(item => {
    const classification = item.auditFinding || item.result;
    return !!classification && classification.trim().toLowerCase() !== "not applicable";
  });
  const filesById = new Map((evidence.data?.items ?? []).map(entry => [entry.id, entry]));
  const eligibleUsers = users.data ?? [];
  const userName = (id: string) => {
    const user = eligibleUsers.find(option => option.id === id);
    return user ? user.fullName : `Assigned user ID: ${id} (not in active users)`;
  };
  const syncAudit = (updated: unknown) => {
    qc.setQueryData(getGetAuditQueryKey(auditId), updated);
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
          recordType: "audit", recordId: auditId, category: type.startsWith("image/") ? "image" : "document",
          fileName: file.name, mimeType: type, sizeBytes: file.size, clientReference: uploadReference.current,
        } });
        await customFetch(upload.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": type } });
        await confirm.mutateAsync({ id: upload.id });
        fileId = upload.id;
        setUploadedId(fileId); // A failed record save can be retried without uploading the file twice.
      }
      const payload: AuditFindingItemInput = {
        clause: values.clause, auditArea: values.auditArea, description: values.description.trim(),
        auditFinding: values.auditFinding, actionTakerId: values.actionTakerId,
        evidenceIds: fileId ? [fileId] : [], clientReference: uploadReference.current,
      };
      const updated = await create.mutateAsync({ id: auditId, data: payload });
      syncAudit(updated);
      if (fileId) void qc.invalidateQueries({ queryKey: ["/api/audit/evidence"] });
      toast({ title: "Finding added" });
      reset();
    } catch (error) {
      toast({ title: "Unable to add finding", description: errorText(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  });
  const assignUser = async (item: ChecklistItem, actionTakerId: string) => {
    if (item.actionTakerId === actionTakerId || assigningId) return;
    setAssigningId(item.id);
    try {
      const updated = await assign.mutateAsync({ id: auditId, itemId: item.id, data: { actionTakerId } });
      syncAudit(updated);
      toast({ title: "Action Taker updated" });
    } catch (error) {
      toast({ title: "Unable to assign Action Taker", description: errorText(error), variant: "destructive" });
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
      <Button type="button" data-testid="button-add-finding" onClick={() => setOpen(true)}><Plus className="mr-2 size-4" aria-hidden="true"/>Add Finding</Button>
    </CardHeader>
    <CardContent>
      <div className="overflow-x-auto rounded-md border" role="region" aria-label="Audit findings spreadsheet" tabIndex={0}>
        <Table className="min-w-[1080px] border-collapse text-sm">
          <TableHeader><TableRow className="bg-muted/50">
            {["Clause", "Audit Area", "Description", "Audit Findings", "Evidence", "Action Taker"].map(column =>
              <TableHead key={column} scope="col" className="h-10 border-r border-b border-border/60 px-3 text-xs font-semibold uppercase tracking-wide last:border-r-0">{column}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {findings.map(item => <TableRow key={item.id} data-testid={`row-finding-${item.id}`} className="hover:bg-muted/30">
              <TableCell data-testid={`text-clause-${item.id}`} className="w-28 border-r border-b border-border/60 px-3 align-top font-medium">{item.clause || "—"}</TableCell>
              <TableCell data-testid={`text-audit-area-${item.id}`} className="w-44 border-r border-b border-border/60 px-3 align-top">{areas.options.find(area => area.value === item.auditArea)?.label ?? item.auditArea ?? "—"}</TableCell>
              <TableCell data-testid={`text-description-${item.id}`} className="min-w-64 max-w-sm whitespace-pre-wrap border-r border-b border-border/60 px-3 align-top">{item.description || item.notes || "—"}</TableCell>
              <TableCell data-testid={`text-finding-${item.id}`} className="w-36 border-r border-b border-border/60 px-3 align-top font-medium">{item.auditFinding || item.result}</TableCell>
              <TableCell className="w-48 border-r border-b border-border/60 px-3 align-top">
                {item.evidenceIds?.length ? item.evidenceIds.map(id => {
                  const entry = filesById.get(id);
                  return entry?.storageUrl
                    ? <button key={id} type="button" data-testid={`button-download-evidence-${item.id}-${id}`} className="mb-1 flex items-start gap-1.5 text-left text-primary underline-offset-2 hover:underline focus-visible:underline" onClick={() => void download(entry.storageUrl!, entry.fileName)}><Download className="mt-0.5 size-3.5 shrink-0" aria-hidden="true"/><span className="break-all">{entry.fileName}</span></button>
                    : <span key={id} className="mb-1 block text-muted-foreground" data-testid={`text-unavailable-evidence-${item.id}-${id}`}>File unavailable ({id})</span>;
                }) : "—"}
              </TableCell>
              <TableCell className="w-64 border-b border-border/60 px-3 align-top">
                <Select value={item.actionTakerId || undefined} onValueChange={value => void assignUser(item, value)} disabled={users.isLoading || !!users.error || !!assigningId || !eligibleUsers.length}>
                  <SelectTrigger data-testid={`select-action-taker-${item.id}`} aria-label={`Action Taker for clause ${item.clause || item.id}`} className="h-9 w-full text-left"><SelectValue placeholder={users.isLoading ? "Loading users…" : "Assign a user"}>{item.actionTakerId ? userName(item.actionTakerId) : undefined}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {item.actionTakerId && !eligibleUsers.some(user => user.id === item.actionTakerId) &&
                      <SelectItem value={item.actionTakerId} disabled>{userName(item.actionTakerId)}</SelectItem>}
                    {eligibleUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                {assigningId === item.id && <span role="status" className="mt-1 block text-xs text-muted-foreground">Saving assignment…</span>}
              </TableCell>
            </TableRow>)}
            {!findings.length && <TableRow><TableCell colSpan={6} className="py-12 text-center">
              <FileText className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true"/>
              <p data-testid="text-no-findings" className="font-medium">No findings recorded yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Add a finding here, or record one while completing the checklist.</p>
            </TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {(users.error || areas.error || evidence.error) && <div role="alert" data-testid="status-findings-error" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
        Some finding details could not be loaded.
        <Button type="button" size="sm" variant="outline" data-testid="button-retry-finding-data" onClick={() => { if (users.error) void users.refetch(); if (areas.error) void areas.refetch(); if (evidence.error) void evidence.refetch(); }}>Retry</Button>
      </div>}
      {(users.isLoading || evidence.isLoading || areas.isLoading) && <p role="status" className="mt-2 animate-pulse text-xs text-muted-foreground">Loading finding details…</p>}
    </CardContent>
    <Dialog open={open} onOpenChange={value => { if (!value && !saving) reset(); else if (value) setOpen(true); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Add Finding</DialogTitle><DialogDescription>Record a finding against a clause. Fields marked * are required.</DialogDescription></DialogHeader>
        <Form {...form}><form onSubmit={event => void save(event)} className="space-y-4">
          <FormField control={form.control} name="clause" render={({ field }) => <FormItem><FormLabel>Clause *</FormLabel><FormControl><Input {...field} data-testid="input-finding-clause" placeholder="Enter audit clause" autoFocus/></FormControl><FormMessage/></FormItem>}/>
          <Controller control={form.control} name="auditArea" render={({ field, fieldState }) => <FormItem><FormLabel>Audit Area *</FormLabel><Select value={field.value || undefined} onValueChange={field.onChange} disabled={areas.isLoading || !!areas.error || !areas.options.length}><FormControl><SelectTrigger data-testid="select-finding-audit-area" aria-invalid={!!fieldState.error}><SelectValue placeholder="Select Audit Area"/></SelectTrigger></FormControl><SelectContent>{areas.options.map(area => <SelectItem key={area.value} value={area.value}>{area.label}</SelectItem>)}</SelectContent></Select><FormMessage/>{areas.error && <p className="text-sm text-destructive">Unable to load Audit Areas. <button type="button" data-testid="button-retry-audit-areas" className="underline" onClick={() => void areas.refetch()}>Retry</button></p>}{!areas.isLoading && !areas.error && !areas.options.length && <p className="text-sm text-muted-foreground">No active Audit Areas are configured.</p>}</FormItem>}/>
          <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} data-testid="input-finding-description" rows={3} placeholder="Describe what was observed"/></FormControl><FormMessage/></FormItem>}/>
          <Controller control={form.control} name="auditFinding" render={({ field, fieldState }) => <FormItem><FormLabel>Audit Findings *</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger data-testid="select-finding-classification" aria-invalid={!!fieldState.error}><SelectValue placeholder="Select a finding"/></SelectTrigger></FormControl><SelectContent>{findingOptions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>}/>
          <Controller control={form.control} name="actionTakerId" render={({ field, fieldState }) => <FormItem><FormLabel>Action Taker *</FormLabel><Select value={field.value || undefined} onValueChange={field.onChange} disabled={users.isLoading || !!users.error || !eligibleUsers.length}><FormControl><SelectTrigger data-testid="select-finding-action-taker" aria-invalid={!!fieldState.error}><SelectValue placeholder={users.isLoading ? "Loading Audit users…" : "Select an Audit user"}/></SelectTrigger></FormControl><SelectContent>{eligibleUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select><FormMessage/>{users.error && <p className="text-sm text-destructive">Unable to load Audit users. <button type="button" data-testid="button-retry-audit-users" className="underline" onClick={() => void users.refetch()}>Retry</button></p>}{!users.isLoading && !users.error && !eligibleUsers.length && <p className="text-sm text-muted-foreground">No eligible Audit users are available.</p>}</FormItem>}/>
          <div className="space-y-2"><label htmlFor="finding-evidence" className="text-sm font-medium">Evidence (optional)</label><Input ref={inputRef} id="finding-evidence" data-testid="input-finding-evidence" type="file" accept="image/*,.xlsx,.xls,.doc,.docx,.pdf,.ppt,.pptx" onChange={event => chooseFile(event.target.files?.[0] ?? null)} disabled={saving}/>{file && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Upload className="size-3.5" aria-hidden="true"/>{file.name}</p>}{fileError && <p role="alert" data-testid="status-finding-file-error" className="text-sm text-destructive">{fileError}</p>}</div>
          <DialogFooter><Button type="button" variant="outline" data-testid="button-cancel-finding" disabled={saving} onClick={reset}>Cancel</Button><Button type="submit" data-testid="button-save-finding" disabled={saving || areas.isLoading || !!areas.error || !areas.options.length || users.isLoading || !!users.error || !eligibleUsers.length || !!fileError}>{saving ? "Saving…" : "Save Finding"}</Button></DialogFooter>
        </form></Form>
      </DialogContent>
    </Dialog>
  </Card>;
}