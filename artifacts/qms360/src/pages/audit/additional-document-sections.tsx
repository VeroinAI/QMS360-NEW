import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import {
  customFetch,
  getGetAuditQueryKey,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useReplaceAuditOrganizationChart,
  useUpdateAuditDocumentStatus,
} from "@workspace/api-client-react";
import type { Audit, AuditAdditionalDocuments, AuditDocumentStatusRow } from "@workspace/api-client-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const designLabels = [
  ["status-a", "Status A"], ["status-b", "Status B"], ["status-c", "Status C"],
  ["status-d", "Status D"], ["under-review", "Under Review(U/R)"], ["cancelled", "Cancelled"],
] as const;
const procurementLabels = [
  ["total-items-tracked", "Total items tracked"], ["purchase-order-issued", "Purchase order issued"],
  ["in-manufacturing", "In manufacturing"], ["fat-completed", "FAT completed"],
  ["fat-pending", "FAT pending / report under approval"], ["shipped", "Shipped / in transit"],
  ["received-at-site", "Received at site"], ["past-planned-receipt-date", "Past planned receipt date"],
] as const;
type StatusSection = "design-status" | "procurement-status";
type DraftRow = { id: string; label: string; value: string; remarks: string };
const allowedExtensions = /\.(pdf|docx?|xlsx?|pptx?)$/i;
const mimeByExtension: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";

function OrganizationChart({ auditId, documents, onUpdated }: {
  auditId: string; documents?: AuditAdditionalDocuments; onUpdated: (audit: Audit) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const intent = useCreateAuditEvidenceIntent();
  const confirm = useConfirmAuditEvidence();
  const replace = useReplaceAuditOrganizationChart();
  const input = useRef<HTMLInputElement>(null);
  const reference = useRef(crypto.randomUUID());
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const clearPending = () => {
    setPendingFile(null);
    setUploadedId(null);
    setConfirmOpen(false);
    reference.current = crypto.randomUUID();
    if (input.current) input.current.value = "";
  };
  const saveFile = async (file: File, expectedPreviousId: string | null, existingUploadId = uploadedId) => {
    setBusy(true);
    try {
      let fileId = existingUploadId;
      if (!fileId) {
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = file.type && file.type !== "application/octet-stream"
          ? file.type : mimeByExtension[extension] || "application/octet-stream";
        const upload = await intent.mutateAsync({ data: {
          recordType: "audit", recordId: auditId, category: "organization_chart",
          fileName: file.name, mimeType, sizeBytes: file.size, clientReference: reference.current,
        } });
        await customFetch(upload.uploadUrl, {
          method: "PUT", body: file, headers: { "Content-Type": mimeType },
        });
        await confirm.mutateAsync({ id: upload.id });
        fileId = upload.id;
        setUploadedId(fileId);
      }
      const updated = await replace.mutateAsync({
        id: auditId, data: { evidenceId: fileId, previousId: expectedPreviousId },
      });
      onUpdated(updated);
      void qc.invalidateQueries({ queryKey: ["/api/audit/evidence"] });
      toast({ title: expectedPreviousId ? "Organization Chart replaced" : "Organization Chart uploaded" });
      clearPending();
    } catch (error) {
      toast({ title: "Unable to upload Organization Chart", description: errorText(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const chooseFile = (file: File | null) => {
    if (!file) return;
    if (!allowedExtensions.test(file.name) || !file.size || file.size > 25 * 1024 * 1024) {
      toast({ title: "Choose a PDF, Word, Excel or PowerPoint file under 25 MB", variant: "destructive" });
      if (input.current) input.current.value = "";
      return;
    }
    reference.current = crypto.randomUUID();
    setUploadedId(null);
    setPendingFile(file);
    const current = documents?.organizationChartId ?? null;
    setPreviousId(current);
    if (current) setConfirmOpen(true);
    else void saveFile(file, null, null);
  };
  const download = async () => {
    if (!documents?.organizationChartId) return;
    try {
      const blob = await customFetch<Blob>(`/api/files/${documents.organizationChartId}`, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = documents.organizationChartFileName ?? "organization-chart";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Unable to download Organization Chart", description: errorText(error), variant: "destructive" });
    }
  };

  return <>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <Upload className="mr-2 size-4" aria-hidden="true"/>{busy ? "Uploading…" : documents?.organizationChartId ? "Replace file" : "Upload file"}
      </Button>
      <input ref={input} type="file" className="sr-only" tabIndex={-1} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" aria-label="Choose Organization Chart file" onChange={event => chooseFile(event.target.files?.[0] ?? null)}/>
      <span className="text-xs text-muted-foreground">PDF, Word, Excel or PowerPoint · one file · up to 25 MB</span>
    </div>
    {documents?.organizationChartId
      ? <button type="button" className="mt-4 inline-flex items-center gap-2 text-left text-sm text-primary underline-offset-2 hover:underline" onClick={() => void download()}>
          <Download className="size-4" aria-hidden="true"/>{documents.organizationChartFileName ?? "Download Organization Chart"}
        </button>
      : <p className="mt-4 text-sm text-muted-foreground">No Organization Chart attached.</p>}
    {pendingFile && !confirmOpen && !busy && <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={() => void saveFile(pendingFile, previousId)}>Retry upload</Button>}
    <Dialog open={confirmOpen} onOpenChange={open => { if (!open && !busy) clearPending(); }}>
      <DialogContent onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Replace Organization Chart?</DialogTitle>
          <DialogDescription>The existing file will be removed after the new file is uploaded. This cannot be undone. Replace it with {pendingFile?.name}?</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={clearPending}>Cancel</Button>
          <Button type="button" disabled={busy || !pendingFile} onClick={() => pendingFile && void saveFile(pendingFile, previousId)}>
            {busy ? "Replacing…" : "Replace file"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function toDraftRows(fixed: readonly (readonly [string, string])[], saved: AuditDocumentStatusRow[] = []): DraftRow[] {
  const byId = new Map(saved.map(row => [row.id, row]));
  const defaults = fixed.map(([id, label]) => {
    const row = byId.get(id);
    return { id, label, value: row?.value == null ? "" : String(row.value), remarks: row?.remarks ?? "" };
  });
  const fixedIds = new Set<string>(fixed.map(([id]) => id));
  return [...defaults, ...saved.filter(row => !fixedIds.has(row.id)).map(row => ({
    id: row.id, label: row.label, value: row.value == null ? "" : String(row.value), remarks: row.remarks,
  }))];
}

function StatusRows({ auditId, section, saved, onUpdated }: {
  auditId: string; section: StatusSection; saved?: AuditDocumentStatusRow[]; onUpdated: (audit: Audit) => void;
}) {
  const fixed = section === "design-status" ? designLabels : procurementLabels;
  const fixedIds = new Set<string>(fixed.map(([id]) => id));
  const { toast } = useToast();
  const mutation = useUpdateAuditDocumentStatus();
  const [rows, setRows] = useState<DraftRow[]>(() => toDraftRows(fixed, saved));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) setRows(toDraftRows(fixed, saved));
  }, [saved, dirty, section]);

  const change = (id: string, key: "label" | "value" | "remarks", value: string) => {
    setRows(current => current.map(row => row.id === id ? { ...row, [key]: value } : row));
    setDirty(true);
  };
  const add = () => {
    setRows(current => [...current, { id: crypto.randomUUID(), label: "", value: "", remarks: "" }]);
    setDirty(true);
  };
  const remove = (id: string) => {
    setRows(current => current.filter(row => row.id !== id));
    setDirty(true);
  };
  const save = async () => {
    if (rows.some(row => !row.label.trim())) {
      toast({ title: "Enter a name for each added line", variant: "destructive" });
      return;
    }
    const parsed = rows.map(row => {
      const value = row.value.trim();
      return { id: row.id, label: row.label.trim(), value: value === "" ? null : Number(value), remarks: row.remarks };
    });
    if (parsed.some(row => row.value !== null && (!/^\d+(?:\.\d+)?$/.test(rows.find(item => item.id === row.id)!.value.trim()) || !Number.isFinite(row.value) || row.value > 1_000_000_000))) {
      toast({ title: "Enter a valid non-negative numeric value (up to 1,000,000,000)", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await mutation.mutateAsync({ id: auditId, section, data: { rows: parsed } });
      setDirty(false);
      onUpdated(updated);
      toast({ title: `${section === "design-status" ? "Design" : "Procurement"} Status saved` });
    } catch (error) {
      toast({ title: "Unable to save status", description: errorText(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  return <div className="space-y-4">
    <div className="overflow-x-auto">
      <div className="min-w-[650px] space-y-3">
        <div className="grid grid-cols-[minmax(190px,1fr)_130px_minmax(240px,1.4fr)_32px] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Status</span><span>Value</span><span>Remarks</span><span className="sr-only">Actions</span>
        </div>
        {rows.map(row => <div key={row.id} className="grid grid-cols-[minmax(190px,1fr)_130px_minmax(240px,1.4fr)_32px] items-start gap-3">
          {fixedIds.has(row.id)
            ? <span className="py-2 text-sm font-medium">{row.label}</span>
            : <Input aria-label="Additional status name" placeholder="Status name" maxLength={120} value={row.label} onChange={event => change(row.id, "label", event.target.value)} disabled={saving}/>}
          <Input type="number" min="0" max="1000000000" step="any" inputMode="decimal" aria-label={`${row.label || "Additional status"} value`} placeholder="Enter number" value={row.value} onChange={event => change(row.id, "value", event.target.value)} disabled={saving}/>
          <Textarea aria-label={`${row.label || "Additional status"} remarks`} placeholder="Enter remarks" rows={2} maxLength={4000} value={row.remarks} onChange={event => change(row.id, "remarks", event.target.value)} disabled={saving}/>
          {!fixedIds.has(row.id) && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${row.label || "additional line"}`} onClick={() => remove(row.id)} disabled={saving}><Trash2 className="size-4" aria-hidden="true"/></Button>}
        </div>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={saving}><Plus className="mr-2 size-4" aria-hidden="true"/>Add line</Button>
      <div className="flex items-center gap-3">
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <Button type="button" size="sm" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  </div>;
}

export function AdditionalDocumentSections({ auditId, documents }: { auditId: string; documents?: AuditAdditionalDocuments }) {
  const qc = useQueryClient();
  const onUpdated = (audit: Audit) => {
    qc.setQueryData(getGetAuditQueryKey(auditId), audit);
    void qc.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
  };
  return <Accordion type="multiple" className="space-y-3" aria-label="Additional document sections">
    <AccordionItem value="organization-chart" className="rounded-lg border bg-card px-5 shadow-sm">
      <AccordionTrigger className="py-5 text-base hover:no-underline">Organization chart</AccordionTrigger>
      <AccordionContent className="border-t pt-4"><OrganizationChart auditId={auditId} documents={documents} onUpdated={onUpdated}/></AccordionContent>
    </AccordionItem>
    <AccordionItem value="design-status" className="rounded-lg border bg-card px-5 shadow-sm">
      <AccordionTrigger className="py-5 text-base hover:no-underline">Design Status</AccordionTrigger>
      <AccordionContent className="border-t pt-4"><StatusRows auditId={auditId} section="design-status" saved={documents?.designStatus} onUpdated={onUpdated}/></AccordionContent>
    </AccordionItem>
    <AccordionItem value="procurement-status" className="rounded-lg border bg-card px-5 shadow-sm">
      <AccordionTrigger className="py-5 text-base hover:no-underline">Procurement Status</AccordionTrigger>
      <AccordionContent className="border-t pt-4"><StatusRows auditId={auditId} section="procurement-status" saved={documents?.procurementStatus} onUpdated={onUpdated}/></AccordionContent>
    </AccordionItem>
    <AccordionItem value="good-practices" className="rounded-lg border bg-card px-5 shadow-sm">
      <AccordionTrigger className="py-5 text-base hover:no-underline">Conforming and Good Practices</AccordionTrigger>
      <AccordionContent className="border-t pt-4 text-sm text-muted-foreground">Audit files can be uploaded and viewed in the Evidence files area below.</AccordionContent>
    </AccordionItem>
  </Accordion>;
}