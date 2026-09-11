import { useEffect, useState } from "react";
import { Link, Route, Switch, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCloseCorrectiveActionReport,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useCreateAuditFinding,
  useCreateAuditPlan,
  useCreateAuditSchedule,
  useCreateFindingCars,
  useDeleteAuditPlan,
  useDeleteAuditSchedule,
  useGetAudit,
  useGetAuditDashboard,
  useGetAuditPlanOptions,
  useGetGeneratedAuditReport,
  useListAuditEvidence,
  useListAuditFindings,
  useListAuditPlans,
  useListAuditSchedules,
  useListAudits,
  useListCorrectiveActionReports,
  useListPlatformProjects,
  useCancelCarExtension,
  useRequestCarExtension,
  useReviewAuditSchedule,
  useReviewCarExtension,
  useReviewCorrectiveActionReport,
  useShareAuditPlan,
  useSubmitAuditSchedule,
  useSubmitCorrectiveActionReport,
  useUpdateAuditChecklist,
  useUpdateAuditClosingMeeting,
  useUpdateAuditFinding,
  useUpdateAuditOpeningMeeting,
  useUpdateCorrectiveActionReport,
  useUpdateAuditSchedule,
} from "@workspace/api-client-react";
import type {
  AuditFinding,
  AuditPlan,
  AuditSchedule,
  ChecklistItem,
  CorrectiveActionReport,
  EvidenceFile,
  MeetingMinutes,
} from "@workspace/api-client-react";
import {
  AlertTriangle, ArrowLeft, BarChart3, CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck,
  Download, FileText, FolderOpen, MapPin, Plus, Printer, Search, Share2, ShieldCheck,
  Trash2, Upload, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useGetAuditEscalations } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLov, withLegacyOption } from "@/lib/use-lov";
import { useFieldAccess } from "@/lib/use-field-access";
import { useFieldControls } from "@/lib/field-controls";

const PAGE_SIZE = 10;
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "—";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
type QueuedAttachment = { file: File; clientReference: string };
const workflowTone = (value: string) =>
  value === "Approved" || value === "Closed" || value === "Accepted" || value === "Shared"
    ? "default" : value === "Rejected" || value === "Sent Back" ? "destructive" : "secondary";

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}
  </div>;
}

function State({ loading, error, empty, label = "No records found." }: { loading: boolean; error: unknown; empty: boolean; label?: string }) {
  if (loading) return <Card><CardContent className="py-14 text-center text-muted-foreground">Loading…</CardContent></Card>;
  if (error) return <Card className="border-destructive"><CardContent className="py-10 text-center text-destructive">{errorText(error)}</CardContent></Card>;
  if (empty) return <Card><CardContent className="py-14 text-center"><FolderOpen className="mx-auto mb-3 size-8 text-muted-foreground"/><p>{label}</p></CardContent></Card>;
  return null;
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
    <span>{total} total</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => onPage(page + 1)}>Next</Button></div>
  </div>;
}

function AuditNav() {
  const links = [["Dashboard", "/audit"], ["Schedules", "/audit/schedules"], ["Plans", "/audit/plans"], ["Audits", "/audit/audits"], ["CAR register", "/audit/cars"], ["Reports", "/audit/reports"]];
  return <nav className="flex gap-1 overflow-x-auto border-b pb-3">{links.map(([label, href]) => <Button key={href} variant="ghost" size="sm" asChild><Link href={href}>{label}</Link></Button>)}</nav>;
}

function Layout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8"><div className="rounded-xl bg-primary p-6 text-primary-foreground"><div className="flex items-center gap-3"><ShieldCheck className="size-8"/><div><p className="font-semibold">QMS Audit Management</p><p className="text-sm opacity-80">ISO 9001 audit lifecycle workspace</p></div></div></div><AuditNav/>{children}</main>;
}

function Dashboard() {
  const query = useGetAuditDashboard();
  const metrics = (query.data?.metrics ?? {}) as Record<string, unknown>;
  const number = (keys: string[]) => Number(keys.map(k => metrics[k]).find(v => v !== undefined) ?? 0);
  const open = number(["openAudits", "open"]);
  const closed = number(["closedAudits", "closed"]);
  const findings = ["Conformity", "Observation", "Minor NC", "Major NC"].map(k => ({ name: k, value: Number((metrics.findingsByClassification as Record<string, number> | undefined)?.[k] ?? metrics[k] ?? 0) }));
  const cars = ["Open", "Submitted", "Accepted", "Rejected", "Closed"].map(k => ({ name: k, value: Number((metrics.carsByStatus as Record<string, number> | undefined)?.[k] ?? 0) }));
  const overdue = (metrics.overdueCars as Array<Record<string, unknown>> | undefined) ?? [];
  const escalations = useGetAuditEscalations({ page: 1, limit: 20 });
  const openEscalations = (escalations.data?.items ?? []).filter((e) => e.status === "open");
  if (query.isLoading || query.error) return <State loading={query.isLoading} error={query.error} empty={false}/>;
  return <div className="space-y-6">
    <PageHeader title="Audit dashboard" description={`Live operational view · refreshed ${date(query.data?.generatedAt)}`}/>
    <div className="grid gap-4 md:grid-cols-4">
      <Metric label="Open audits" value={open} icon={<ClipboardCheck/>}/><Metric label="Closed audits" value={closed} icon={<CheckCircle2/>}/>
      <Metric label="Open CARs" value={cars.find(c => c.name === "Open")?.value ?? 0} icon={<AlertTriangle/>}/><Metric label="Overdue CARs" value={overdue.length || number(["overdueCarsCount"])} icon={<CalendarDays/>}/>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Findings by classification</CardTitle><CardDescription>Current classification mix</CardDescription></CardHeader><CardContent className="space-y-4">{findings.map((item, index) => <div key={item.name}><div className="mb-1 flex justify-between text-sm"><span>{item.name}</span><b>{item.value}</b></div><Progress value={findings.reduce((a,b)=>a+b.value,0) ? item.value / findings.reduce((a,b)=>a+b.value,0) * 100 : 0} className={index === 3 ? "[&>div]:bg-destructive" : ""}/></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>CAR status pipeline</CardTitle><CardDescription>Progress from open to verified closure</CardDescription></CardHeader><CardContent className="space-y-4">{cars.map(item => <div key={item.name}><div className="mb-1 flex justify-between text-sm"><span>{item.name}</span><b>{item.value}</b></div><Progress value={Math.min(100, item.value * 10)}/></div>)}</CardContent></Card>
    </div>
    <Card className={overdue.length ? "border-destructive" : ""}><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5"/>Overdue CAR alerts</CardTitle></CardHeader><CardContent>{overdue.length ? <div className="space-y-2">{overdue.map((item, i) => <div key={String(item.id ?? i)} className="flex justify-between rounded-md bg-muted p-3 text-sm"><span>{String(item.responsibleDepartment ?? item.title ?? `CAR ${i + 1}`)}</span><Badge variant="destructive">{date(item.dueDate as string)}</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">No overdue CARs.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Open escalations</CardTitle><CardDescription>Records that breached an escalation rule</CardDescription></CardHeader><CardContent>{openEscalations.length ? <div className="space-y-2">{openEscalations.map((e) => <div key={e.id} className="flex justify-between rounded-md bg-muted p-3 text-sm"><span className="capitalize">{e.recordType.replaceAll("_", " ")}</span><Badge variant="destructive">{e.level} · due {date(e.dueAt)}</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">No open escalations.</p>}</CardContent></Card>
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p></div><div className="rounded-lg bg-accent p-3 text-accent-foreground">{icon}</div></CardContent></Card>;
}

function ScheduleForm({ initial, onClose }: { initial?: AuditSchedule; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const fc = useFieldControls("audit", "schedule"); const ro = (key: string) => fc.fieldProps(key).disabled; const req = (key: string) => fc.fieldProps(key).required;
  const [l1Files, setL1Files] = useState<QueuedAttachment[]>([]);
  const [l2Files, setL2Files] = useState<QueuedAttachment[]>([]);
  const [createdScheduleId, setCreatedScheduleId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<AuditSchedule>(initial ?? {
    id: crypto.randomUUID(), year: new Date().getFullYear(), title: "", projectIds: [], auditTypes: [],
    auditCategory: "", departmentProject: "", location: "", processProductOwner: "",
    plannedStartDate: "", plannedEndDate: "", qaqcReference: `QAM-IA/${new Date().getFullYear().toString().slice(-2)}-`,
    auditNumber: `AUD-${new Date().getFullYear()}-`, qaqcScope: "System and Process audits against ISO 9001:2015",
    qaqcClauses: "ISO 9001 — All clauses", remarks: "", l1Name: "", l1ReviewStatus: "Pending",
    l1ReviewComments: "", l1Attachments: [], l2Name: "", l2ReviewStatus: "Pending", l2ReviewComments: "",
    l2Attachments: [], memoDescription: "", memoCirculation: "", ownerId: "", workflowState: "Draft"
  });
  const create = useCreateAuditSchedule(); const update = useUpdateAuditSchedule();
  const evidenceIntent = useCreateAuditEvidenceIntent(); const confirmEvidence = useConfirmAuditEvidence();
  const auditTypes = useLov("audit_types");
  const auditCategories = useLov("audit_categories");
  const processOwners = useLov("process_product_owners");
  const auditLevels = useLov("audit_levels");
  const projects = useListPlatformProjects({ page: 1, limit: 200 });
  const projectRows = projects.data?.items ?? [];
  const projectOptions = projectRows.map(project => ({
    value: project.id,
    label: project.code ? `${project.code} — ${project.name}` : project.name,
  }));
  const selectedProjectId = form.projectIds?.[0]
    ?? projectRows.find(project => project.name === form.departmentProject)?.id
    ?? "";
  useEffect(() => {
    if (!projectRows.length) return;
    const selected = form.projectIds?.[0]
      ? projectRows.find(project => project.id === form.projectIds![0])
      : projectRows.find(project => project.name === form.departmentProject);
    if (!selected || (form.projectIds?.[0] === selected.id && form.departmentProject === selected.name)) return;
    setForm(current => ({ ...current, projectIds: [selected.id], departmentProject: selected.name }));
  }, [projectRows, form.projectIds, form.departmentProject]);
  const selectProject = (projectId: string) => {
    const project = projectRows.find(item => item.id === projectId);
    setForm(current => ({
      ...current,
      projectIds: [projectId],
      departmentProject: project?.name ?? "",
    }));
    setErrors(current => {
      if (!current.departmentProject && !current.projectIds) return current;
      const next = { ...current };
      delete next.departmentProject;
      delete next.projectIds;
      return next;
    });
  };
  const uploadAttachment = async ({ file, clientReference }: QueuedAttachment, category: "l1-review" | "l2-review", scheduleId: string) => {
    const intent = await evidenceIntent.mutateAsync({ data: {
      recordType: "audit_schedule", recordId: scheduleId, category, fileName: file.name,
      mimeType: file.type || "application/octet-stream", sizeBytes: file.size, clientReference,
    } });
    const token = localStorage.getItem("qms360_token");
    const response = await fetch(intent.uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error ?? `Unable to upload ${file.name}`);
    }
    await confirmEvidence.mutateAsync({ id: intent.id });
  };
  const uploadQueuedAttachments = async (scheduleId: string) => {
    for (const attachment of l1Files) {
      await uploadAttachment(attachment, "l1-review", scheduleId);
      setL1Files(current => current.filter(item => item.clientReference !== attachment.clientReference));
    }
    for (const attachment of l2Files) {
      await uploadAttachment(attachment, "l2-review", scheduleId);
      setL2Files(current => current.filter(item => item.clientReference !== attachment.clientReference));
    }
  };
  const save = async () => {
    const missing: Record<string, string> = {};
    if (!form.auditTypes?.length) missing.auditTypes = "Audit Type is required.";
    if (!form.auditCategory) missing.auditCategory = "Audit Category is required.";
    if (!form.projectIds?.length || !form.departmentProject?.trim()) missing.departmentProject = "Department / Project is required.";
    if (!form.location?.trim()) missing.location = "Location is required.";
    if (!form.title.trim()) missing.title = "Audit Title is required.";
    if (!form.processProductOwner?.trim()) missing.processProductOwner = "Process / Product Owner is required.";
    if (!form.plannedStartDate) missing.plannedStartDate = "From Date is required.";
    if (!form.plannedEndDate) missing.plannedEndDate = "To Date is required.";
    if (!missing.plannedStartDate && !missing.plannedEndDate && form.plannedEndDate.slice(0, 10) < form.plannedStartDate.slice(0, 10)) missing.plannedEndDate = "To Date must be on or after From Date.";
    if (!form.l1Name?.trim()) missing.l1Name = "Name of L1 is required.";
    if (form.l1ReviewStatus === "Send Back" && !form.l1ReviewComments?.trim()) missing.l1ReviewComments = "L1 Review Comments are required when sending back.";
    if (!form.l2Name?.trim()) missing.l2Name = "Name of L2 is required.";
    if (form.l2ReviewStatus === "Send Back" && !form.l2ReviewComments?.trim()) missing.l2ReviewComments = "L2 Review Comments are required when sending back.";
    if (!form.memoDescription?.trim()) missing.memoDescription = "Memo Description is required.";
    if (!form.memoCirculation?.trim()) missing.memoCirculation = "Memo Circulation is required.";
    for (const key of fc.mandatoryFieldKeys()) {
      if (missing[key]) continue;
      const value = (form as unknown as Record<string, unknown>)[key];
      const empty = Array.isArray(value) ? value.length === 0 : value == null || (typeof value === "string" && !value.trim());
      if (empty) missing[key] = "This field is required by your administrator.";
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      const first = Object.keys(missing)[0];
      requestAnimationFrame(() => document.getElementById(`schedule-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      toast({ title: "Complete required fields", description: "Update the fields highlighted in red.", variant: "destructive" });
      return;
    }
    setErrors({});
    let savedScheduleId: string | null = null;
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, data: form });
        savedScheduleId = initial.id;
      } else if (createdScheduleId) {
        await update.mutateAsync({ id: createdScheduleId, data: { ...form, id: createdScheduleId } });
        savedScheduleId = createdScheduleId;
      }
      else {
        await create.mutateAsync({ data: form });
        savedScheduleId = form.id;
        setCreatedScheduleId(savedScheduleId);
      }
      await uploadQueuedAttachments(savedScheduleId);
      qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
      toast({ title: initial ? "Schedule updated" : "Schedule created" });
      onClose();
    } catch (e) {
      toast({
        title: savedScheduleId ? "Schedule saved; attachment upload needs retry" : "Unable to save",
        description: savedScheduleId
          ? `${errorText(e)} Select Save schedule to retry only the remaining attachment files.`
          : errorText(e),
        variant: "destructive",
      });
    }
  };
  const field = (key: keyof AuditSchedule, value: unknown) => {
    setForm(v => ({ ...v, [key]: value }));
    setErrors(current => {
      const related = key === "l1ReviewStatus" ? "l1ReviewComments" : key === "l2ReviewStatus" ? "l2ReviewComments" : undefined;
      if (!current[key] && (!related || !current[related])) return current;
      const next = { ...current }; delete next[key]; if (related) delete next[related];
      if (key === "plannedStartDate" || key === "plannedEndDate") { delete next.plannedStartDate; delete next.plannedEndDate; }
      return next;
    });
  };
  const captureGps = () => {
    if (!navigator.geolocation) {
      toast({ title: "Location unavailable", description: "This browser does not support GPS location.", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const gpsLat = Number(position.coords.latitude.toFixed(6));
        const gpsLng = Number(position.coords.longitude.toFixed(6));
        setForm(current => ({ ...current, gpsLat, gpsLng, location: `${gpsLat}, ${gpsLng}` }));
        setErrors(current => {
          if (!current.location) return current;
          const next = { ...current };
          delete next.location;
          return next;
        });
        toast({ title: "Location captured" });
      },
      () => toast({ title: "Location permission denied", description: "Allow location access and try again.", variant: "destructive" }),
      { enableHighAccuracy: true },
    );
  };
  const error = (key: keyof AuditSchedule) => errors[key] ? <p className="mt-1 text-sm font-medium text-destructive" role="alert">{errors[key]}</p> : null;
  const invalid = (key: keyof AuditSchedule) => errors[key] ? "border-destructive focus-visible:ring-destructive" : "";
  const files = (key: "l1Attachments" | "l2Attachments", list: FileList | null) => {
    const selected = Array.from(list ?? []);
    field(key, selected.map(file => file.name));
    const queued = selected.map(file => ({ file, clientReference: crypto.randomUUID() }));
    if (key === "l1Attachments") setL1Files(queued); else setL2Files(queued);
  };
  return <div className="grid gap-4 py-2">
    <div id="schedule-auditTypes"><Label>1. Audit Type *</Label><Select value={form.auditTypes?.[0] ?? ""} disabled={auditTypes.isLoading || ro("auditTypes")} onValueChange={v => field("auditTypes", [v])}><SelectTrigger aria-invalid={!!errors.auditTypes} className={invalid("auditTypes")}><SelectValue placeholder="Select audit type"/></SelectTrigger><SelectContent>{withLegacyOption(auditTypes.options, form.auditTypes?.[0]).map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("auditTypes")}</div>
    <div id="schedule-auditCategory"><Label>2. Audit Category *</Label><Select value={form.auditCategory ?? ""} disabled={auditCategories.isLoading || ro("auditCategory")} onValueChange={v => field("auditCategory", v)}><SelectTrigger aria-invalid={!!errors.auditCategory} className={invalid("auditCategory")}><SelectValue placeholder="Select category"/></SelectTrigger><SelectContent>{withLegacyOption(auditCategories.options, form.auditCategory).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("auditCategory")}</div>
    <div id="schedule-departmentProject">
      <Label>3. Department / Project *</Label>
      <Select
        value={selectedProjectId}
        disabled={projects.isLoading || projects.isError || projectOptions.length === 0 || ro("departmentProject")}
        onValueChange={selectProject}
      >
        <SelectTrigger aria-invalid={!!errors.departmentProject} className={invalid("departmentProject")}>
          <SelectValue placeholder={projects.isLoading ? "Loading projects…" : "Select project"} />
        </SelectTrigger>
        <SelectContent>
          {projectOptions.map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {projects.isError
        ? <p className="mt-1 text-sm text-destructive" role="alert">Projects could not be loaded. Please try again or contact an administrator.</p>
        : !projects.isLoading && projectOptions.length === 0
          ? <p className="mt-1 text-sm text-muted-foreground">No active projects are available. Ask an administrator to add a project in organization settings.</p>
          : null}
      {error("departmentProject")}
    </div>
     <div id="schedule-location"><Label>4. Location (GPS) *</Label><Button type="button" variant="outline" className={`w-full justify-start ${invalid("location")}`} onClick={captureGps} disabled={ro("location")}><MapPin className="mr-2 size-4" />Capture GPS</Button>{form.gpsLat != null && form.gpsLng != null && <p className="mt-2 text-xs text-muted-foreground">{form.gpsLat.toFixed(5)}, {form.gpsLng.toFixed(5)}</p>}{error("location")}</div>
    <div id="schedule-title"><Label>5. Audit Title *</Label><Input aria-invalid={!!errors.title} className={invalid("title")} value={form.title} disabled={ro("title")} onChange={e => field("title", e.target.value)}/>{error("title")}</div>
    <div id="schedule-processProductOwner"><Label>6. Process / Product Owner *</Label><Select value={form.processProductOwner ?? ""} disabled={processOwners.isLoading || ro("processProductOwner")} onValueChange={v => field("processProductOwner", v)}><SelectTrigger aria-invalid={!!errors.processProductOwner} className={invalid("processProductOwner")}><SelectValue placeholder="Select owner"/></SelectTrigger><SelectContent>{withLegacyOption(processOwners.options, form.processProductOwner).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("processProductOwner")}</div>
    <div className="grid grid-cols-2 gap-3"><div id="schedule-plannedStartDate"><Label>7. From Date *</Label><Input aria-invalid={!!errors.plannedStartDate} className={invalid("plannedStartDate")} type="date" value={form.plannedStartDate.slice(0,10)} disabled={ro("plannedStartDate")} onChange={e => field("plannedStartDate", e.target.value)}/>{error("plannedStartDate")}</div><div id="schedule-plannedEndDate"><Label>To Date *</Label><Input aria-invalid={!!errors.plannedEndDate} className={invalid("plannedEndDate")} type="date" value={form.plannedEndDate.slice(0,10)} disabled={ro("plannedEndDate")} onChange={e => field("plannedEndDate", e.target.value)}/>{error("plannedEndDate")}</div></div>
    <div><Label>8. QA/QC Reference *</Label><Input readOnly value={form.qaqcReference ?? ""}/></div>
    <div><Label>9. Audit Number / Site Visit No. *</Label><Input readOnly value={form.auditNumber ?? ""}/></div>
    <div><Label>10. QA/QC Scope *</Label><Input readOnly value={form.qaqcScope ?? ""}/></div>
    <div><Label>11. QA/QC Clauses *</Label><Input readOnly value={form.qaqcClauses ?? ""}/></div>
    <div><Label>12. Remarks{req("remarks") ? " *" : ""}</Label><Textarea value={form.remarks ?? ""} disabled={ro("remarks")} onChange={e => field("remarks", e.target.value)}/></div>
    <div id="schedule-l1Name"><Label>13. Name of L1 *</Label><Select value={form.l1Name ?? ""} disabled={auditLevels.isLoading || ro("l1Name")} onValueChange={v => field("l1Name", v)}><SelectTrigger aria-invalid={!!errors.l1Name} className={invalid("l1Name")}><SelectValue placeholder="Select L1 name"/></SelectTrigger><SelectContent>{withLegacyOption(auditLevels.options, form.l1Name).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("l1Name")}</div>
    <div><Label>14. L1 Review Status *</Label><Select value={form.l1ReviewStatus ?? "Pending"} disabled={ro("l1ReviewStatus")} onValueChange={v => field("l1ReviewStatus", v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Pending">Pending</SelectItem><SelectItem value="Accept">Accept</SelectItem><SelectItem value="Send Back">Send Back</SelectItem></SelectContent></Select></div>
    <div id="schedule-l1ReviewComments"><Label>15. L1 Review Comments {form.l1ReviewStatus === "Send Back" ? "*" : ""}</Label><Textarea aria-invalid={!!errors.l1ReviewComments} className={invalid("l1ReviewComments")} value={form.l1ReviewComments ?? ""} disabled={ro("l1ReviewComments")} onChange={e => field("l1ReviewComments", e.target.value)}/>{error("l1ReviewComments")}</div>
    <div><Label>16. L1 Attachments</Label><div className="flex items-center gap-3"><Button type="button" size="sm" variant="outline" asChild><label><Upload className="mr-2 h-4 w-4" />Add files<input type="file" multiple className="hidden" onChange={e => files("l1Attachments", e.target.files)}/></label></Button>{l1Files.length > 0 && <span className="text-xs text-muted-foreground">{l1Files.length} file{l1Files.length > 1 ? "s" : ""} selected — uploaded on save</span>}</div></div>
    <div id="schedule-l2Name"><Label>17. Name of L2 *</Label><Select value={form.l2Name ?? ""} disabled={auditLevels.isLoading || ro("l2Name")} onValueChange={v => field("l2Name", v)}><SelectTrigger aria-invalid={!!errors.l2Name} className={invalid("l2Name")}><SelectValue placeholder="Select L2 name"/></SelectTrigger><SelectContent>{withLegacyOption(auditLevels.options, form.l2Name).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("l2Name")}</div>
    <div><Label>18. L2 Review Status *</Label><Select value={form.l2ReviewStatus ?? "Pending"} disabled={ro("l2ReviewStatus")} onValueChange={v => field("l2ReviewStatus", v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Pending">Pending</SelectItem><SelectItem value="Accept">Accept</SelectItem><SelectItem value="Send Back">Send Back</SelectItem></SelectContent></Select></div>
    <div id="schedule-l2ReviewComments"><Label>19. L2 Review Comments {form.l2ReviewStatus === "Send Back" ? "*" : ""}</Label><Textarea aria-invalid={!!errors.l2ReviewComments} className={invalid("l2ReviewComments")} value={form.l2ReviewComments ?? ""} disabled={ro("l2ReviewComments")} onChange={e => field("l2ReviewComments", e.target.value)}/>{error("l2ReviewComments")}</div>
    <div><Label>20. L2 Attachments</Label><div className="flex items-center gap-3"><Button type="button" size="sm" variant="outline" asChild><label><Upload className="mr-2 h-4 w-4" />Add files<input type="file" multiple className="hidden" onChange={e => files("l2Attachments", e.target.files)}/></label></Button>{l2Files.length > 0 && <span className="text-xs text-muted-foreground">{l2Files.length} file{l2Files.length > 1 ? "s" : ""} selected — uploaded on save</span>}</div></div>
    <div id="schedule-memoDescription"><Label>21. Memo Description *</Label><Textarea aria-invalid={!!errors.memoDescription} className={invalid("memoDescription")} value={form.memoDescription ?? ""} disabled={ro("memoDescription")} onChange={e => field("memoDescription", e.target.value)}/>{error("memoDescription")}</div>
    <div id="schedule-memoCirculation"><Label>22. Memo Circulation *</Label><Input aria-invalid={!!errors.memoCirculation} className={invalid("memoCirculation")} value={form.memoCirculation ?? ""} disabled={ro("memoCirculation")} onChange={e => field("memoCirculation", e.target.value)}/>{error("memoCirculation")}</div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={create.isPending || update.isPending || evidenceIntent.isPending || confirmEvidence.isPending}>Save schedule</Button></DialogFooter>
  </div>;
}

function Schedules() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [editing, setEditing] = useState<AuditSchedule | undefined>(); const [open, setOpen] = useState(false); const [displaying, setDisplaying] = useState<AuditSchedule | undefined>();
  const query = useListAuditSchedules({ page, limit: PAGE_SIZE }); const qc = useQueryClient(); const { toast } = useToast();
  const remove = useDeleteAuditSchedule(); const submit = useSubmitAuditSchedule(); const review = useReviewAuditSchedule();
  const items = (query.data?.items ?? []).filter(x => x.title.toLowerCase().includes(search.toLowerCase()));
  const done = (message: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] }); toast({ title: message }); };
  const sendBack = (id: string) => { const comments = window.prompt("Send-back remarks (required)"); if (comments?.trim()) review.mutate({ id, data: { decision: "send_back", comments } }, { onSuccess: () => done("Schedule sent back") }); };
  return <div className="space-y-5"><PageHeader title="Annual audit schedules" description="Build, submit and approve the annual audit programme" action={<Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-2 size-4"/>New schedule</Button>}/>
    <Input placeholder="Search schedules…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm"/>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Edit schedule" : "Create schedule"}</DialogTitle></DialogHeader><ScheduleForm initial={editing} onClose={() => setOpen(false)}/></DialogContent></Dialog>
    <Dialog open={!!displaying} onOpenChange={isOpen => !isOpen && setDisplaying(undefined)}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">{displaying && <ScheduleDisplay schedule={displaying} onClose={() => setDisplaying(undefined)}/>}</DialogContent></Dialog>
    <State loading={query.isLoading} error={query.error} empty={!items.length}/>{items.length > 0 && <Card><Table><TableHeader><TableRow><TableHead>Schedule</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id}><TableCell><Button variant="link" className="h-auto p-0 text-left font-semibold" onClick={() => setDisplaying(item)}>{item.title}</Button><div className="text-xs text-muted-foreground">{item.year}</div></TableCell><TableCell>{item.auditTypes?.join(", ") || "—"}</TableCell><TableCell>{date(item.plannedStartDate)} – {date(item.plannedEndDate)}</TableCell><TableCell><Badge variant={workflowTone(item.workflowState)}>{item.workflowState}</Badge></TableCell><TableCell><div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => setDisplaying(item)}>Display</Button>
      {item.workflowState === "Draft" && <><Button size="sm" variant="outline" onClick={() => { setEditing(item); setOpen(true); }}>Edit</Button><Button size="sm" onClick={() => submit.mutate({ id: item.id }, { onSuccess: () => done("Schedule submitted") })}>Submit</Button></>}
      {item.workflowState === "Submitted" && <><Button size="sm" onClick={() => review.mutate({ id: item.id, data: { decision: "approve" } }, { onSuccess: () => done("Schedule approved") })}>Approve</Button><Button size="sm" variant="outline" onClick={() => sendBack(item.id)}>Send back</Button></>}
      <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => window.confirm("Soft-delete this schedule?") && remove.mutate({ id: item.id }, { onSuccess: () => done("Schedule deleted") })}><Trash2 className="size-4"/></Button>
    </div></TableCell></TableRow>)}</TableBody></Table><CardContent><Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/></CardContent></Card>}</div>;
}

function ScheduleDisplay({ schedule, onClose }: { schedule: AuditSchedule; onClose: () => void }) {
  const { toast } = useToast();
  const evidence = useListAuditEvidence({ recordType: "audit_schedule", recordId: schedule.id, page: 1, limit: 100 });
  const [fileActionId, setFileActionId] = useState<string | null>(null);
  const openFile = async (file: EvidenceFile) => {
    if (!file.storageUrl) return;
    const preview = window.open("", "_blank");
    if (!preview) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for QMS360 to open this attachment.", variant: "destructive" });
      return;
    }
    setFileActionId(file.id);
    try {
      const token = localStorage.getItem("qms360_token");
      const response = await fetch(file.storageUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Unable to open ${file.fileName}`);
      const url = URL.createObjectURL(await response.blob());
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview.close();
      toast({ title: "Unable to open attachment", description: errorText(error), variant: "destructive" });
    } finally {
      setFileActionId(null);
    }
  };
  const downloadFile = async (file: EvidenceFile) => {
    if (!file.storageUrl) return;
    setFileActionId(file.id);
    try {
      const token = localStorage.getItem("qms360_token");
      const response = await fetch(file.storageUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Unable to download ${file.fileName}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast({ title: "Unable to download attachment", description: errorText(error), variant: "destructive" });
    } finally {
      setFileActionId(null);
    }
  };
  const attachments = (category: "l1-review" | "l2-review") => (evidence.data?.items ?? []).filter(file => file.category === category);
  const AttachmentList = ({ category, title }: { category: "l1-review" | "l2-review"; title: string }) => {
    const files = attachments(category);
    return <div className="rounded-lg border p-4"><h3 className="font-medium">{title}</h3>
      {evidence.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading attachments…</p>
        : evidence.isError ? <p className="mt-2 text-sm text-destructive">Attachments could not be loaded.</p>
          : files.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No files attached.</p>
            : <div className="mt-3 space-y-2">{files.map(file => <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{file.fileName}</p><p className="text-xs text-muted-foreground">{fileSize(file.sizeBytes)} · {file.status}</p></div><div className="flex gap-2">{file.storageUrl ? <><Button size="sm" variant="outline" disabled={fileActionId === file.id} onClick={() => void openFile(file)}>Open</Button><Button size="sm" disabled={fileActionId === file.id} onClick={() => void downloadFile(file)}><Download className="mr-2 size-4"/>Download</Button></> : <Badge variant="secondary">Not uploaded</Badge>}</div></div>)}</div>}
    </div>;
  };
  const Field = ({ label, value }: { label: string; value?: string | null }) => <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value?.trim() || "—"}</p></div>;
  return <><DialogHeader><DialogTitle>Audit Schedule</DialogTitle><p className="text-sm text-muted-foreground">Read-only schedule details and review attachments.</p></DialogHeader>
    <div className="space-y-6 py-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{schedule.title}</h2><p className="mt-1 text-sm text-muted-foreground">Schedule year {schedule.year}</p></div><Badge variant={workflowTone(schedule.workflowState)}>{schedule.workflowState}</Badge></div>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2"><Field label="Audit type" value={schedule.auditTypes?.join(", ")}/><Field label="Audit category" value={schedule.auditCategory}/><Field label="Department / project" value={schedule.departmentProject}/><Field label="Process / product owner" value={schedule.processProductOwner}/><Field label="Planned dates" value={`${date(schedule.plannedStartDate)} – ${date(schedule.plannedEndDate)}`}/><Field label="Location" value={schedule.location}/><Field label="QA/QC reference" value={schedule.qaqcReference}/><Field label="Audit number / site visit no." value={schedule.auditNumber}/><Field label="QA/QC scope" value={schedule.qaqcScope}/><Field label="QA/QC clauses" value={schedule.qaqcClauses}/><Field label="Remarks" value={schedule.remarks}/><Field label="Memo circulation" value={schedule.memoCirculation}/></div>
      <div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg border p-4"><h3 className="font-medium">L1 review</h3><div className="mt-3 grid gap-3"><Field label="Reviewer" value={schedule.l1Name}/><Field label="Status" value={schedule.l1ReviewStatus}/><Field label="Comments" value={schedule.l1ReviewComments}/></div></div><div className="rounded-lg border p-4"><h3 className="font-medium">L2 review</h3><div className="mt-3 grid gap-3"><Field label="Reviewer" value={schedule.l2Name}/><Field label="Status" value={schedule.l2ReviewStatus}/><Field label="Comments" value={schedule.l2ReviewComments}/></div></div></div>
      <div><h3 className="mb-3 font-medium">Attached files</h3><div className="grid gap-4 md:grid-cols-2"><AttachmentList category="l1-review" title="L1 attachments"/><AttachmentList category="l2-review" title="L2 attachments"/></div></div>
      <Field label="Memo description" value={schedule.memoDescription}/>
    </div>
    <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter></>;
}

function PlanForm({ schedules, onClose }: { schedules: AuditSchedule[]; onClose: () => void }) {
  const [form, setForm] = useState<AuditPlan>({
    id: crypto.randomUUID(), scheduleId: "", auditFeasible: true, auditTitle: "", leadAuditorId: "",
    teamMemberIds: [], auditeeId: "", qaqcScope: "", auditTypes: [],
    auditLanguage: "Verbal: English\nWriting: English", qaqcReference: "", description: "",
    startDateTime: "", endDateTime: "", openingMeetingDateTime: "", closingMeetingDateTime: "",
    activitySection: "Opening Meeting", activityRemarks: "", activityAuditeeId: "",
    activityDateTime: "", auditPlanCirculation: "", status: "Draft",
  });
  const fc = useFieldControls("audit", "plan"); const ro = (key: string) => fc.fieldProps(key).disabled;
  const create = useCreateAuditPlan(); const qc = useQueryClient(); const { toast } = useToast();
  const options = useGetAuditPlanOptions();
  const users = options.data?.users ?? [];
  const approvedSchedules = schedules.filter(schedule => schedule.workflowState === "Approved");
  const set = (key: keyof AuditPlan, value: unknown) => setForm(v => ({ ...v, [key]: value }));
  const selectSchedule = (scheduleId: string) => {
    const schedule = approvedSchedules.find(item => item.id === scheduleId);
    if (!schedule) return;
    setForm(current => ({
      ...current, scheduleId, auditTitle: schedule.title, qaqcScope: schedule.qaqcScope ?? "",
      auditTypes: schedule.auditTypes ?? [], qaqcReference: schedule.qaqcReference ?? "",
    }));
  };
  const selectedTeamNames = form.teamMemberIds.map(id => users.find(user => user.id === id)?.fullName).filter(Boolean);
  const circulationIds = [...new Set([form.leadAuditorId, ...form.teamMemberIds, form.auditeeId].filter(Boolean))];
  const circulation = circulationIds.map(id => users.find(user => user.id === id)?.fullName).filter(Boolean).join(", ");
  const toggleTeamMember = (id: string, checked: boolean) => set("teamMemberIds", checked ? [...form.teamMemberIds, id] : form.teamMemberIds.filter(item => item !== id));
  const save = () => {
    const requiredValues = [
      form.scheduleId, form.auditTitle, form.leadAuditorId, form.auditeeId, form.qaqcScope,
      form.auditLanguage, form.qaqcReference, form.startDateTime, form.endDateTime,
      form.openingMeetingDateTime, form.closingMeetingDateTime, form.activitySection,
      form.activityRemarks, form.activityAuditeeId, form.activityDateTime, circulation,
    ];
    if (requiredValues.some(value => !String(value).trim()) || !form.auditTypes.length || !form.teamMemberIds.length) {
      toast({ title: "Complete all mandatory Audit Plan fields", variant: "destructive" }); return;
    }
    if (new Date(form.endDateTime) < new Date(form.startDateTime)) {
      toast({ title: "End Date & Time must be on or after Start Date & Time", variant: "destructive" }); return;
    }
    if (new Date(form.closingMeetingDateTime) < new Date(form.openingMeetingDateTime)) {
      toast({ title: "Closing Meeting must be on or after Opening Meeting", variant: "destructive" }); return;
    }
    create.mutate({ data: { ...form, auditPlanCirculation: circulation } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/audit/plans"] }); toast({ title: "Audit plan created" }); onClose(); }, onError: e => { toast({ title: "Unable to save", description: errorText(e), variant: "destructive" }); } });
  };
  const activities = ["Opening Meeting", "General Requirement", "Design", "Procurement", "Construction & Installation", "Testing & Commissioning", "Improvements", "Lunch", "Break Time", "Site Visit", "Closing Meeting"] as const;
  return <div className="grid gap-4 py-2">
    <div className="rounded-lg border bg-muted/30 p-4"><Label>Source Audit Schedule *</Label><Select value={form.scheduleId} disabled={ro("scheduleId")} onValueChange={selectSchedule}><SelectTrigger className="mt-2"><SelectValue placeholder="Select an approved schedule"/></SelectTrigger><SelectContent>{approvedSchedules.map(schedule => <SelectItem key={schedule.id} value={schedule.id}>{schedule.title}</SelectItem>)}</SelectContent></Select>{!approvedSchedules.length && <p className="mt-2 text-xs text-muted-foreground">No approved Audit Schedules are available.</p>}</div>
    <div><Label>1. Audit Feasible *</Label><RadioGroup className="mt-2 flex gap-6" value={form.auditFeasible ? "yes" : "no"} disabled={ro("auditFeasible")} onValueChange={value => set("auditFeasible", value === "yes")}><div className="flex items-center gap-2"><RadioGroupItem value="yes" id="plan-feasible-yes"/><Label htmlFor="plan-feasible-yes">Yes</Label></div><div className="flex items-center gap-2"><RadioGroupItem value="no" id="plan-feasible-no"/><Label htmlFor="plan-feasible-no">No</Label></div></RadioGroup></div>
    <div><Label>2. Audit Title *</Label><Input className="mt-2" readOnly value={form.auditTitle} placeholder="Generated from Audit Schedule"/></div>
    <div><Label>3. Lead / Internal Auditor *</Label><Select value={form.leadAuditorId} disabled={options.isLoading || ro("leadAuditorId")} onValueChange={value => set("leadAuditorId", value)}><SelectTrigger className="mt-2"><SelectValue placeholder="Select lead auditor"/></SelectTrigger><SelectContent>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>4. Audit Team *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="mt-2 w-full justify-between font-normal" disabled={options.isLoading || ro("teamMemberIds")}><span className="truncate">{selectedTeamNames.length ? selectedTeamNames.join(", ") : "Select Audit Team"}</span><ChevronDown className="ml-2 size-4 shrink-0"/></Button></DropdownMenuTrigger><DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">{users.map(user => <DropdownMenuCheckboxItem key={user.id} checked={form.teamMemberIds.includes(user.id)} onSelect={event => event.preventDefault()} onCheckedChange={checked => toggleTeamMember(user.id, checked === true)}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu></div>
    <div><Label>5. Auditee *</Label><Select value={form.auditeeId} disabled={options.isLoading || ro("auditeeId")} onValueChange={value => setForm(current => ({ ...current, auditeeId: value, activityAuditeeId: value }))}><SelectTrigger className="mt-2"><SelectValue placeholder="Select auditee"/></SelectTrigger><SelectContent>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>6. QA/QC Scope *</Label><Textarea className="mt-2" readOnly value={form.qaqcScope} placeholder="Prefilled from Audit Schedule"/></div>
    <div><Label>7. Audit Type *</Label><Input className="mt-2" readOnly value={form.auditTypes.join(", ")} placeholder="Prefilled from Audit Schedule"/></div>
    <div><Label>8. Audit Language *</Label><Textarea className="mt-2" readOnly value={form.auditLanguage}/></div>
    <div><Label>9. QA/QC References *</Label><Select value={form.qaqcReference} disabled={!form.scheduleId || ro("qaqcReference")} onValueChange={value => set("qaqcReference", value)}><SelectTrigger className="mt-2"><SelectValue placeholder="Select QA/QC reference"/></SelectTrigger><SelectContent>{form.qaqcReference && <SelectItem value={form.qaqcReference}>{form.qaqcReference}</SelectItem>}</SelectContent></Select></div>
    <div><Label>10. Description of Audit</Label><Textarea className="mt-2" value={form.description ?? ""} disabled={ro("description")} onChange={event => set("description", event.target.value)} placeholder="Optional"/></div>
    <div><Label>11. Start Date & Time *</Label><Input className="mt-2" type="datetime-local" value={form.startDateTime} disabled={ro("startDateTime")} onChange={event => set("startDateTime", event.target.value)}/></div>
    <div><Label>12. End Date & Time *</Label><Input className="mt-2" type="datetime-local" value={form.endDateTime} disabled={ro("endDateTime")} onChange={event => set("endDateTime", event.target.value)}/></div>
    <div><Label>13. Opening Meeting *</Label><Input className="mt-2" type="datetime-local" value={form.openingMeetingDateTime} disabled={ro("openingMeetingDateTime")} onChange={event => set("openingMeetingDateTime", event.target.value)}/></div>
    <div><Label>14. Closing Meeting *</Label><Input className="mt-2" type="datetime-local" value={form.closingMeetingDateTime} disabled={ro("closingMeetingDateTime")} onChange={event => set("closingMeetingDateTime", event.target.value)}/></div>
    <div><Label>15. Activities / Section *</Label><Select value={form.activitySection} disabled={ro("activitySection")} onValueChange={value => set("activitySection", value)}><SelectTrigger className="mt-2"><SelectValue/></SelectTrigger><SelectContent>{activities.map(activity => <SelectItem key={activity} value={activity}>{activity}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>16. Activities / Section Remarks *</Label><Input className="mt-2" value={form.activityRemarks} disabled={ro("activityRemarks")} onChange={event => set("activityRemarks", event.target.value)}/></div>
    <div><Label>17. Auditee for the Activity *</Label><Select value={form.activityAuditeeId} disabled={!form.auditeeId || ro("activityAuditeeId")} onValueChange={value => set("activityAuditeeId", value)}><SelectTrigger className="mt-2"><SelectValue placeholder="Select activity auditee"/></SelectTrigger><SelectContent>{form.auditeeId && <SelectItem value={form.auditeeId}>{users.find(user => user.id === form.auditeeId)?.fullName ?? "Selected auditee"}</SelectItem>}</SelectContent></Select></div>
    <div><Label>18. Date / Time of Activity *</Label><Input className="mt-2" type="datetime-local" value={form.activityDateTime} disabled={ro("activityDateTime")} onChange={event => set("activityDateTime", event.target.value)}/></div>
    <div><Label>19. Audit Plan Circulation *</Label><Textarea className="mt-2" readOnly value={circulation} placeholder="Generated from selected Master users"/></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={create.isPending || options.isLoading}>Create plan</Button></DialogFooter>
  </div>;
}

function Plans() {
  const [page, setPage] = useState(1); const [open, setOpen] = useState(false); const [search, setSearch] = useState("");
  const query = useListAuditPlans({ page, limit: PAGE_SIZE }); const schedules = useListAuditSchedules({ page: 1, limit: 100 }); const share = useShareAuditPlan(); const remove = useDeleteAuditPlan(); const qc = useQueryClient(); const { toast } = useToast();
  const items = (query.data?.items ?? []).filter(x => x.auditTitle.toLowerCase().includes(search.toLowerCase()));
  const refresh = (title: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/plans"] }); toast({ title }); };
  return <div className="space-y-5"><PageHeader title="Audit plans" description="Define the Stage 2 Audit Planning programme" action={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="mr-2 size-4"/>New plan</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Create Audit Plan</DialogTitle></DialogHeader><PlanForm schedules={schedules.data?.items ?? []} onClose={() => setOpen(false)}/></DialogContent></Dialog>}/><Input className="max-w-sm" placeholder="Search audit title…" value={search} onChange={e => setSearch(e.target.value)}/><State loading={query.isLoading} error={query.error} empty={!items.length}/>
    <div className="grid gap-4 md:grid-cols-2">{items.map(plan => <Card key={plan.id}><CardHeader><div className="flex justify-between gap-2"><CardTitle className="text-base">{plan.auditTitle}</CardTitle><Badge variant={workflowTone(plan.status)}>{plan.status}</Badge></div><CardDescription>{date(plan.startDateTime)} · {plan.activitySection}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p><b>Audit type:</b> {plan.auditTypes.join(", ")}</p><p><b>Team:</b> {plan.teamMemberIds.length} member(s)</p><p className="text-muted-foreground">{plan.description || plan.activityRemarks}</p><div className="flex justify-end gap-2"><Button size="sm" onClick={() => share.mutate({ id: plan.id }, { onSuccess: () => refresh("Plan shared") })}><Share2 className="mr-2 size-4"/>Share</Button><Button size="icon" variant="ghost" onClick={() => window.confirm("Soft-delete this plan?") && remove.mutate({ id: plan.id }, { onSuccess: () => refresh("Plan deleted") })}><Trash2 className="size-4"/></Button></div></CardContent></Card>)}</div>{items.length > 0 && <Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/>}</div>;
}

function Audits() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const query = useListAudits({ page, limit: PAGE_SIZE });
  const items = (query.data?.items ?? []).filter(x => x.title.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5"><PageHeader title="Audit execution" description="Open an audit to run meetings, checklist, findings and evidence"/><div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" placeholder="Search audits…" value={search} onChange={e=>setSearch(e.target.value)}/></div><State loading={query.isLoading} error={query.error} empty={!items.length}/><div className="grid gap-4 md:grid-cols-2">{items.map(a => <Card key={a.id}><CardHeader><div className="flex justify-between"><CardTitle className="text-base">{a.title}</CardTitle><Badge variant={workflowTone(a.status)}>{a.status}</Badge></div><CardDescription>Started {date(a.startedAt)}</CardDescription></CardHeader><CardContent className="flex justify-end gap-2"><Button variant="outline" asChild><Link href={`/audit/audits/${a.id}/report`}>Report</Link></Button><Button asChild><Link href={`/audit/audits/${a.id}`}>Open workspace</Link></Button></CardContent></Card>)}</div>{items.length > 0 && <Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/>}</div>;
}

function MeetingEditor({ auditId, kind, value }: { auditId: string; kind: "opening" | "closing"; value?: MeetingMinutes }) {
  const [form, setForm] = useState<MeetingMinutes>(value ?? { heldAt: "", attendees: [], minutes: "" }); const qc = useQueryClient(); const { toast } = useToast();
  const fa = useFieldAccess("audit"); const locked = fa.readOnly("audit-execution", `${kind}Meeting`);
  const opening = useUpdateAuditOpeningMeeting(); const closing = useUpdateAuditClosingMeeting();
  const save = () => { if (!form.heldAt || !form.minutes) { toast({ title: "Date and minutes are required", variant: "destructive" }); return; } const mutation = kind === "opening" ? opening : closing; mutation.mutate({ id: auditId, data: form }, { onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/audit/audits/${auditId}`] }); toast({ title: `${kind === "opening" ? "Opening" : "Closing"} minutes saved` }); } }); };
  return <Card><CardHeader><CardTitle className="capitalize">{kind} meeting minutes</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label>Held at</Label><Input type="datetime-local" value={form.heldAt?.slice(0,16)} disabled={locked} onChange={e=>setForm(v=>({...v,heldAt:e.target.value}))}/></div><div><Label>Attendees (comma separated)</Label><Input value={form.attendees.join(", ")} disabled={locked} onChange={e=>setForm(v=>({...v,attendees:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)}))}/></div><div><Label>Minutes</Label><Textarea rows={8} value={form.minutes} disabled={locked} onChange={e=>setForm(v=>({...v,minutes:e.target.value}))}/></div><Button onClick={save} disabled={locked}>Save minutes</Button></CardContent></Card>;
}

function Checklist({ auditId, initial }: { auditId: string; initial: ChecklistItem[] }) {
  const [items, setItems] = useState(initial); const mutation = useUpdateAuditChecklist(); const qc = useQueryClient(); const { toast } = useToast();
  const results = useLov("checklist_results");
  const add = () => setItems(v => [...v, { id: crypto.randomUUID(), question: "", result: "Not Applicable", notes: "" }]);
  const set = (i: number, key: keyof ChecklistItem, value: string) => setItems(v => v.map((x,n)=>n===i?{...x,[key]:value}:x));
  return <Card><CardHeader><div className="flex justify-between"><div><CardTitle>Interactive checklist</CardTitle><CardDescription>Record clause-level assessment results</CardDescription></div><Button variant="outline" onClick={add}><Plus className="mr-2 size-4"/>Item</Button></div></CardHeader><CardContent className="space-y-3">{items.length === 0 && <p className="py-8 text-center text-muted-foreground">No checklist items. Add the first one.</p>}{items.map((item,i)=><div key={item.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[120px_1fr_180px_1fr_auto]"><Input placeholder="Clause" value={item.clause ?? ""} onChange={e=>set(i,"clause",e.target.value)}/><Input placeholder="Question" value={item.question} onChange={e=>set(i,"question",e.target.value)}/><Select value={item.result} disabled={results.isLoading} onValueChange={v=>set(i,"result",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{withLegacyOption(results.options,item.result).map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select><Input placeholder="Notes" value={item.notes ?? ""} onChange={e=>set(i,"notes",e.target.value)}/><Button size="icon" variant="ghost" onClick={()=>setItems(v=>v.filter((_,n)=>n!==i))}><Trash2 className="size-4"/></Button></div>)}<Button disabled={mutation.isPending} onClick={()=>mutation.mutate({ id:auditId,data:items },{onSuccess:()=>{qc.invalidateQueries({queryKey:[`/api/audit/audits/${auditId}`]});toast({title:"Checklist saved"});}})}>Save checklist</Button></CardContent></Card>;
}

function FindingDialog({ auditId, initial, onClose }: { auditId: string; initial?: AuditFinding; onClose: () => void }) {
  const [form,setForm]=useState<AuditFinding>(initial ?? {id:crypto.randomUUID(),auditId,title:"",description:"",clause:"",classification:"Observation",priority:"P6",riskLevel:"Low",responsibleDepartments:[],status:"Open"});
  const fc=useFieldControls("audit","finding"); const ro=(key:string)=>fc.fieldProps(key).disabled; const req=(key:string)=>fc.fieldProps(key).required;
  const create=useCreateAuditFinding(); const update=useUpdateAuditFinding(); const qc=useQueryClient(); const {toast}=useToast(); const set=(k:keyof AuditFinding,v:unknown)=>setForm(x=>({...x,[k]:v}));
  const classifications=useLov("nc_classifications"); const priorities=useLov("finding_priorities"); const risks=useLov("risk_levels");
  const save=()=>{if(!form.title||!form.description||!form.responsibleDepartments.length){toast({title:"Title, description and department are required",variant:"destructive"});return;}const missing=fc.mandatoryFieldKeys().filter(key=>{const value=(form as unknown as Record<string,unknown>)[key];return Array.isArray(value)?!value.length:value==null||(typeof value==="string"&&!value.trim());});if(missing.length){toast({title:"Complete mandatory fields",description:`Required by your administrator: ${missing.join(", ")}`,variant:"destructive"});return;}const cb={onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/findings"]});toast({title:"Finding saved"});onClose();}};initial?update.mutate({id:initial.id,data:form},cb):create.mutate({data:form},cb)};
  return <div className="grid gap-3"><div><Label>Title *</Label><Input value={form.title} disabled={ro("title")} onChange={e=>set("title",e.target.value)}/></div><div><Label>Description *</Label><Textarea value={form.description} disabled={ro("description")} onChange={e=>set("description",e.target.value)}/></div><div><Label>Clause{req("clause") ? " *" : ""}</Label><Input value={form.clause??""} disabled={ro("clause")} onChange={e=>set("clause",e.target.value)}/></div><div className="grid grid-cols-3 gap-2">{([[classifications,form.classification,"classification"],[priorities,form.priority,"priority"],[risks,form.riskLevel,"riskLevel"]] as const).map(([lov,current,key])=><Select key={key} value={current} disabled={lov.isLoading || ro(key)} onValueChange={v=>set(key,v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{withLegacyOption(lov.options,current).map(x=><SelectItem value={x.value} key={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>)}</div><div><Label>Responsible departments *</Label><Input value={form.responsibleDepartments.join(", ")} disabled={ro("responsibleDepartments")} onChange={e=>set("responsibleDepartments",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save finding</Button></DialogFooter></div>;
}

function Findings({ auditId }: { auditId: string }) {
  const query=useListAuditFindings({page:1,limit:100}); const cars=useListCorrectiveActionReports({page:1,limit:100}); const [open,setOpen]=useState(false); const [edit,setEdit]=useState<AuditFinding>(); const raise=useCreateFindingCars(); const qc=useQueryClient(); const {toast}=useToast();
  const items=(query.data?.items??[]).filter(x=>x.auditId===auditId);
  const raiseCars=(finding:AuditFinding)=>{const existing=new Set((cars.data?.items??[]).filter(c=>c.findingId===finding.id).map(c=>c.responsibleDepartment));const available=finding.responsibleDepartments.filter(d=>!existing.has(d));if(!available.length){toast({title:"CARs already exist for all departments"});return;}raise.mutate({id:finding.id,data:{responsibleDepartments:available}},{onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/cars"]});toast({title:`Raised ${available.length} CAR(s)`});}})};
  return <div className="space-y-4"><div className="flex justify-end"><Button onClick={()=>{setEdit(undefined);setOpen(true)}}><Plus className="mr-2 size-4"/>New finding</Button></div><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{edit?"Edit":"Create"} finding</DialogTitle></DialogHeader><FindingDialog auditId={auditId} initial={edit} onClose={()=>setOpen(false)}/></DialogContent></Dialog><State loading={query.isLoading} error={query.error} empty={!items.length}/>{items.map(f=><Card key={f.id}><CardContent className="pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2"><Badge>{f.classification}</Badge><Badge variant="outline">{f.priority}</Badge><Badge variant={f.riskLevel==="High"?"destructive":"secondary"}>{f.riskLevel} risk</Badge></div><h3 className="mt-3 font-semibold">{f.title}</h3><p className="mt-1 text-sm text-muted-foreground">{f.description}</p><p className="mt-2 text-xs">Departments: {f.responsibleDepartments.join(", ")}</p><p className="mt-1 text-xs text-muted-foreground">Existing CARs: {(cars.data?.items??[]).filter(c=>c.findingId===f.id).map(c=>c.responsibleDepartment).join(", ")||"None"}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>{setEdit(f);setOpen(true)}}>Edit</Button>{f.classification.includes("NC")&&<Button size="sm" onClick={()=>raiseCars(f)}>Raise CAR</Button>}</div></div></CardContent></Card>)}</div>;
}

function Evidence({ auditId }: { auditId: string }) {
  const query=useListAuditEvidence({recordType:"audit",recordId:auditId,page:1,limit:100}); const intent=useCreateAuditEvidenceIntent(); const confirm=useConfirmAuditEvidence(); const qc=useQueryClient(); const {toast}=useToast();
  const upload=async(file:File)=>{const max=file.type.startsWith("video/")?200:file.type.startsWith("image/")?8:25;if(file.size>max*1024*1024){toast({title:`File exceeds ${max}MB limit`,variant:"destructive"});return;}intent.mutate({data:{recordType:"audit",recordId:auditId,category:file.type.split("/")[0]||"document",fileName:file.name,mimeType:file.type||"application/octet-stream",sizeBytes:file.size,clientReference:crypto.randomUUID()}},{onSuccess:async data=>{try{const response=await fetch(data.uploadUrl,{method:"PUT",body:file,headers:{"Content-Type":file.type||"application/octet-stream"}});if(!response.ok)throw new Error("Storage upload failed");confirm.mutate({id:data.id},{onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/evidence"]});toast({title:"Evidence uploaded"});}})}catch(e){toast({title:"Upload failed",description:errorText(e),variant:"destructive"})}}})};
  return <Card><CardHeader><div className="flex justify-between"><div><CardTitle>Evidence files</CardTitle><CardDescription>Photos ≤8MB · video ≤200MB / 3min · documents ≤25MB</CardDescription></div><Button asChild><Label className="cursor-pointer"><Upload className="mr-2 size-4"/>Upload<input className="hidden" type="file" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></Label></Button></div></CardHeader><CardContent><State loading={query.isLoading} error={query.error} empty={!query.data?.items.length}/><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{query.data?.items.map(file=><div key={file.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="rounded bg-muted p-2"><FileText className="size-5"/></div><div className="min-w-0"><p className="truncate text-sm font-medium">{file.fileName}</p><p className="text-xs text-muted-foreground">{(file.sizeBytes/1024/1024).toFixed(1)}MB · {file.status}</p></div></div>)}</div></CardContent></Card>;
}

function AuditWorkspace() {
  const {id=""}=useParams<{id:string}>(); const query=useGetAudit(id);
  if(query.isLoading||query.error||!query.data)return <div className="space-y-4"><Button variant="ghost" asChild><Link href="/audit/audits"><ArrowLeft className="mr-2 size-4"/>Audits</Link></Button><State loading={query.isLoading} error={query.error} empty={!query.data}/></div>;
  const audit=query.data;
  return <div className="space-y-5"><Button variant="ghost" asChild><Link href="/audit/audits"><ArrowLeft className="mr-2 size-4"/>All audits</Link></Button><PageHeader title={audit.title} description={`Execution workspace · ${audit.status}`} action={<Button variant="outline" asChild><Link href={`/audit/audits/${id}/report`}>View report</Link></Button>}/><Tabs defaultValue="overview"><TabsList className="h-auto flex-wrap"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="checklist">Checklist</TabsTrigger><TabsTrigger value="opening">Opening meeting</TabsTrigger><TabsTrigger value="closing">Closing meeting</TabsTrigger><TabsTrigger value="findings">Findings</TabsTrigger><TabsTrigger value="evidence">Evidence</TabsTrigger></TabsList>
    <TabsContent value="overview"><Card><CardHeader><CardTitle>Audit overview</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><div><Label>Status</Label><p><Badge>{audit.status}</Badge></p></div><div><Label>Project</Label><p>{audit.projectId}</p></div><div><Label>Plan</Label><p>{audit.planId}</p></div><div><Label>Started</Label><p>{date(audit.startedAt)}</p></div><div><Label>Closed</Label><p>{date(audit.closedAt)}</p></div><div><Label>Checklist</Label><p>{audit.checklist?.length??0} items</p></div></CardContent></Card></TabsContent>
    <TabsContent value="checklist"><Checklist auditId={id} initial={audit.checklist??[]}/></TabsContent><TabsContent value="opening"><MeetingEditor auditId={id} kind="opening" value={audit.openingMeeting}/></TabsContent><TabsContent value="closing"><MeetingEditor auditId={id} kind="closing" value={audit.closingMeeting}/></TabsContent><TabsContent value="findings"><Findings auditId={id}/></TabsContent><TabsContent value="evidence"><Evidence auditId={id}/></TabsContent></Tabs></div>;
}

function CarEditor({car,onClose}:{car:CorrectiveActionReport;onClose:()=>void}) {
  const [form,setForm]=useState(car);const mutation=useUpdateCorrectiveActionReport();const qc=useQueryClient();const {toast}=useToast();
  const fc=useFieldControls("audit","car"); const ro=(key:string)=>fc.fieldProps(key).disabled; const req=(key:string)=>fc.fieldProps(key).required;
  const save=()=>{const missing=fc.mandatoryFieldKeys().filter(key=>{const value=(form as unknown as Record<string,unknown>)[key];return value==null||(typeof value==="string"&&!value.trim());});if(missing.length){toast({title:"Complete mandatory fields",description:`Required by your administrator: ${missing.join(", ")}`,variant:"destructive"});return;}mutation.mutate({id:car.id,data:form},{onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/cars"]});toast({title:"CAR updated"});onClose();}})};
  return <div className="space-y-3"><div><Label>Root cause{req("rootCause") ? " *" : ""}</Label><Textarea value={form.rootCause??""} disabled={ro("rootCause")} onChange={e=>setForm(v=>({...v,rootCause:e.target.value}))}/></div><div><Label>Correction{req("correction") ? " *" : ""}</Label><Textarea value={form.correction??""} disabled={ro("correction")} onChange={e=>setForm(v=>({...v,correction:e.target.value}))}/></div><div><Label>Corrective action{req("correctiveAction") ? " *" : ""}</Label><Textarea value={form.correctiveAction??""} disabled={ro("correctiveAction")} onChange={e=>setForm(v=>({...v,correctiveAction:e.target.value}))}/></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save response</Button></DialogFooter></div>;
}

function Cars() {
  const [page,setPage]=useState(1);const [status,setStatus]=useState("all");const [edit,setEdit]=useState<CorrectiveActionReport>();const query=useListCorrectiveActionReports({page,limit:PAGE_SIZE,...(status==="all"?{}:{status})});const qc=useQueryClient();const {toast}=useToast();
  const submit=useSubmitCorrectiveActionReport(),review=useReviewCorrectiveActionReport(),extension=useRequestCarExtension(),extensionReview=useReviewCarExtension(),extensionCancel=useCancelCarExtension(),close=useCloseCorrectiveActionReport();
  const refresh=(title:string)=>{qc.invalidateQueries({queryKey:["/api/audit/cars"]});toast({title})};
  const requestExtension=(id:string)=>{const requestedDueDate=window.prompt("New due date (YYYY-MM-DD)");if(!requestedDueDate)return;const reason=window.prompt("Justification (required)");if(!reason?.trim()){toast({title:"Justification is required",variant:"destructive"});return;}extension.mutate({id,data:{requestedDueDate,reason}},{onSuccess:()=>refresh("Extension requested")})};
  return <div className="space-y-5"><PageHeader title="Corrective Action Register" description="Track ownership, response, review, extensions and closure"/><Select value={status} onValueChange={v=>{setStatus(v);setPage(1)}}><SelectTrigger className="w-52"><SelectValue/></SelectTrigger><SelectContent>{["all","Open","Draft","Submitted","Accepted","Rejected","Extension Requested","Closed"].map(x=><SelectItem key={x} value={x}>{x==="all"?"All statuses":x}</SelectItem>)}</SelectContent></Select><State loading={query.isLoading} error={query.error} empty={!query.data?.items.length}/><Dialog open={!!edit} onOpenChange={v=>!v&&setEdit(undefined)}><DialogContent><DialogHeader><DialogTitle>CAR response</DialogTitle></DialogHeader>{edit&&<CarEditor car={edit} onClose={()=>setEdit(undefined)}/>}</DialogContent></Dialog>
    <div className="space-y-3">{query.data?.items.map(car=>{const overdue=car.status!=="Closed"&&new Date(car.dueDate)<new Date();return <Card key={car.id} className={overdue?"border-destructive":""}><CardContent className="pt-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge variant={workflowTone(car.status)}>{car.status}</Badge>{overdue&&<Badge variant="destructive">Overdue · priority may auto-upgrade</Badge>}{car.extensionStatus&&<Badge variant="outline">Extension {car.extensionStatus}</Badge>}</div><h3 className="mt-3 font-semibold">{car.responsibleDepartment}</h3><p className="text-sm text-muted-foreground">Due {date(car.dueDate)} · Owner {car.ownerId}</p><p className="mt-2 text-sm"><b>Root cause:</b> {car.rootCause||"Not provided"}</p></div><div className="flex max-w-lg flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={()=>setEdit(car)}>Edit response</Button>{["Open","Draft","Rejected"].includes(car.status)&&<Button size="sm" onClick={()=>submit.mutate({id:car.id},{onSuccess:()=>refresh("CAR submitted")})}>Submit</Button>}{car.status==="Submitted"&&<><Button size="sm" onClick={()=>review.mutate({id:car.id,data:{decision:"accept"}},{onSuccess:()=>refresh("CAR accepted")})}>Accept</Button><Button size="sm" variant="outline" onClick={()=>{const comments=window.prompt("Rejection remarks");review.mutate({id:car.id,data:{decision:"reject",comments}},{onSuccess:()=>refresh("CAR rejected")})}}>Reject</Button></>}{car.status==="Accepted"&&car.extensionStatus!=="pending"&&<Button size="sm" variant="outline" onClick={()=>requestExtension(car.id)}>Extension</Button>}{car.extensionStatus==="pending"&&<><Button size="sm" onClick={()=>extensionReview.mutate({id:car.id,data:{decision:"approve"}},{onSuccess:()=>refresh("Extension approved")})}>Approve extension</Button><Button size="sm" variant="outline" onClick={()=>{const comments=window.prompt("Rejection remarks (required)");if(!comments?.trim())return;extensionReview.mutate({id:car.id,data:{decision:"reject",comments}},{onSuccess:()=>refresh("Extension rejected")})}}>Reject extension</Button><Button size="sm" variant="ghost" onClick={()=>window.confirm("Withdraw this extension request? The CAR returns to its previous step.")&&extensionCancel.mutate({id:car.id},{onSuccess:()=>refresh("Extension withdrawn")})}>Withdraw</Button></>}{car.status==="Accepted"&&<Button size="sm" onClick={()=>window.confirm("Verify effectiveness and close this CAR?")&&close.mutate({id:car.id},{onSuccess:()=>refresh("CAR closed")})}>Close</Button>}</div></div></CardContent></Card>})}</div>{query.data?.items.length?<Pager page={page} total={query.data.total} onPage={setPage}/>:null}</div>;
}

const reportCards=[["Open vs closed audits","open-vs-closed"],["Findings log","findings-log"],["Audit ageing","ageing"],["CAR status & closure","car-status"],["Annual audit schedule","schedule"]];
function Reports() {
  return <div className="space-y-5"><PageHeader title="Report centre" description="Operational audit reports and export files"/><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{reportCards.map(([title,path])=><Card key={path}><CardHeader><div className="mb-2 w-fit rounded-lg bg-accent p-2 text-accent-foreground"><BarChart3 className="size-5"/></div><CardTitle className="text-base">{title}</CardTitle><CardDescription>Current live audit workspace data</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full" asChild><a href={`/api/audit/reports/${path}?format=csv`} download><Download className="mr-2 size-4"/>Download CSV</a></Button></CardContent></Card>)}</div></div>;
}

function AuditReport() {
  const {id=""}=useParams<{id:string}>();const query=useGetGeneratedAuditReport(id);
  if(query.isLoading||query.error||!query.data)return <State loading={query.isLoading} error={query.error} empty={!query.data}/>;
  const r=query.data;
  return <div className="space-y-5 print:p-0"><div className="flex justify-between print:hidden"><Button variant="ghost" asChild><Link href={`/audit/audits/${id}`}><ArrowLeft className="mr-2 size-4"/>Workspace</Link></Button><div className="flex gap-2"><Button variant="outline" asChild><a href={`/api/audit/audits/${id}/report?format=csv`} download><Download className="mr-2 size-4"/>CSV</a></Button><Button onClick={()=>window.print()}><Printer className="mr-2 size-4"/>Print</Button></div></div><Card><CardHeader className="border-b bg-primary text-primary-foreground"><CardTitle className="text-2xl">Audit Report</CardTitle><CardDescription className="text-primary-foreground/80">Generated {new Date(r.generatedAt).toLocaleString()}</CardDescription></CardHeader><CardContent className="space-y-8 pt-6"><section><h2 className="text-xl font-semibold">{r.audit.title}</h2><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><b>Status:</b> {r.audit.status}</p><p><b>Project:</b> {r.audit.projectId}</p><p><b>Started:</b> {date(r.audit.startedAt)}</p></div></section>
    <section className="grid gap-4 md:grid-cols-2">{[["Opening meeting",r.audit.openingMeeting],["Closing meeting",r.audit.closingMeeting]].map(([name,m])=>{const meeting=m as MeetingMinutes|undefined;return <div key={name as string} className="rounded-lg border p-4"><h3 className="font-semibold">{name as string}</h3>{meeting?<><p className="mt-1 text-sm">{date(meeting.heldAt)} · {meeting.attendees.join(", ")}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{meeting.minutes}</p></>:<p className="mt-2 text-sm text-muted-foreground">Not recorded.</p>}</div>})}</section>
    <section><h3 className="mb-3 font-semibold">Findings</h3>{r.findings.length?<Table><TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Classification</TableHead><TableHead>Priority / Risk</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{r.findings.map(f=><TableRow key={f.id}><TableCell><b>{f.title}</b><p className="text-xs text-muted-foreground">{f.description}</p></TableCell><TableCell>{f.classification}</TableCell><TableCell>{f.priority} / {f.riskLevel}</TableCell><TableCell>{f.status}</TableCell></TableRow>)}</TableBody></Table>:<p className="text-sm text-muted-foreground">No findings.</p>}</section>
    <section><h3 className="mb-3 font-semibold">Corrective Action Reports</h3>{r.cars.length?<Table><TableHeader><TableRow><TableHead>Department</TableHead><TableHead>Due</TableHead><TableHead>Root cause</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{r.cars.map(c=><TableRow key={c.id}><TableCell>{c.responsibleDepartment}</TableCell><TableCell>{date(c.dueDate)}</TableCell><TableCell>{c.rootCause||"—"}</TableCell><TableCell>{c.status}</TableCell></TableRow>)}</TableBody></Table>:<p className="text-sm text-muted-foreground">No CARs.</p>}</section></CardContent></Card></div>;
}

function Missing() { return <Card><CardContent className="py-14 text-center"><XCircle className="mx-auto mb-3 size-8 text-muted-foreground"/><h2 className="font-semibold">Audit page not found</h2><Button className="mt-4" asChild><Link href="/audit">Return to dashboard</Link></Button></CardContent></Card>; }

export function AuditRoutes() {
  return <Layout><Switch>
    <Route path="/audit" component={Dashboard}/>
    <Route path="/audit/schedules" component={Schedules}/>
    <Route path="/audit/plans" component={Plans}/>
    <Route path="/audit/audits/:id/report" component={AuditReport}/>
    <Route path="/audit/audits/:id" component={AuditWorkspace}/>
    <Route path="/audit/audits" component={Audits}/>
    <Route path="/audit/cars" component={Cars}/>
    <Route path="/audit/reports" component={Reports}/>
    <Route><Missing/></Route>
  </Switch></Layout>;
}