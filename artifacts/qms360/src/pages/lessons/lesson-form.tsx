import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { ReactNode } from "react";
import { Download, Loader2, MapPin, Sparkles, Upload, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  confirmLessonPhoto,
  createLessonPhotoIntent,
  exportLessonFormReport,
  useCreateLessonForm,
  useGetCurrentUser,
  useGetLessonForm,
  useGetLessonsReferenceData,
  useRephraseLessonField,
  useReviewLessonForm,
  useSubmitLessonForm,
  useUpdateLessonForm,
} from "@workspace/api-client-react";
import type { LessonLearnedForm } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { LoadState, PageHeader, StateBadge, errorMessage } from "./common";
import { useLov, withLegacyOption } from "@/lib/use-lov";

type FieldName = "description" | "rootCause" | "correction" | "correctiveAction";
type Draft = {
  title: string; projectId: string; disciplineId: string; categorisationId: string;
  issueCategory: string; impact: string;
  description: string; rootCause: string; correction: string; correctiveAction: string;
  capturedAt: string; gpsLat?: number; gpsLng?: number;
};
type UploadItem = { key: string; category: "before" | "after"; name: string; preview: string; progress: number; status: "uploading" | "failed" | "done" };

const initialDraft = (): Draft => ({ title: "", projectId: "", disciplineId: "", categorisationId: "", issueCategory: "Minor", impact: "Positive", description: "", rootCause: "", correction: "", correctiveAction: "", capturedAt: new Date().toISOString().slice(0, 16) });

async function resizeImage(file: File): Promise<File> {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} exceeds the 8 MB limit.`);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Could not read ${file.name}.`)); img.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
  if (scale === 1) return file;
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type || "image/jpeg", 0.88));
  if (!blob) throw new Error(`Could not resize ${file.name}.`);
  return new File([blob], file.name, { type: blob.type });
}

function PhotoGallery({ title, photos }: { title: string; photos: NonNullable<LessonLearnedForm["photos"]> }) {
  return <div><h3 className="mb-3 font-semibold">{title}</h3>{photos.length ? <div className="grid grid-cols-2 gap-3">{photos.map((photo) => <div key={photo.id} className="overflow-hidden rounded-lg border border-border">{photo.storageUrl ? <img src={photo.storageUrl} alt={photo.fileName} className="aspect-video w-full object-cover" /> : <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">Processing</div>}<p className="truncate p-2 text-xs">{photo.fileName}</p></div>)}</div> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No {title.toLowerCase()} photos</p>}</div>;
}

export function LessonFormPage({ id }: { id?: string }) {
  const isNew = !id;
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [review, setReview] = useState<"approve" | "send_back" | null>(null);
  const [remarks, setRemarks] = useState("");
  const refs = useGetLessonsReferenceData();
  const categorisations = useLov("lesson_categorisations");
  const issueCategories = useLov("lesson_issue_categories");
  const impacts = useLov("lesson_impacts");
  const detail = useGetLessonForm(id ?? "", { query: { enabled: Boolean(id), queryKey: [`/api/lessons/forms/${id ?? ""}`] } });
  const user = useGetCurrentUser();
  const queryClient = useQueryClient();
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["/api/lessons/log"] }); if (id) queryClient.invalidateQueries({ queryKey: [`/api/lessons/forms/${id}`] }); };
  const commonMutation = { onSuccess: () => { invalidate(); toast({ title: "Changes saved" }); if (isNew) navigate("/lessons/log"); }, onError: (e: unknown) => toast({ title: "Unable to save", description: errorMessage(e), variant: "destructive" as const }) };
  const create = useCreateLessonForm({ mutation: commonMutation });
  const update = useUpdateLessonForm({ mutation: commonMutation });
  const submit = useSubmitLessonForm({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Lesson submitted for approval" }); }, onError: (e) => toast({ title: "Submit failed", description: errorMessage(e), variant: "destructive" }) } });
  const reviewMutation = useReviewLessonForm({ mutation: { onSuccess: () => { invalidate(); setReview(null); setRemarks(""); toast({ title: review === "approve" ? "Lesson approved" : "Lesson sent back" }); }, onError: (e) => toast({ title: "Review failed", description: errorMessage(e), variant: "destructive" }) } });
  const rephrase = useRephraseLessonField();
  const [suggestion, setSuggestion] = useState<{ field: FieldName; text: string } | null>(null);
  const clientReference = useMemo(() => {
    const key = `lessons-draft-ref-${id ?? "new"}`;
    let value = sessionStorage.getItem(key); if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(key, value); } return value;
  }, [id]);

  useEffect(() => {
    if (!detail.data) return;
    const x = detail.data;
    setDraft({ title: x.title, projectId: x.projectId, disciplineId: x.disciplineId, categorisationId: x.categorisationId, issueCategory: x.issueCategory, impact: x.impact, description: x.description, rootCause: x.rootCause, correction: x.correction, correctiveAction: x.correctiveAction, capturedAt: x.capturedAt.slice(0, 16), gpsLat: x.gpsLat ?? undefined, gpsLng: x.gpsLng ?? undefined });
  }, [detail.data]);

  const readOnly = Boolean(detail.data && !["Draft", "Sent Back"].includes(detail.data.workflowState));
  const isApprover = user.data?.workspaceRoles.some((role) => /approver|admin/i.test(role)) ?? false;
  const uploadBlocking = uploads.some((x) => x.status !== "done");
  function set<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((d) => ({ ...d, [key]: value })); setErrors((e) => ({ ...e, [key]: "" })); }
  function validate() {
    const next: Record<string, string> = {};
    (["title","projectId","disciplineId","categorisationId","description","rootCause","correction","correctiveAction"] as const).forEach((key) => { if (!draft[key]?.trim()) next[key] = "This field is required."; });
    setErrors(next); return Object.keys(next).length === 0;
  }
  function body(): LessonLearnedForm {
    return {
      ...draft,
      id: detail.data?.id ?? clientReference,
      version: detail.data?.version ?? 1,
      conflictFlag: detail.data?.conflictFlag ?? false,
      workflowState: detail.data?.workflowState ?? "Draft",
      capturedAt: new Date(draft.capturedAt).toISOString(),
    } as LessonLearnedForm;
  }
  function save() { if (!validate() || uploadBlocking) return; if (id) update.mutate({ id, data: body() }); else create.mutate({ data: body() }); }
  function captureGps() {
    if (!navigator.geolocation) { toast({ title: "Location unavailable", description: "This browser does not support location.", variant: "destructive" }); return; }
    navigator.geolocation.getCurrentPosition((p) => { setDraft((d) => ({ ...d, gpsLat: p.coords.latitude, gpsLng: p.coords.longitude })); toast({ title: "Location captured" }); }, () => toast({ title: "Location permission denied", description: "You can continue without GPS.", variant: "destructive" }), { enableHighAccuracy: true });
  }
  async function choosePhotos(files: FileList | null, category: "before" | "after") {
    if (!files || !id) return;
    const existing = detail.data?.photos?.filter((p) => p.category === category).length ?? 0;
    const current = uploads.filter((p) => p.category === category).length;
    if (existing + current + files.length > 5) { toast({ title: "Photo limit reached", description: "A maximum of 5 photos is allowed per category.", variant: "destructive" }); return; }
    for (const original of Array.from(files)) {
      const key = crypto.randomUUID();
      try {
        const file = await resizeImage(original);
        const preview = URL.createObjectURL(file);
        setUploads((u) => [...u, { key, category, name: file.name, preview, progress: 20, status: "uploading" }]);
        const intent = await createLessonPhotoIntent(id, { category, fileName: file.name, mimeType: file.type, sizeBytes: file.size, clientReference: `${clientReference}-${key}` });
        setUploads((u) => u.map((x) => x.key === key ? { ...x, progress: 55 } : x));
        const response = await fetch(intent.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
        setUploads((u) => u.map((x) => x.key === key ? { ...x, progress: 85 } : x));
        await confirmLessonPhoto(intent.id);
        setUploads((u) => u.map((x) => x.key === key ? { ...x, progress: 100, status: "done" } : x));
        invalidate();
      } catch (e) {
        setUploads((u) => u.some((x) => x.key === key) ? u.map((x) => x.key === key ? { ...x, status: "failed" } : x) : [...u, { key, category, name: original.name, preview: "", progress: 0, status: "failed" }]);
        toast({ title: "Photo upload failed", description: errorMessage(e), variant: "destructive" });
      }
    }
  }
  async function askRephrase(field: FieldName) {
    if (!draft[field].trim()) { toast({ title: "Enter text first" }); return; }
    try { const result = await rephrase.mutateAsync({ data: { field, text: draft[field] } }); setSuggestion({ field, text: result.suggestion }); } catch (e) { toast({ title: "AI rephrase failed", description: errorMessage(e), variant: "destructive" }); }
  }
  async function report() { if (!id) return; try { const result = await exportLessonFormReport(id); if (result.downloadUrl) window.open(result.downloadUrl, "_blank", "noopener,noreferrer"); else toast({ title: "Report queued", description: result.message ?? "Your report will be delivered when ready." }); } catch (e) { toast({ title: "Report failed", description: errorMessage(e), variant: "destructive" }); } }

  if (!isNew) return <LoadState loading={detail.isLoading} error={detail.error} empty={!detail.data}>{detail.data && render()}</LoadState>;
  return render();

  function render() {
    const record = detail.data;
    return <div>
      <PageHeader title={isNew ? "New Lesson Learned" : record?.title ?? "Lesson"} description={isNew ? "Capture an experience for the shared knowledge base." : record?.referenceNumber} back={isNew ? "/lessons" : "/lessons/log"} actions={record && <><StateBadge state={record.workflowState} />{record.version > 1 && <Badge variant="outline">Version {record.version}</Badge>}<Button variant="outline" onClick={report}><Download /> Report</Button></>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle>Lesson details</CardTitle></CardHeader><CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" error={errors.title} className="sm:col-span-2"><Input value={draft.title} onChange={(e) => set("title", e.target.value)} disabled={readOnly} /></Field>
            <Field label="Project" error={errors.projectId}><Select value={draft.projectId} onValueChange={(v) => set("projectId", v)} disabled={readOnly}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{refs.data?.projects.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Discipline" error={errors.disciplineId}><Select value={draft.disciplineId} onValueChange={(v) => set("disciplineId", v)} disabled={readOnly}><SelectTrigger><SelectValue placeholder="Select discipline" /></SelectTrigger><SelectContent>{refs.data?.disciplines.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Categorisation" error={errors.categorisationId}><Select value={draft.categorisationId} onValueChange={(v) => set("categorisationId", v)} disabled={readOnly || categorisations.isLoading}><SelectTrigger><SelectValue placeholder="Select categorisation" /></SelectTrigger><SelectContent>{withLegacyOption(categorisations.options, draft.categorisationId).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
             <Field label="Issue category"><Select value={draft.issueCategory} onValueChange={(v: Draft["issueCategory"]) => set("issueCategory", v)} disabled={readOnly || issueCategories.isLoading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{withLegacyOption(issueCategories.options, draft.issueCategory).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
             <Field label="Impact"><Select value={draft.impact} onValueChange={(v: Draft["impact"]) => set("impact", v)} disabled={readOnly || impacts.isLoading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{withLegacyOption(impacts.options, draft.impact).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Capture date"><Input type="datetime-local" value={draft.capturedAt} onChange={(e) => set("capturedAt", e.target.value)} disabled={readOnly} /></Field>
          </div>
          {(["description","rootCause","correction","correctiveAction"] as FieldName[]).map((field) => <Field key={field} label={({ description: "Description", rootCause: "Root cause", correction: "Correction", correctiveAction: "Corrective action" } as const)[field]} error={errors[field]}>
            <Textarea rows={5} value={draft[field]} onChange={(e) => set(field, e.target.value)} disabled={readOnly} />
            {!readOnly && <Popover open={suggestion?.field === field} onOpenChange={(open) => !open && setSuggestion(null)}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="mt-1 text-primary" onClick={() => askRephrase(field)} disabled={rephrase.isPending}><Sparkles /> Rephrase with AI</Button></PopoverTrigger><PopoverContent className="w-96"><p className="mb-2 text-sm font-semibold">AI suggestion</p><p className="text-sm">{suggestion?.text}</p><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => { if (suggestion) set(field, suggestion.text); setSuggestion(null); }}>Use suggestion</Button><Button size="sm" variant="outline" onClick={() => setSuggestion(null)}>Dismiss</Button></div></PopoverContent></Popover>}
          </Field>)}
        </CardContent></Card>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Capture location</CardTitle></CardHeader><CardContent><Button variant="outline" className="w-full" onClick={captureGps} disabled={readOnly}><MapPin /> Capture GPS</Button>{draft.gpsLat != null && <p className="mt-3 text-center text-xs text-muted-foreground">{draft.gpsLat.toFixed(5)}, {draft.gpsLng?.toFixed(5)}</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle>Photo evidence</CardTitle></CardHeader><CardContent className="space-y-5">
            {!id ? <p className="text-sm text-muted-foreground">Save the lesson first, then reopen it to add before and after evidence.</p> : (["before","after"] as const).map((category) => <div key={category}><div className="mb-2 flex items-center justify-between"><Label className="capitalize">{category} photos</Label>{!readOnly && <Button size="sm" variant="outline" asChild><label><Upload /> Add<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => choosePhotos(e.target.files, category)} /></label></Button>}</div>
              <div className="grid grid-cols-2 gap-2">{record?.photos?.filter((p) => p.category === category).map((p) => <div key={p.id} className="overflow-hidden rounded border border-border">{p.storageUrl ? <img src={p.storageUrl} className="aspect-video w-full object-cover" alt={p.fileName} /> : <div className="aspect-video bg-muted" />}</div>)}{uploads.filter((p) => p.category === category).map((p) => <div key={p.key} className="relative overflow-hidden rounded border border-border">{p.preview ? <img src={p.preview} className="aspect-video w-full object-cover" alt={p.name} /> : <div className="flex aspect-video items-center justify-center bg-muted"><X className="text-destructive" /></div>}<Progress value={p.progress} className="absolute bottom-0 rounded-none" /></div>)}</div>
            </div>)}
            {uploadBlocking && <p className="text-xs text-destructive">Resolve pending or failed uploads before saving or submitting.</p>}
          </CardContent></Card>
          {!readOnly && <Button className="w-full" onClick={save} disabled={create.isPending || update.isPending || uploadBlocking}>{(create.isPending || update.isPending) && <Loader2 className="animate-spin" />} Save lesson</Button>}
          {record?.workflowState === "Draft" || record?.workflowState === "Sent Back" ? <Button variant="secondary" className="w-full" disabled={uploadBlocking || submit.isPending} onClick={() => submit.mutate({ id: record.id })}>Submit for approval</Button> : null}
          {record?.workflowState === "Submitted" && isApprover && <div className="grid grid-cols-2 gap-2"><Button onClick={() => setReview("approve")}>Approve</Button><Button variant="destructive" onClick={() => setReview("send_back")}>Send back</Button></div>}
        </div>
      </div>
      {record?.photos?.length ? <Card className="mt-6"><CardHeader><CardTitle>Before & after</CardTitle></CardHeader><CardContent className="grid gap-6 md:grid-cols-2"><PhotoGallery title="Before" photos={record.photos.filter((p) => p.category === "before")} /><PhotoGallery title="After" photos={record.photos.filter((p) => p.category === "after")} /></CardContent></Card> : null}
      <Dialog open={review !== null} onOpenChange={(open) => !open && setReview(null)}><DialogContent><DialogHeader><DialogTitle>{review === "approve" ? "Approve lesson" : "Send lesson back"}</DialogTitle><DialogDescription>{review === "send_back" ? "Remarks are required so the creator knows what to change." : "Optionally add an approval remark."}</DialogDescription></DialogHeader><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Review remarks" /><DialogFooter><Button variant="outline" onClick={() => setReview(null)}>Cancel</Button><Button disabled={review === "send_back" && !remarks.trim()} onClick={() => record && reviewMutation.mutate({ id: record.id, data: { decision: review!, comments: remarks || undefined } })}>Confirm</Button></DialogFooter></DialogContent></Dialog>
    </div>;
  }
}

function Field({ label, error, children, className = "" }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-2 block">{label}</Label>{children}{error && <p className="mt-1 text-xs text-destructive">{error}</p>}</div>;
}
