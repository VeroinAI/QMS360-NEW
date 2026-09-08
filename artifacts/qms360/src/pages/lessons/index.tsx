import { useMemo, useState } from "react";
import { Link, Route, Switch } from "wouter";
import { AlertTriangle, BookOpen, Download, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  exportLessonsLog,
  useDeleteLessonForm,
  useGetLessonsEscalations,
  useGetLessonsReferenceData,
  useSearchLessonsLog,
} from "@workspace/api-client-react";
import type { LessonLearnedForm } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { LessonFormPage } from "./lesson-form";
import { AiEntryPage } from "./ai-entry";
import { LoadState, PageHeader, StateBadge, errorMessage } from "./common";
import { useLov } from "@/lib/use-lov";
import { LessonsNotificationsPage } from "@/pages/notifications";

const PAGE_SIZE = 10;

function download(url?: string | null) {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
  else toast({ title: "Report queued", description: "The report will be delivered when ready." });
}

function LessonActions() {
  return <>
    <Button variant="outline" asChild><Link href="/lessons/ai-entry"><Sparkles /> Describe it</Link></Button>
    <Button asChild><Link href="/lessons/new"><Plus /> New lesson</Link></Button>
  </>;
}

function HomePage() {
  const log = useSearchLessonsLog({ page: 1, limit: 20 });
  const escalations = useGetLessonsEscalations({ page: 1, limit: 100 });
  const lessons = log.data?.items ?? [];
  const active = escalations.data?.items.filter((e) => e.status === "open") ?? [];
  const metrics = [
    ["Total lessons", log.data?.total ?? 0, BookOpen],
    ["Pending approval", lessons.filter((x) => x.workflowState === "Submitted").length, BookOpen],
    ["Major + Negative open", lessons.filter((x) => x.issueCategory === "Major" && x.impact === "Negative" && x.workflowState !== "Approved").length, AlertTriangle],
    ["Active escalations", active.length, AlertTriangle],
  ] as const;
  return <div>
    <PageHeader title="Lesson Learned" description="Capture experience. Share knowledge. Prevent recurrence." actions={<LessonActions />} />
    <LoadState loading={log.isLoading || escalations.isLoading} error={log.error || escalations.error} empty={false}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon]) => <Card key={label}><CardContent className="flex items-center justify-between py-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p></div><div className="rounded-xl bg-accent/10 p-3 text-accent"><Icon /></div></CardContent></Card>)}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader className="flex-row items-center justify-between"><CardTitle>Recent lessons</CardTitle><Button variant="ghost" asChild><Link href="/lessons/log">View knowledge base</Link></Button></CardHeader><CardContent>
          {lessons.length === 0 ? <p className="py-8 text-center text-muted-foreground">No lessons have been captured.</p> : <div className="space-y-3">{lessons.slice(0, 5).map((lesson) => <LessonRow key={lesson.id} lesson={lesson} escalated={active.some((e) => e.recordId === lesson.id)} />)}</div>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Escalation summary</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-4"><p className="font-semibold">Major + Negative</p><p className="text-2xl font-bold text-primary">2 days</p><p className="text-sm text-muted-foreground">to P1 escalation</p></div>
          <div className="rounded-lg border border-border p-4"><p className="font-semibold">All other combinations</p><p className="text-2xl font-bold">5 days</p><p className="text-sm text-muted-foreground">to P1 escalation</p></div>
          <p className="text-xs text-muted-foreground">Unresolved P1 escalates to L1 after 3 days, then L2 after 3 further days.</p>
        </CardContent></Card>
      </div>
    </LoadState>
  </div>;
}

function LessonRow({ lesson, escalated }: { lesson: LessonLearnedForm; escalated: boolean }) {
  return <Link href={`/lessons/${lesson.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50">
    <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-semibold">{lesson.title}</p>{lesson.version > 1 && <Badge variant="outline">v{lesson.version}</Badge>}</div><p className="text-sm text-muted-foreground">{lesson.referenceNumber} · {lesson.issueCategory} · {new Date(lesson.capturedAt).toLocaleDateString()}</p></div>
    <div className="flex gap-2">{escalated && <Badge variant="destructive">Escalated</Badge>}<StateBadge state={lesson.workflowState} /></div>
  </Link>;
}

function LogPage() {
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [disciplineId, setDisciplineId] = useState("all");
  const [category, setCategory] = useState("all");
  const [impact, setImpact] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const params = useMemo(() => ({ search: search || undefined, projectId: projectId === "all" ? undefined : projectId, disciplineId: disciplineId === "all" ? undefined : disciplineId, category: category === "all" ? undefined : category, impact: impact === "all" ? undefined : impact as "Positive" | "Negative", from: from || undefined, to: to || undefined, page, limit: PAGE_SIZE }), [search, projectId, disciplineId, category, impact, from, to, page]);
  const log = useSearchLessonsLog(params);
  const refs = useGetLessonsReferenceData();
  const categories = useLov("lesson_issue_categories");
  const impacts = useLov("lesson_impacts");
  const disciplines = useLov("disciplines");
  const escalations = useGetLessonsEscalations({ page: 1, limit: 200 });
  const queryClient = useQueryClient();
  const projectNames = new Map(refs.data?.projects.map((project) => [project.id, project.name]) ?? []);
  const remove = useDeleteLessonForm({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/lessons/log"] }); toast({ title: "Lesson deleted" }); }, onError: (e) => toast({ title: "Delete failed", description: errorMessage(e), variant: "destructive" }) } });
  const activeIds = new Set(escalations.data?.items.filter((e) => e.status === "open").map((e) => e.recordId));
  async function exportCsv() { try { download((await exportLessonsLog({ format: "csv" })).downloadUrl); } catch (e) { toast({ title: "Export failed", description: errorMessage(e), variant: "destructive" }); } }
  return <div>
    <PageHeader title="Lesson Learned Log" description="Search the organisation's shared knowledge base." back="/lessons" actions={<><Button variant="outline" onClick={exportCsv}><Download /> Export CSV</Button><LessonActions /></>} />
    <Card className="mb-5"><CardContent className="grid gap-3 pt-6 md:grid-cols-2 xl:grid-cols-4">
      <div className="relative md:col-span-2"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search title, reference or content…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
      <div className="space-y-1.5"><Label>Project</Label><Select value={projectId} onValueChange={(v) => { setProjectId(v); setPage(1); }}><SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{refs.data?.projects.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Discipline</Label><Select value={disciplineId} onValueChange={(v) => { setDisciplineId(v); setPage(1); }} disabled={disciplines.isLoading}><SelectTrigger><SelectValue placeholder="Discipline" /></SelectTrigger><SelectContent><SelectItem value="all">All disciplines</SelectItem>{disciplines.options.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></div>
       <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }} disabled={categories.isLoading}><SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.options.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>
       <Select value={impact} onValueChange={(v) => { setImpact(v); setPage(1); }} disabled={impacts.isLoading}><SelectTrigger><SelectValue placeholder="Impact" /></SelectTrigger><SelectContent><SelectItem value="all">All impacts</SelectItem>{impacts.options.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>
      <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
      <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
    </CardContent></Card>
    <LoadState loading={log.isLoading} error={log.error} empty={!log.data?.items.length}>
      <Card><Table><TableHeader><TableRow><TableHead>Lesson</TableHead><TableHead>Project</TableHead><TableHead>Discipline</TableHead><TableHead>Category</TableHead><TableHead>Impact</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>
        {log.data?.items.map((lesson) => <TableRow key={lesson.id}><TableCell><Link href={`/lessons/${lesson.id}`} className="font-semibold text-primary hover:underline">{lesson.title}</Link><p className="text-xs text-muted-foreground">{lesson.referenceNumber}{activeIds.has(lesson.id) && <Badge variant="destructive" className="ml-2">Escalated</Badge>}</p></TableCell><TableCell>{projectNames.get(lesson.projectId) ?? "Unknown project"}</TableCell><TableCell>{lesson.disciplineId || "—"}</TableCell><TableCell>{lesson.issueCategory}</TableCell><TableCell>{lesson.impact}</TableCell><TableCell><StateBadge state={lesson.workflowState} /></TableCell><TableCell>{new Date(lesson.capturedAt).toLocaleDateString()}</TableCell><TableCell>
          <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Delete lesson"><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this lesson?</AlertDialogTitle><AlertDialogDescription>This soft-deletes the lesson and removes it from active lists.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove.mutate({ id: lesson.id })}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </TableCell></TableRow>)}
      </TableBody></Table></Card>
      <div className="mt-4 flex items-center justify-between"><p className="text-sm text-muted-foreground">{log.data?.total ?? 0} results</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="outline" disabled={page * PAGE_SIZE >= (log.data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div>
    </LoadState>
  </div>;
}

export function LessonsRoutes() {
  return <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8"><Switch>
    <Route path="/lessons" component={HomePage} />
    <Route path="/lessons/log" component={LogPage} />
    <Route path="/lessons/notifications" component={LessonsNotificationsPage} />
    <Route path="/lessons/new"><LessonFormPage /></Route>
    <Route path="/lessons/ai-entry" component={AiEntryPage} />
    <Route path="/lessons/:id">{(params) => <LessonFormPage id={params.id} />}</Route>
  </Switch></main>;
}