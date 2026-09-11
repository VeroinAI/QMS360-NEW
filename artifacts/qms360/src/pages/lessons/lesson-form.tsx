import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { ReactNode } from "react";
import { Camera, Download, Loader2, MapPin, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  confirmLessonPhoto,
  createLessonPhotoIntent,
  deleteLessonPhoto,
  customFetch,
  downloadLessonFormPdf,
  useCreateLessonForm,
  useGetCurrentUser,
  useGetLessonForm,
  useGetLessonsReferenceData,
  useListLessonApprovers,
  useListLessonFormActivity,
  useRephraseLessonField,
  useReviewLessonForm,
  useSubmitLessonForm,
  useUpdateLessonForm,
} from "@workspace/api-client-react";
import type { LessonLearnedForm } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { VerionBadge, VerionWordmark } from "@/components/verion-ai";
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
import { useFieldControls } from "@/lib/field-controls";
import { useFieldAccess } from "@/lib/use-field-access";

type FieldName = "description" | "rootCause" | "correction" | "correctiveAction";
type Draft = {
  title: string; projectId: string; disciplineId: string; categorisationId: string; reference: string;
  issueCategory: string; impact: string; approverId: string;
  isRepeatedIssue: boolean; repeatCount: number; repeatLocation: string; remarks: string;
  description: string; rootCause: string; correction: string; correctiveAction: string;
  capturedAt: string; gpsLat?: number; gpsLng?: number;
};
type UploadItem = { key: string; category: "before" | "after"; name: string; preview: string; progress: number; status: "queued" | "uploading" | "failed" | "done"; file?: File };

function toDatetimeLocal(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

const initialDraft = (): Draft => {
  const empty: Draft = { title: "", projectId: "", disciplineId: "", categorisationId: "", reference: "", issueCategory: "Minor", impact: "Positive", approverId: "", isRepeatedIssue: false, repeatCount: 0, repeatLocation: "", remarks: "", description: "", rootCause: "", correction: "", correctiveAction: "", capturedAt: toDatetimeLocal(new Date()) };
  if (typeof window === "undefined") return empty;
  const raw = sessionStorage.getItem("verionai-lessons-draft");
  if (!raw) return empty;
  sessionStorage.removeItem("verionai-lessons-draft");
  try {
    const seed = JSON.parse(raw) as Partial<Draft>;
    return { ...empty, ...seed, repeatCount: Number(seed.repeatCount ?? empty.repeatCount), isRepeatedIssue: seed.isRepeatedIssue === true };
  } catch {
    return empty;
  }
};

async function resizeImage(file: File): Promise<File> {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} exceeds the 8 MB limit.`);
  const sourceUrl = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Could not read ${file.name}.`)); img.src = sourceUrl;
  }).finally(() => URL.revokeObjectURL(sourceUrl));
  const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
  if (scale === 1) return file;
  const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type || "image/jpeg", 0.88));
  if (!blob) throw new Error(`Could not resize ${file.name}.`);
  return new File([blob], file.name, { type: blob.type });
}

/** Evidence endpoints require the Bearer token, which an <img> tag cannot send — load bytes via the API client and render an object URL. */
function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null); setFailed(false);
    customFetch<Blob>(src, { responseType: "blob" })
      .then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (failed) return <div className="flex aspect-video items-center justify-center bg-muted text-xs text-muted-foreground">Preview unavailable</div>;
  if (!url) return <div className="aspect-video w-full animate-pulse bg-muted" />;
  return <img src={url} alt={alt} className={className} />;
}

function PhotoGallery({ title, photos }: { title: string; photos: NonNullable<LessonLearnedForm["photos"]> }) {
  return <div><h3 className="mb-3 font-semibold">{title}</h3>{photos.length ? <div className="grid grid-cols-2 gap-3">{photos.map((photo) => <div key={photo.id} className="overflow-hidden rounded-lg border border-border">{photo.storageUrl ? <AuthImage src={photo.storageUrl} alt={photo.fileName} className="aspect-video w-full object-cover" /> : <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">Processing</div>}<p className="truncate p-2 text-xs">{photo.fileName}</p></div>)}</div> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No {title.toLowerCase()} photos</p>}</div>;
}

export function LessonFormPage({ id }: { id?: string }) {
  const isNew = !id;
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [cameraCategory, setCameraCategory] = useState<"before" | "after" | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  uploadsRef.current = uploads;
  const revokedPreviews = useRef<Set<string>>(new Set());
  const removedUploadKeys = useRef<Set<string>>(new Set());
  const revokePreview = (url: string) => {
    if (!url || revokedPreviews.current.has(url)) return;
    revokedPreviews.current.add(url);
    URL.revokeObjectURL(url);
  };
  useEffect(() => () => {
    for (const item of uploadsRef.current) revokePreview(item.preview);
  }, []);
  useEffect(() => {
    if (!cameraCategory) return;
    let cancelled = false;
    let acquiredStream: MediaStream | null = null;
    const stopStream = (stream: MediaStream | null) => {
      stream?.getTracks().forEach((track) => track.stop());
      if (cameraStream.current === stream) cameraStream.current = null;
    };
    setCameraError("");
    setCameraReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not support camera capture. You can still add a photo from your device.");
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    }).then(async (stream) => {
      acquiredStream = stream;
      if (cancelled) {
        stopStream(stream);
        return;
      }
      cameraStream.current = stream;
      const video = cameraVideo.current;
      if (!video) {
        stopStream(stream);
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        stopStream(stream);
        throw error;
      }
      if (cancelled) {
        stopStream(stream);
        return;
      }
      setCameraReady(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      const name = error instanceof DOMException ? error.name : "";
      setCameraError(name === "NotAllowedError"
        ? "Camera permission was denied. Allow access in your browser settings and try again."
        : "The camera could not be started. You can still add a photo from your device.");
    });
    return () => {
      cancelled = true;
      stopStream(acquiredStream);
    };
  }, [cameraCategory]);
  const [saveError, setSaveError] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("photoUploadError") === "1"
      ? "A photo failed to upload. Remove the failed photo, add it again, and save the lesson."
      : "");
  const [removingPhotoIds, setRemovingPhotoIds] = useState<Set<string>>(() => new Set());
  const [review, setReview] = useState<"approve" | "send_back" | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState("");
  const refs = useGetLessonsReferenceData();
  // Scope-aware: once the org defines approver scopes (Settings → Users &
  // Access), only approvers matching this lesson's project/discipline/
  // categorisation are offered.
  const approvers = useListLessonApprovers({ projectId: draft.projectId || undefined, discipline: draft.disciplineId || undefined, categorisation: draft.categorisationId || undefined });
  const disciplines = useLov("disciplines");
  const categorisations = useLov("lesson_categorisations");
  const issueCategories = useLov("lesson_issue_categories");
  const impacts = useLov("lesson_impacts");
  const detail = useGetLessonForm(id ?? "", { query: { enabled: Boolean(id), queryKey: [`/api/lessons/forms/${id ?? ""}`] } });
  const activity = useListLessonFormActivity(id ?? "", { query: { enabled: Boolean(id), queryKey: [`/api/lessons/forms/${id ?? ""}/activity`] } });
  const user = useGetCurrentUser();
  const fieldControls = useFieldControls("lessons", "lesson-form");
  const fieldAccess = useFieldAccess("lessons");
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lessons/log"] });
    queryClient.invalidateQueries({ queryKey: ["/api/lessons/notifications"] });
    if (id) {
      queryClient.invalidateQueries({ queryKey: [`/api/lessons/forms/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/lessons/forms/${id}/activity`] });
    }
  };
  // Create is driven from save() so photos queued before the first save can be uploaded once the record id exists.
  const create = useCreateLessonForm();
  const update = useUpdateLessonForm();
  const submit = useSubmitLessonForm();
  const source = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("from") : null;
  const fromApprovals = source === "approvals";
  const backLink = fromApprovals ? "/lessons/approvals" : source === "notifications" ? "/lessons/notifications" : (isNew ? "/lessons" : "/lessons/log");
  const reviewMutation = useReviewLessonForm({ mutation: { onSuccess: () => { invalidate(); setReview(null); setReviewRemarks(""); toast({ title: review === "approve" ? "Lesson approved" : "Lesson sent back" }); if (fromApprovals) navigate("/lessons/approvals"); }, onError: (e) => toast({ title: "Review failed", description: errorMessage(e), variant: "destructive" }) } });
  const rephrase = useRephraseLessonField();
  const [suggestion, setSuggestion] = useState<{ field: FieldName; text: string } | null>(null);
  const clientReferenceStorageKey = `lessons-draft-ref-v2-${id ?? "new"}`;
  const [clientReference, setClientReference] = useState(() => {
    let value = sessionStorage.getItem(clientReferenceStorageKey); if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(clientReferenceStorageKey, value); } return value;
  });
  function rotateClientReference() {
    const next = crypto.randomUUID();
    sessionStorage.setItem(clientReferenceStorageKey, next);
    setClientReference(next);
  }

  useEffect(() => {
    if (!detail.data) return;
    const x = detail.data;
    setDraft({ title: x.title, projectId: x.projectId, disciplineId: x.disciplineId, categorisationId: x.categorisationId, reference: x.reference ?? "", issueCategory: x.issueCategory, impact: x.impact, approverId: x.approverId ?? "", isRepeatedIssue: x.isRepeatedIssue ?? false, repeatCount: x.repeatCount ?? 0, repeatLocation: x.repeatLocation ?? "", remarks: x.remarks ?? "", description: x.description, rootCause: x.rootCause, correction: x.correction, correctiveAction: x.correctiveAction, capturedAt: toDatetimeLocal(new Date(x.capturedAt)), gpsLat: x.gpsLat ?? undefined, gpsLng: x.gpsLng ?? undefined });
  }, [detail.data]);

  const readOnly = Boolean(detail.data && !["Draft", "Sent Back"].includes(detail.data.workflowState));
  const fp = (key: string) => fieldControls.fieldProps(key);
  const disabled = (key: string) => readOnly || fp(key).disabled || fieldAccess.readOnly("lesson-form", key);
  const isCreator = detail.data?.creatorId != null && detail.data.creatorId === user.data?.id;
  // Only the designated approver sees review actions — there is no admin bypass.
  const canReview = detail.data?.canReview === true;
  const uploadBlocking = uploads.some((x) => x.status === "uploading");
  const hasBeforePhoto = Boolean(detail.data?.photos?.some((p) => p.category === "before" && p.status === "confirmed"));
  const hasAfterPhoto = Boolean(detail.data?.photos?.some((p) => p.category === "after" && p.status === "confirmed"));
  const photosReady = hasBeforePhoto && hasAfterPhoto;
  const approverOptions = useMemo(() => {
    const options = approvers.data ?? [];
    return draft.approverId && !options.some((x) => x.id === draft.approverId)
      ? [...options, { id: draft.approverId, fullName: "Current approver", email: "", roles: [] }]
      : options;
  }, [approvers.data, draft.approverId]);
  const approverUnsaved = Boolean(detail.data) && draft.approverId !== (detail.data?.approverId ?? "");
  function set<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((d) => ({ ...d, [key]: value })); setErrors((e) => ({ ...e, [key]: "" })); }
  function validate(requireApprover = true) {
    const next: Record<string, string> = {};
    (["title","projectId","disciplineId","categorisationId","description","rootCause","correction","correctiveAction"] as const).forEach((key) => { if (!draft[key]?.trim()) next[key] = "This field is required."; });
    if (requireApprover && !draft.approverId) next.approverId = "Choose an approver before submitting.";
    if (!draft.capturedAt) next.capturedAt = "Enter when this lesson was captured.";
    else if (Number.isNaN(new Date(draft.capturedAt).valueOf())) next.capturedAt = "Enter a valid date and time.";
    else if (new Date(draft.capturedAt).getTime() > Date.now()) next.capturedAt = "Captured at cannot be in the future.";
    if (draft.isRepeatedIssue && draft.repeatCount < 1) next.repeatCount = "Enter how many times this issue was repeated.";
    if (draft.isRepeatedIssue && !draft.repeatLocation.trim()) next.repeatLocation = "Enter where this issue was repeated.";
    for (const key of fieldControls.mandatoryFieldKeys()) {
      if (next[key]) continue;
      if ((key === "repeatCount" || key === "repeatLocation") && !draft.isRepeatedIssue) continue;
      const value = draft[key as keyof Draft];
      const empty = key === "gps" ? draft.gpsLat == null || draft.gpsLng == null
        : key === "isRepeatedIssue" ? false
        : key === "repeatCount" ? draft.repeatCount < 1
        : typeof value === "string" ? !value.trim()
        : false;
      if (empty) next[key] = "This field is required.";
    }
    setErrors(next); return Object.keys(next).length === 0;
  }
  function body(): LessonLearnedForm {
    return {
      ...draft,
      approverId: draft.approverId || null,
      id: detail.data?.id ?? clientReference,
      version: detail.data?.version ?? 1,
      conflictFlag: detail.data?.conflictFlag ?? false,
      workflowState: detail.data?.workflowState ?? "Draft",
      capturedAt: new Date(draft.capturedAt).toISOString(),
    } as LessonLearnedForm;
  }
  async function uploadPhoto(recordId: string, item: UploadItem) {
    if (removedUploadKeys.current.has(item.key)) return;
    const file = item.file;
    if (!file) throw new Error(`${item.name} must be selected again before it can be uploaded.`);
    setUploads((u) => u.map((x) => x.key === item.key ? { ...x, progress: Math.max(x.progress, 20), status: "uploading" } : x));
    if (removedUploadKeys.current.has(item.key)) return;
    const intent = await createLessonPhotoIntent(recordId, { category: item.category, fileName: file.name, mimeType: file.type, sizeBytes: file.size, clientReference: `${clientReference}-${item.key}` });
    setUploads((u) => u.map((x) => x.key === item.key ? { ...x, progress: 55, status: "uploading" } : x));
    await customFetch(intent.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (removedUploadKeys.current.has(item.key)) return;
    setUploads((u) => u.map((x) => x.key === item.key ? { ...x, progress: 85 } : x));
    await confirmLessonPhoto(intent.id);
    if (item.preview) revokePreview(item.preview);
    removedUploadKeys.current.delete(item.key);
    setUploads((u) => u.filter((x) => x.key !== item.key));
  }
  async function saveDraft({ navigateAfterSave = isNew, requireApprover = false }: { navigateAfterSave?: boolean; requireApprover?: boolean } = {}): Promise<string | null> {
    if (!validate(requireApprover) || uploadBlocking) return null;
    const unretryable = uploads.filter((item) => item.status === "failed" && !item.file);
    if (unretryable.length) {
      const message = "A failed photo must be removed and selected again before the lesson can be saved.";
      setSaveError(message);
      toast({ title: "Unable to save lesson", description: message, variant: "destructive" });
      return null;
    }
    setSaveError("");
    try {
      let recordId = id;
      let referenceNumber = detail.data?.referenceNumber ?? "";
      if (id) {
        await update.mutateAsync({ id, data: body() });
      } else {
        const created = await create.mutateAsync({ data: body() });
        recordId = created.id;
        referenceNumber = created.referenceNumber;
      }
      const queued = uploads.filter((x) => x.status === "queued" || x.status === "failed");
      if (queued.length) {
        const results = await Promise.allSettled(queued.map((item) => uploadPhoto(recordId!, item)));
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed) {
          const failedKeys = new Set(queued.filter((_, index) => results[index]?.status === "rejected").map((item) => item.key));
          setUploads((current) => current.map((item) => failedKeys.has(item.key) ? { ...item, status: "failed" } : item));
          const message = `${failed} photo${failed === 1 ? "" : "s"} failed to upload. The lesson remains a draft; remove or retry the failed photo before saving again.`;
          setSaveError(message);
          if (!id) {
            rotateClientReference();
            navigate(`/lessons/${recordId}?photoUploadError=1`);
          } else {
            invalidate();
          }
          toast({ title: "Unable to complete lesson save", description: message, variant: "destructive" });
          return null;
        }
      }
      if (!id) rotateClientReference();
      toast({ title: `Lesson ${referenceNumber} saved`.replace("  ", " ") });
      invalidate();
      if (navigateAfterSave) navigate("/lessons/log");
      return recordId!;
    } catch (e) {
      const message = errorMessage(e);
      setSaveError(message);
      toast({ title: "Unable to save", description: message, variant: "destructive" });
      return null;
    }
  }
  async function saveAndSubmit() {
    const recordId = await saveDraft({ navigateAfterSave: false, requireApprover: true });
    if (!recordId) return;
    try {
      await submit.mutateAsync({ id: recordId });
      invalidate();
      toast({ title: detail.data?.workflowState === "Sent Back" ? "Corrected lesson resubmitted" : "Lesson submitted for approval" });
      navigate("/lessons/log");
    } catch (e) {
      toast({ title: "Saved as draft; submit failed", description: errorMessage(e), variant: "destructive" });
      navigate(`/lessons/${recordId}`);
    }
  }
  function captureGps() {
    if (!navigator.geolocation) { toast({ title: "Location unavailable", description: "This browser does not support location.", variant: "destructive" }); return; }
    navigator.geolocation.getCurrentPosition((p) => { setDraft((d) => ({ ...d, gpsLat: p.coords.latitude, gpsLng: p.coords.longitude })); toast({ title: "Location captured" }); }, () => toast({ title: "Location permission denied", description: "You can continue without GPS.", variant: "destructive" }), { enableHighAccuracy: true });
  }
  async function addPhotos(files: File[], category: "before" | "after") {
    if (!files.length) return;
    const existing = detail.data?.photos?.filter((p) => p.category === category).length ?? 0;
    const current = uploads.filter((p) => p.category === category).length;
    if (existing + current + files.length > 5) { toast({ title: "Photo limit reached", description: "A maximum of 5 photos is allowed per category.", variant: "destructive" }); return; }
    for (const original of files) {
      const key = crypto.randomUUID();
      try {
        const file = await resizeImage(original);
        const preview = URL.createObjectURL(file);
        // Before the first save there is no record id, so queue locally and upload on save.
        if (!id) { setUploads((u) => [...u, { key, category, name: file.name, preview, progress: 0, status: "queued", file }]); continue; }
        setUploads((u) => [...u, { key, category, name: file.name, preview, progress: 20, status: "uploading", file }]);
        await uploadPhoto(id, { key, category, name: file.name, preview, progress: 20, status: "uploading", file });
        invalidate();
      } catch (e) {
        setUploads((u) => u.some((x) => x.key === key) ? u.map((x) => x.key === key ? { ...x, status: "failed" } : x) : [...u, { key, category, name: original.name, preview: "", progress: 0, status: "failed" }]);
        setSaveError("A photo upload failed. Remove it or save again to retry before submitting.");
        toast({ title: "Photo upload failed", description: errorMessage(e), variant: "destructive" });
      }
    }
  }
  async function choosePhotos(files: FileList | null, category: "before" | "after") {
    if (files) await addPhotos(Array.from(files), category);
  }
  async function capturePhoto() {
    const category = cameraCategory;
    const video = cameraVideo.current;
    if (!category || !video || !video.videoWidth || !video.videoHeight) {
      setCameraError("The camera is still starting. Wait a moment, then try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Could not capture the camera image. Please try again.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!image) {
      setCameraError("Could not create the photo. Please try again.");
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await addPhotos([new File([image], `${category}-photo-${timestamp}.jpg`, { type: "image/jpeg" })], category);
    setCameraCategory(null);
  }
  function removeQueuedPhoto(key: string) {
    removedUploadKeys.current.add(key);
    if (!uploads.some((photo) => photo.key !== key && photo.status === "failed")) setSaveError("");
    setUploads((current) => {
      const item = current.find((photo) => photo.key === key);
      if (item?.preview) revokePreview(item.preview);
      return current.filter((photo) => photo.key !== key);
    });
  }
  async function removeSavedPhoto(photoId: string) {
    setRemovingPhotoIds((current) => new Set(current).add(photoId));
    try {
      await deleteLessonPhoto(photoId);
      queryClient.setQueryData<LessonLearnedForm>([`/api/lessons/forms/${id ?? ""}`], (current) =>
        current ? { ...current, photos: current.photos?.filter((photo) => photo.id !== photoId) } : current);
      queryClient.invalidateQueries({ queryKey: ["/api/lessons/log"] });
      if (id) queryClient.invalidateQueries({ queryKey: [`/api/lessons/forms/${id}/activity`] });
      setSaveError("");
      toast({ title: "Photo removed" });
    } catch (e) {
      toast({ title: "Unable to remove photo", description: errorMessage(e), variant: "destructive" });
    } finally {
      setRemovingPhotoIds((current) => {
        const next = new Set(current);
        next.delete(photoId);
        return next;
      });
    }
  }
  async function askRephrase(field: FieldName) {
    if (!draft[field].trim()) { toast({ title: "Enter text first" }); return; }
    try { const result = await rephrase.mutateAsync({ data: { field, text: draft[field] } }); setSuggestion({ field, text: result.suggestion }); } catch (e) { toast({ title: "AI rephrase failed", description: errorMessage(e), variant: "destructive" }); }
  }
  async function report() {
    if (!id) return;
    try {
      const result = await downloadLessonFormPdf(id);
      if (result.downloadUrl) {
        // Download via an anchor so popup blockers do not swallow the data URL.
        const a = document.createElement("a");
        a.href = result.downloadUrl;
        a.download = result.fileName ?? "lesson-learned.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else toast({ title: "Report queued", description: result.message ?? "Your report will be delivered when ready." });
    } catch (e) { toast({ title: "Report failed", description: errorMessage(e), variant: "destructive" }); }
  }

  if (!isNew) return <LoadState loading={detail.isLoading} error={detail.error} empty={!detail.data} resource="this lesson">{detail.data && render()}</LoadState>;
  return render();

  function render() {
    const record = detail.data;
    return <div>
      <PageHeader title={isNew ? "New Lesson Learned" : record?.title ?? "Lesson"} description={isNew ? "Capture an experience for the shared knowledge base." : record?.referenceNumber} back={backLink} actions={record && <><StateBadge state={record.workflowState} />{record.version > 1 && <Badge variant="outline">Version {record.version}</Badge>}<Button variant="outline" onClick={report}><Download /> Download PDF</Button></>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle>Lesson details</CardTitle></CardHeader><CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project Name" error={errors.projectId} required={fp("projectId").required}><Select value={draft.projectId} onValueChange={(v) => set("projectId", v)} disabled={disabled("projectId")}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{refs.data?.projects.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Reference Number"><Input value={record?.referenceNumber ?? "Generated after first save"} disabled /></Field>
            <Field label="Title" error={errors.title} required={fp("title").required} className="sm:col-span-2"><Input value={draft.title} onChange={(e) => set("title", e.target.value)} disabled={disabled("title")} /></Field>
            <Field label="Discipline" error={errors.disciplineId} required={fp("disciplineId").required}><Select value={draft.disciplineId} onValueChange={(v) => set("disciplineId", v)} disabled={disabled("disciplineId") || disciplines.isLoading}><SelectTrigger><SelectValue placeholder="Select discipline" /></SelectTrigger><SelectContent>{withLegacyOption(disciplines.options, draft.disciplineId).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Categorization" error={errors.categorisationId} required={fp("categorisationId").required}><Select value={draft.categorisationId} onValueChange={(v) => set("categorisationId", v)} disabled={disabled("categorisationId") || categorisations.isLoading}><SelectTrigger><SelectValue placeholder="Select categorization" /></SelectTrigger><SelectContent>{withLegacyOption(categorisations.options, draft.categorisationId).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
             <Field label="Captured at" error={errors.capturedAt} required={fp("capturedAt").required}><Input type="datetime-local" max={toDatetimeLocal(new Date())} value={draft.capturedAt} onChange={(e) => set("capturedAt", e.target.value)} disabled={disabled("capturedAt")} /></Field>
            <Field label="Time Zone"><Input value={Intl.DateTimeFormat().resolvedOptions().timeZone} disabled readOnly /></Field>
            <Field label="Location" error={errors.gps} required={fp("gps").required}>
              <Button type="button" variant="outline" className="w-full" onClick={captureGps} disabled={disabled("gps")}><MapPin /> Capture GPS</Button>
              {draft.gpsLat != null && <p className="mt-2 text-xs text-muted-foreground">{draft.gpsLat.toFixed(5)}, {draft.gpsLng?.toFixed(5)}</p>}
            </Field>
            <Field label="Issue Category" required={fp("issueCategory").required}><Select value={draft.issueCategory} onValueChange={(v: Draft["issueCategory"]) => set("issueCategory", v)} disabled={disabled("issueCategory") || issueCategories.isLoading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{issueCategories.options.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Impact" required={fp("impact").required}><Select value={draft.impact} onValueChange={(v: Draft["impact"]) => set("impact", v)} disabled={disabled("impact") || impacts.isLoading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{impacts.options.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Description" error={errors.description} required={fp("description").required} className="sm:col-span-2">
              <Textarea rows={5} value={draft.description} onChange={(e) => set("description", e.target.value)} disabled={disabled("description")} />
              {!disabled("description") && <Popover open={suggestion?.field === "description"} onOpenChange={(open) => !open && setSuggestion(null)}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="mt-1 text-[#b52865] hover:bg-[#fceaf3] hover:text-[#b52865] dark:text-[#f472b6] dark:hover:bg-[#b52865]/20" onClick={() => askRephrase("description")} disabled={rephrase.isPending}><Sparkles /> Rephrase with VerionAI</Button></PopoverTrigger><PopoverContent className="w-96"><div className="mb-3 flex items-center gap-2 border-b border-[#b52865]/20 pb-2"><VerionBadge>VerionAI Suggestion</VerionBadge></div><p className="text-sm">{suggestion?.text}</p><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => { if (suggestion) set("description", suggestion.text); setSuggestion(null); }}>Use suggestion</Button><Button size="sm" variant="outline" onClick={() => setSuggestion(null)}>Dismiss</Button></div></PopoverContent></Popover>}
            </Field>
            <Field label="Reference" error={errors.reference} required={fp("reference").required} className="sm:col-span-2"><Input value={draft.reference} onChange={(e) => set("reference", e.target.value)} disabled={disabled("reference")} /></Field>
            <Field label="New / Repeated Issue" required={fp("isRepeatedIssue").required}>
              <Select value={draft.isRepeatedIssue ? "repeated" : "new"} onValueChange={(value) => setDraft((current) => ({ ...current, isRepeatedIssue: value === "repeated", repeatCount: value === "repeated" ? Math.max(1, current.repeatCount) : 0, repeatLocation: value === "repeated" ? current.repeatLocation : "" }))} disabled={disabled("isRepeatedIssue")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="new">New Issue</SelectItem><SelectItem value="repeated">Repeated Issue</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="No. of times repeated" error={errors.repeatCount} required={draft.isRepeatedIssue && fp("repeatCount").required}><Input type="number" min={1} value={draft.repeatCount || ""} onChange={(e) => set("repeatCount", Number(e.target.value) || 0)} disabled={disabled("repeatCount") || !draft.isRepeatedIssue} /></Field>
            <Field label="Where was it repeated?" error={errors.repeatLocation} required={draft.isRepeatedIssue && fp("repeatLocation").required}><Input value={draft.repeatLocation} onChange={(e) => set("repeatLocation", e.target.value)} disabled={disabled("repeatLocation") || !draft.isRepeatedIssue} /></Field>
            {(["rootCause","correction","correctiveAction"] as FieldName[]).map((field) => <Field key={field} className="sm:col-span-2" label={({ description: "Description", rootCause: "Root Cause", correction: "Correction", correctiveAction: "Corrective Action" } as const)[field]} error={errors[field]} required={fp(field).required}>
              <Textarea rows={5} value={draft[field]} onChange={(e) => set(field, e.target.value)} disabled={disabled(field)} />
              {!disabled(field) && <Popover open={suggestion?.field === field} onOpenChange={(open) => !open && setSuggestion(null)}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="mt-1 text-[#b52865] hover:bg-[#fceaf3] hover:text-[#b52865] dark:text-[#f472b6] dark:hover:bg-[#b52865]/20" onClick={() => askRephrase(field)} disabled={rephrase.isPending}><Sparkles /> Rephrase with VerionAI</Button></PopoverTrigger><PopoverContent className="w-96"><div className="mb-3 flex items-center gap-2 border-b border-[#b52865]/20 pb-2"><VerionBadge>VerionAI Suggestion</VerionBadge></div><p className="text-sm">{suggestion?.text}</p><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => { if (suggestion) set(field, suggestion.text); setSuggestion(null); }}>Use suggestion</Button><Button size="sm" variant="outline" onClick={() => setSuggestion(null)}>Dismiss</Button></div></PopoverContent></Popover>}
            </Field>)}
          </div>
          <Card><CardHeader><CardTitle>Before Photo</CardTitle></CardHeader><CardContent><PhotoInput category="before" /></CardContent></Card>
          <Card><CardHeader><CardTitle>After Photo</CardTitle></CardHeader><CardContent><PhotoInput category="after" /></CardContent></Card>
          <Field label="Remarks" error={errors.remarks} required={fp("remarks").required}><Textarea rows={3} value={draft.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={disabled("remarks")} placeholder="Add any additional remarks" /></Field>
        </CardContent></Card>
        <div className={`${readOnly ? "block" : "hidden xl:block"} space-y-6 xl:sticky xl:top-6 xl:self-start`}>
          <WorkflowControls />
          {record?.workflowState === "Submitted" && canReview && <div className="grid grid-cols-2 gap-2"><Button onClick={() => setReview("approve")}>Approve</Button><Button variant="destructive" onClick={() => setReview("send_back")}>Send back</Button></div>}
          {record?.submittedAt && <Card><CardHeader><CardTitle>Approval record</CardTitle></CardHeader><CardContent className="space-y-4">
            <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Submitted by</p><p className="font-medium">{record.submittedByName ?? "Unknown"}{record.submittedByDesignation ? ` — ${record.submittedByDesignation}` : ""}</p><p className="text-xs text-muted-foreground">{new Date(record.submittedAt).toLocaleString()}</p>{record.submittedBySignatureUrl && <AuthImage src={record.submittedBySignatureUrl} alt="Submitter signature" className="mt-2 h-12 rounded border border-border bg-white object-contain p-1" />}</div>
            {record.reviewedAt && <div className="border-t border-border pt-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{record.reviewDecision === "approve" ? "Approved by" : "Sent back by"}</p><p className="font-medium">{record.reviewedByName ?? "Unknown"}{record.reviewedByDesignation ? ` — ${record.reviewedByDesignation}` : ""}</p><p className="text-xs text-muted-foreground">{new Date(record.reviewedAt).toLocaleString()}</p>{record.reviewComments && <p className="mt-1 rounded-md bg-muted p-2 text-sm"><span className="font-medium">Comments: </span>{record.reviewComments}</p>}{record.reviewedBySignatureUrl && <AuthImage src={record.reviewedBySignatureUrl} alt="Reviewer signature" className="mt-2 h-12 rounded border border-border bg-white object-contain p-1" />}</div>}
          </CardContent></Card>}
        </div>
      </div>
      {!readOnly && <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 shadow-lg xl:hidden"><WorkflowControls mobile /></div>}
      {record?.photos?.length ? <Card className="mt-6"><CardHeader><CardTitle>Before & after</CardTitle></CardHeader><CardContent className="grid gap-6 md:grid-cols-2"><PhotoGallery title="Before" photos={record.photos.filter((p) => p.category === "before")} /><PhotoGallery title="After" photos={record.photos.filter((p) => p.category === "after")} /></CardContent></Card> : null}
      {record && activity.data && activity.data.items.length > 0 && <Card className="mt-6"><CardHeader><CardTitle>Activity</CardTitle></CardHeader><CardContent><ol className="relative space-y-4 border-l border-border pl-5">{activity.data.items.map((entry) => {
         const comments = entry.after && typeof entry.after === "object"
           ? String(entry.after.transferText ?? (entry.action === "send_back" ? (entry.after.reviewComments ?? entry.after.remarks ?? "") : ""))
          : "";
        return <li key={entry.id} className="relative"><span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-primary" /><p className="text-sm font-medium capitalize">{entry.action.replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground">{entry.actorName ?? "Someone"} · {new Date(entry.occurredAt).toLocaleString()}</p>{comments && <p className="mt-1 rounded-md bg-muted p-2 text-sm"><span className="font-medium">Comments: </span>{comments}</p>}</li>;
      })}</ol></CardContent></Card>}
      <Dialog open={cameraCategory !== null} onOpenChange={(open) => !open && setCameraCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capture {cameraCategory === "before" ? "Before" : "After"} photo</DialogTitle>
            <DialogDescription>Position the photo, then capture it. It will appear with the other {cameraCategory} photos.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg bg-black">
            <video ref={cameraVideo} className="aspect-video w-full object-cover" autoPlay muted playsInline />
          </div>
          {cameraError && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{cameraError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCameraCategory(null)}>Cancel</Button>
            <Button type="button" onClick={() => void capturePhoto()} disabled={!cameraReady || Boolean(cameraError)}>
              <Camera /> Capture photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={review !== null} onOpenChange={(open) => !open && !reviewMutation.isPending && setReview(null)}><DialogContent><DialogHeader><DialogTitle>{review === "approve" ? "Approve lesson" : "Send lesson back"}</DialogTitle><DialogDescription>{review === "send_back" ? "Remarks are required so the creator knows what to change." : "Optionally add an approval remark."}</DialogDescription></DialogHeader><Textarea value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)} placeholder="Review remarks" /><DialogFooter><Button variant="outline" disabled={reviewMutation.isPending} onClick={() => setReview(null)}>Cancel</Button><Button disabled={reviewMutation.isPending || (review === "send_back" && !reviewRemarks.trim())} onClick={() => record && reviewMutation.mutate({ id: record.id, data: { decision: review!, comments: reviewRemarks || undefined } })}>{reviewMutation.isPending ? "Saving decision…" : "Confirm"}</Button></DialogFooter></DialogContent></Dialog>
    </div>;

    function PhotoInput({ category }: { category: "before" | "after" }) {
       return <div><div className="mb-2 flex justify-end gap-2">{!readOnly && <><Button type="button" size="sm" variant="outline" onClick={() => setCameraCategory(category)}><Camera /> Use camera</Button><Button size="sm" variant="outline" asChild><label><Upload /> Add photo<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { void choosePhotos(e.target.files, category); e.currentTarget.value = ""; }} /></label></Button></>}</div><div className="grid grid-cols-2 gap-2">{record?.photos?.filter((p) => p.category === category).map((p) => <div key={p.id} className="relative overflow-hidden rounded border border-border">{p.storageUrl ? <AuthImage src={p.storageUrl} className="aspect-video w-full object-cover" alt={p.fileName} /> : <div className="aspect-video bg-muted" />}{!readOnly && <Button type="button" size="icon" variant="destructive" className="absolute right-2 top-2 z-10 size-8" aria-label={`Remove ${p.fileName}`} disabled={removingPhotoIds.has(p.id)} onClick={() => void removeSavedPhoto(p.id)}>{removingPhotoIds.has(p.id) ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</Button>}</div>)}{uploads.filter((p) => p.category === category).map((p) => <div key={p.key} className="relative overflow-hidden rounded border border-border">{p.preview ? <img src={p.preview} className="aspect-video w-full object-cover" alt={p.name} /> : <div className="flex aspect-video items-center justify-center bg-muted"><X className="text-destructive" /></div>}{!["uploading", "done"].includes(p.status) && <Button type="button" size="icon" variant="destructive" className="absolute right-2 top-2 z-10 size-8" aria-label={`Remove ${p.name}`} onClick={() => removeQueuedPhoto(p.key)}><Trash2 className="size-4" /></Button>}{p.status !== "queued" ? <Progress value={p.progress} className="pointer-events-none absolute bottom-0 rounded-none" /> : <p className="pointer-events-none absolute bottom-0 w-full bg-background/80 text-center text-[10px] text-muted-foreground">Uploads on save</p>}</div>)}</div>{!id && uploads.some((p) => p.status === "queued") && <p className="mt-2 text-xs text-muted-foreground">Photos will be uploaded when you save the lesson.</p>}{uploads.some((p) => p.status === "failed") && <p className="mt-2 text-xs text-destructive">A photo upload failed. Save again to retry it before submitting.</p>}{uploadBlocking && <p className="mt-2 text-xs text-destructive">Wait for pending uploads before saving or submitting.</p>}</div>;
    }

    function WorkflowControls({ mobile = false }: { mobile?: boolean }) {
      const editableState = isNew || record?.workflowState === "Draft" || record?.workflowState === "Sent Back";
      const pending = create.isPending || update.isPending || submit.isPending;
      return <Card className={mobile ? "border-0 shadow-none" : undefined}><CardHeader className={mobile ? "hidden" : undefined}><CardTitle>Workflow</CardTitle></CardHeader><CardContent className={mobile ? "p-0" : undefined}>
        <Field label="Approver" error={errors.approverId} required={fp("approverId").required}><Select value={draft.approverId} onValueChange={(v) => set("approverId", v)} disabled={disabled("approverId") || approvers.isLoading}><SelectTrigger><SelectValue placeholder="Select approver" /></SelectTrigger><SelectContent>{approverOptions.map((x) => <SelectItem key={x.id} value={x.id}>{x.fullName}</SelectItem>)}</SelectContent></Select>{!readOnly && !mobile && <p className="mt-1 text-xs text-muted-foreground">Routes the lesson to this person for review. You cannot select yourself.</p>}</Field>
        {!readOnly && <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => void saveDraft()} disabled={pending || uploadBlocking}>{(create.isPending || update.isPending) && <Loader2 className="animate-spin" />} Save draft</Button>{editableState && <Button onClick={() => void saveAndSubmit()} disabled={pending || uploadBlocking}><Loader2 className={pending ? "animate-spin" : "hidden"} /> Save & submit</Button>}</div>}
        {saveError && <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive" role="alert">{saveError}</p>}
        {editableState && !mobile && <p className="mt-2 text-center text-xs text-muted-foreground">Submission requires an approver and at least one confirmed before and after photo.</p>}
      </CardContent></Card>;
    }
  }
}

function Field({ label, error, required, children, className = "" }: { label: string; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-2 block">{label}{required && <span className="ml-1 text-destructive">*</span>}</Label>{children}{error && <p className="mt-1 text-xs text-destructive">{error}</p>}</div>;
}
