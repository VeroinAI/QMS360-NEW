import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Plus, Trash2, X } from "lucide-react";
import {
  customFetch,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useUpdateAuditGoodPractices,
} from "@workspace/api-client-react";
import type {
  Audit, AuditGoodPracticeInputRow, AuditGoodPracticeRow,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type PracticeDraft = AuditGoodPracticeInputRow & { evidenceFileName: string | null };
const emptyRow = (): PracticeDraft => ({
  id: crypto.randomUUID(), areaProcess: "", verifiedConforming: "",
  evidenceReference: "", referenceNumber: "", evidenceId: null, evidenceFileName: null,
});
const fromSaved = (rows?: AuditGoodPracticeRow[]): PracticeDraft[] =>
  rows?.length ? rows.map(row => ({
    id: row.id, areaProcess: row.areaProcess, verifiedConforming: row.verifiedConforming,
    evidenceReference: row.evidenceReference, referenceNumber: row.referenceNumber,
    evidenceId: row.evidenceId, evidenceFileName: row.evidenceFileName ?? null,
  })) : [emptyRow()];

const contentTypes: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain",
};
const accept = Object.keys(contentTypes).map(extension => `.${extension}`).join(",");
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";

export function GoodPracticesEditor({ auditId, saved, onUpdated }: {
  auditId: string; saved?: AuditGoodPracticeRow[]; onUpdated: (audit: Audit) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const intent = useCreateAuditEvidenceIntent();
  const confirm = useConfirmAuditEvidence();
  const update = useUpdateAuditGoodPractices();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const references = useRef(new Map<string, { fingerprint: string; reference: string }>());
  const [rows, setRows] = useState<PracticeDraft[]>(() => fromSaved(saved));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingRow, setUploadingRow] = useState<string | null>(null);
  const busy = saving || uploadingRow !== null;

  useEffect(() => {
    if (!dirty) setRows(fromSaved(saved));
  }, [saved, dirty]);

  const edit = (id: string, field: "areaProcess" | "verifiedConforming" | "evidenceReference" | "referenceNumber", value: string) => {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row));
    setDirty(true);
  };
  const save = async (nextRows: PracticeDraft[], attached = false) => {
    setSaving(true);
    try {
      const updated = await update.mutateAsync({ id: auditId, data: { rows: nextRows.map(({
        id, areaProcess, verifiedConforming, evidenceReference, referenceNumber, evidenceId,
      }) => ({ id, areaProcess, verifiedConforming, evidenceReference, referenceNumber, evidenceId })) } });
      setRows(fromSaved(updated.additionalDocuments?.goodPractices));
      setDirty(false);
      onUpdated(updated);
      toast({ title: attached ? "Evidence attached to good practice" : "Conforming and Good Practices saved" });
    } catch (error) {
      setDirty(true);
      toast({ title: "Unable to save good practices", description: errorText(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const attach = async (id: string, file: File | null) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!contentTypes[extension] || !file.size || file.size > (contentTypes[extension].startsWith("image/") ? 8 : 25) * 1024 * 1024) {
      toast({ title: "Choose a supported document or image within the file size limit", variant: "destructive" });
      return;
    }
    const mimeType = file.type && file.type !== "application/octet-stream" ? file.type : contentTypes[extension];
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    if (references.current.get(id)?.fingerprint !== fingerprint) {
      references.current.set(id, { fingerprint, reference: crypto.randomUUID() });
    }
    setUploadingRow(id);
    try {
      const upload = await intent.mutateAsync({ data: {
        recordType: "audit", recordId: auditId, category: "good_practices",
        fileName: file.name, mimeType, sizeBytes: file.size,
        clientReference: references.current.get(id)!.reference,
      } });
      const response = await fetch(upload.uploadUrl, {
        method: "PUT", body: file, headers: { "Content-Type": mimeType },
      });
      if (!response.ok) throw new Error(`Storage upload failed (${response.status}). Please try again.`);
      await confirm.mutateAsync({ id: upload.id });
      const nextRows = rows.map(row => row.id === id
        ? { ...row, evidenceId: upload.id, evidenceFileName: file.name } : row);
      setRows(nextRows);
      setDirty(true);
      await save(nextRows, true);
      void qc.invalidateQueries({ queryKey: ["/api/audit/evidence"] });
    } catch (error) {
      toast({ title: "Unable to attach evidence", description: errorText(error), variant: "destructive" });
    } finally {
      setUploadingRow(null);
    }
  };
  const download = async (row: PracticeDraft) => {
    if (!row.evidenceId) return;
    try {
      const blob = await customFetch<Blob>(`/api/files/${row.evidenceId}`, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = row.evidenceFileName ?? "evidence";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Unable to download evidence", description: errorText(error), variant: "destructive" });
    }
  };
  const remove = (row: PracticeDraft) => {
    if (row.evidenceId && !window.confirm("Remove this row? Its uploaded file will remain available in the Attachment tile.")) return;
    setRows(current => current.filter(item => item.id !== row.id));
    setDirty(true);
  };

  return <div className="space-y-4">
    <div className="overflow-x-auto">
      <div className="min-w-[1020px] space-y-3">
        <div className="grid grid-cols-[minmax(150px,1fr)_minmax(260px,1.65fr)_minmax(275px,1.65fr)_minmax(155px,1fr)_36px] gap-3 text-xs font-semibold text-foreground">
          <span>Area / process</span>
          <span>What was verified and found conforming</span>
          <span>Record / evidence reference</span>
          <span>Reference Number</span>
          <span className="sr-only">Actions</span>
        </div>
        {rows.map((row, index) => <div key={row.id} className="grid grid-cols-[minmax(150px,1fr)_minmax(260px,1.65fr)_minmax(275px,1.65fr)_minmax(155px,1fr)_36px] items-start gap-3 border-t pt-3">
          <Input aria-label={`Area or process row ${index + 1}`} placeholder="Enter area / process" maxLength={200} value={row.areaProcess} onChange={event => edit(row.id, "areaProcess", event.target.value)} disabled={busy}/>
          <Textarea aria-label={`Verified and found conforming row ${index + 1}`} placeholder="Describe what was verified" rows={2} maxLength={4000} value={row.verifiedConforming} onChange={event => edit(row.id, "verifiedConforming", event.target.value)} disabled={busy}/>
          <div className="space-y-2">
            <Input aria-label={`Record or evidence reference row ${index + 1}`} placeholder="Enter record / evidence reference" maxLength={500} value={row.evidenceReference} onChange={event => edit(row.id, "evidenceReference", event.target.value)} disabled={busy}/>
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" className="sr-only" tabIndex={-1} aria-label={`Choose evidence file for row ${index + 1}`} accept={accept}
                ref={element => { inputs.current[row.id] = element; }}
                onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ""; void attach(row.id, file); }}/>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputs.current[row.id]?.click()}>
                <Paperclip className="mr-1 size-4" aria-hidden="true"/>
                {uploadingRow === row.id ? "Attaching…" : row.evidenceId ? "Replace attachment" : "Attach file"}
              </Button>
              {row.evidenceId && <Button type="button" variant="ghost" size="icon" aria-label={`Unlink attachment from row ${index + 1}`} disabled={busy}
                onClick={() => { setRows(current => current.map(item => item.id === row.id ? { ...item, evidenceId: null, evidenceFileName: null } : item)); setDirty(true); }}>
                <X className="size-4" aria-hidden="true"/>
              </Button>}
            </div>
            {row.evidenceId && <button type="button" className="inline-flex max-w-full items-center gap-1 break-all text-left text-xs text-primary hover:underline" onClick={() => void download(row)}>
              <Download className="size-3 shrink-0" aria-hidden="true"/>{row.evidenceFileName ?? "Download evidence"}
            </button>}
          </div>
          <Input aria-label={`Reference number row ${index + 1}`} placeholder="Enter reference number" maxLength={200} value={row.referenceNumber} onChange={event => edit(row.id, "referenceNumber", event.target.value)} disabled={busy}/>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${index + 1}`} disabled={busy || rows.length === 1} onClick={() => remove(row)}>
            <Trash2 className="size-4" aria-hidden="true"/>
          </Button>
        </div>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="outline" size="sm" disabled={busy || rows.length >= 500} onClick={() => { setRows(current => [...current, emptyRow()]); setDirty(true); }}>
        <Plus className="mr-2 size-4" aria-hidden="true"/>Add row
      </Button>
      <div className="flex items-center gap-3">
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <Button type="button" size="sm" disabled={!dirty || busy} onClick={() => void save(rows)}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  </div>;
}