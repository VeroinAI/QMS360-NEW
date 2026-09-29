import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Upload } from "lucide-react";
import {
  customFetch,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useListAuditEvidence,
} from "@workspace/api-client-react";
import type { EvidenceFile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const mimeByExtension: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";

export function AuditAttachments({ auditId }: { auditId: string }) {
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const references = useRef(new Map<string, string>());
  const query = useListAuditEvidence({ recordType: "audit", recordId: auditId, scope: "attachments", page, limit: 200 });
  const intent = useCreateAuditEvidenceIntent();
  const confirm = useConfirmAuditEvidence();
  const qc = useQueryClient();
  const { toast } = useToast();

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`${index + 1} of ${files.length}`);
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = file.type || mimeByExtension[extension] || "application/octet-stream";
        const maxMb = mimeType.startsWith("video/") ? 200 : mimeType.startsWith("image/") ? 8 : 25;
        if (!file.size || file.size > maxMb * 1024 * 1024) {
          toast({ title: `Unable to attach ${file.name}`, description: `File must be between 1 byte and ${maxMb} MB.`, variant: "destructive" });
          failed++;
          continue;
        }
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
        if (!references.current.has(fingerprint)) references.current.set(fingerprint, crypto.randomUUID());
        try {
          const created = await intent.mutateAsync({ data: {
            recordType: "audit", recordId: auditId, category: "attachment",
            fileName: file.name, mimeType, sizeBytes: file.size,
            clientReference: references.current.get(fingerprint)!,
          } });
          const response = await fetch(created.uploadUrl, {
            method: "PUT", body: file, headers: { "Content-Type": mimeType },
          });
          if (!response.ok) throw new Error(`Storage upload failed (${response.status}).`);
          await confirm.mutateAsync({ id: created.id });
          references.current.delete(fingerprint);
          succeeded++;
        } catch (error) {
          failed++;
          toast({ title: `Unable to attach ${file.name}`, description: errorText(error), variant: "destructive" });
        }
      }
      if (succeeded) {
        setPage(1);
        await qc.invalidateQueries({ queryKey: ["/api/audit/evidence"] });
        toast({ title: `${succeeded} ${succeeded === 1 ? "file" : "files"} attached${failed ? ` · ${failed} failed` : ""}` });
      }
    } finally {
      setUploading(false);
      setProgress("");
    }
  };

  const download = async (file: EvidenceFile) => {
    if (!file.storageUrl) return;
    try {
      const blob = await customFetch<Blob>(file.storageUrl, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Unable to download attachment", description: errorText(error), variant: "destructive" });
    }
  };

  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Attachment</CardTitle>
          <CardDescription>Attach multiple files · photos ≤8MB · videos ≤200MB · documents ≤25MB</CardDescription>
        </div>
        <Button type="button" disabled={uploading} onClick={() => input.current?.click()}>
          <Upload className="mr-2 size-4" aria-hidden="true"/>
          {uploading ? `Attaching ${progress}…` : "Attach files"}
        </Button>
        <input ref={input} className="sr-only" tabIndex={-1} type="file" multiple
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          aria-label="Choose files to attach to this audit"
          onChange={event => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            void upload(selected);
          }}/>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {query.isLoading && <p className="text-sm text-muted-foreground">Loading attachments…</p>}
      {query.error && <div className="flex items-center gap-3 text-sm text-destructive">
        Unable to load attachments. <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button>
      </div>}
      {!query.isLoading && !query.error && !query.data?.items.length &&
        <p className="text-sm text-muted-foreground">No files attached yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {query.data?.items.map(file => <button key={file.id} type="button" onClick={() => void download(file)}
          className="flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="rounded bg-muted p-2"><FileText className="size-5" aria-hidden="true"/></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium" title={file.fileName}>{file.fileName}</span>
            <span className="block text-xs text-muted-foreground">{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB · Download</span>
          </span>
          <Download className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
        </button>)}
      </div>
      {(query.data?.total ?? 0) > 200 && <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
        <span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(query.data!.total / 200)}</span>
        <Button type="button" variant="outline" size="sm" disabled={page * 200 >= query.data!.total} onClick={() => setPage(current => current + 1)}>Next</Button>
      </div>}
    </CardContent>
  </Card>;
}