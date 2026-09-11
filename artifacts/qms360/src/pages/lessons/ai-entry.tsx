import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAnswerLessonPromptQuestion, useCreateLessonForm, useGetLessonsReferenceData, usePromptToLessonTransaction } from "@workspace/api-client-react";
import type { LessonLearnedForm, MissingField, PromptTransaction } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { VerionBadge, VerionCard, VerionWordmark } from "@/components/verion-ai";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { PageHeader, errorMessage } from "./common";
import { useLov } from "@/lib/use-lov";
import { useFieldControls } from "@/lib/field-controls";

type Extracted = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : "";

export function AiEntryPage() {
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [transaction, setTransaction] = useState<PromptTransaction | null>(null);
  const [extracted, setExtracted] = useState<Extracted>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The AI-assisted draft honors the same field matrix as the standard lesson form.
  const fieldControls = useFieldControls("lessons", "lesson-form");
  const fp = (key: string) => fieldControls.fieldProps(key);
  const refs = useGetLessonsReferenceData();
  const disciplines = useLov("disciplines");
  const categorisations = useLov("lesson_categorisations");
  const issueCategories = useLov("lesson_issue_categories");
  const impacts = useLov("lesson_impacts");
  const queryClient = useQueryClient();
  const generate = usePromptToLessonTransaction({
    mutation: {
      onSuccess: (result) => { setTransaction(result); setExtracted(result.extracted); },
      onError: (e) => toast({ title: "VerionAI extraction failed", description: errorMessage(e), variant: "destructive" }),
    },
  });
  const answer = useAnswerLessonPromptQuestion({
    mutation: {
      onSuccess: (result) => { setTransaction(result); setExtracted(result.extracted); },
      onError: (e) => toast({ title: "Answer could not be saved", description: errorMessage(e), variant: "destructive" }),
    },
  });
  const create = useCreateLessonForm({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/lessons/log"] }); toast({ title: "VerionAI-assisted lesson created", description: "Review it in the Lesson Learned Log before submission." }); navigate("/lessons/log"); },
      onError: (e) => toast({ title: "Lesson could not be created", description: errorMessage(e), variant: "destructive" }),
    },
  });

  function update(field: string, value: string) { setExtracted((x) => ({ ...x, [field]: value })); }
  function submitAnswer(item: MissingField) {
    const value = answers[item.field];
    if (!transaction || !value?.trim()) { toast({ title: "Answer required" }); return; }
    answer.mutate({ sessionId: transaction.sessionId, data: { field: item.field, value } });
  }
  function createLesson() {
    const required = ["title","projectId","disciplineId","categorisationId","description","rootCause","correction","correctiveAction"];
    const missing = required.filter((field) => !text(extracted[field]).trim());
    if (missing.length) { toast({ title: "Complete the preview", description: `Required fields are missing: ${missing.join(", ")}`, variant: "destructive" }); return; }
    const rendered = ["title","projectId","disciplineId","categorisationId","issueCategory","impact","description","rootCause","correction","correctiveAction"];
    const mandatoryMissing = fieldControls.mandatoryFieldKeys().filter((field) => rendered.includes(field) && !required.includes(field) && !text(extracted[field]).trim());
    if (mandatoryMissing.length) { toast({ title: "Complete the preview", description: `Required by your administrator: ${mandatoryMissing.join(", ")}`, variant: "destructive" }); return; }
    const data = {
      title: text(extracted.title), projectId: text(extracted.projectId), disciplineId: text(extracted.disciplineId),
      categorisationId: text(extracted.categorisationId), issueCategory: text(extracted.issueCategory) || "Minor",
      impact: text(extracted.impact) || "Negative", description: text(extracted.description), rootCause: text(extracted.rootCause),
      correction: text(extracted.correction), correctiveAction: text(extracted.correctiveAction),
      reference: text(extracted.reference), remarks: text(extracted.remarks),
      isRepeatedIssue: extracted.isRepeatedIssue === true || text(extracted.isRepeatedIssue).toLowerCase() === "true",
      repeatCount: Number(extracted.repeatCount ?? 0), repeatLocation: text(extracted.repeatLocation),
      approverId: text(extracted.approverId) || undefined,
      gpsLat: typeof extracted.gpsLat === "number" ? extracted.gpsLat : undefined,
      gpsLng: typeof extracted.gpsLng === "number" ? extracted.gpsLng : undefined,
      capturedAt: text(extracted.capturedAt) || new Date().toISOString(),
    } as LessonLearnedForm;
    create.mutate({ data });
  }
  function continueInForm() {
    sessionStorage.setItem("verionai-lessons-draft", JSON.stringify(extracted));
    navigate("/lessons/new?from=verionai");
  }
  function missingOptions(item: MissingField) {
    if (item.field === "projectId") return refs.data?.projects.map((option) => ({ value: option.id, label: option.name })) ?? [];
    if (item.field === "disciplineId") return disciplines.options;
    if (item.field === "categorisationId") return categorisations.options;
    if (item.field === "issueCategory") return issueCategories.options;
    if (item.field === "impact") return impacts.options;
    return item.options.map((option) => ({ value: option, label: option }));
  }

  return <div>
    <PageHeader title="VerionAI Entry" description="Turn a plain-language site experience into a structured lesson." back="/lessons" />
    <VerionCard title={<VerionWordmark suffix="Entry" />}>
      <p className="mb-4 text-sm text-muted-foreground">VerionAI extracts a draft; you remain in control.</p>
      <Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what happened, where, the impact, root cause, and what should be done differently…" />
      <div className="mt-3 flex items-center justify-between"><p className="text-xs text-muted-foreground">Nothing is created until you review and confirm the structured form.</p><Button onClick={() => generate.mutate({ data: { prompt } })} disabled={!prompt.trim() || generate.isPending}>{generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Build draft</Button></div>
    </VerionCard>

    {transaction && <>
      <div className="mt-6 rounded-xl border border-[#b52865]/20 bg-[#fceaf3]/50 p-4 dark:bg-[#b52865]/10">
        {transaction.missing.length > 0 ? <>
          <VerionBadge>Additional information required</VerionBadge>
          <p className="mt-2 text-sm font-medium">VerionAI needs {transaction.missing.length} more {transaction.missing.length === 1 ? "detail" : "details"} before this lesson is complete.</p>
          <p className="mt-1 text-sm text-muted-foreground">Add the information below, update your original prompt and build the draft again, or continue to the Lessons Learned form and complete the highlighted mandatory fields there.</p>
        </> : <>
          <VerionBadge>Required inputs validated</VerionBadge>
          <p className="mt-2 text-sm">VerionAI found all mandatory information needed for a lesson draft. Review the extracted values before creating it.</p>
        </>}
        <Button type="button" variant="outline" className="mt-3" onClick={continueInForm}>
          Continue in Lessons Learned form
        </Button>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2"><CardHeader className="flex-row items-center justify-between"><CardTitle>Structured preview</CardTitle><VerionBadge>VerionAI Assembled</VerionBadge></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Edit label="Title" value={text(extracted.title)} onChange={(v) => update("title", v)} wide disabled={fp("title").disabled} required={fp("title").required} />
        <Choice label="Project" value={text(extracted.projectId)} onChange={(v) => update("projectId", v)} options={refs.data?.projects.map((x) => ({ value: x.id, label: x.name })) ?? []} disabled={fp("projectId").disabled} required={fp("projectId").required} />
        <Choice label="Discipline" value={text(extracted.disciplineId)} onChange={(v) => update("disciplineId", v)} options={disciplines.options} disabled={fp("disciplineId").disabled} required={fp("disciplineId").required} />
        <Choice label="Categorisation" value={text(extracted.categorisationId)} onChange={(v) => update("categorisationId", v)} options={categorisations.options} disabled={fp("categorisationId").disabled} required={fp("categorisationId").required} />
         <Choice label="Issue category" value={text(extracted.issueCategory)} onChange={(v) => update("issueCategory", v)} options={issueCategories.options} disabled={fp("issueCategory").disabled} required={fp("issueCategory").required} />
         <Choice label="Impact" value={text(extracted.impact)} onChange={(v) => update("impact", v)} options={impacts.options} disabled={fp("impact").disabled} required={fp("impact").required} />
        {["description","rootCause","correction","correctiveAction"].map((field) => <div className="sm:col-span-2" key={field}><Label className="mb-2 block capitalize">{field.replace(/([A-Z])/g, " $1")}{fp(field).required && <span className="ml-1 text-destructive">*</span>}</Label><Textarea rows={4} value={text(extracted[field])} onChange={(e) => update(field, e.target.value)} disabled={fp(field).disabled} /></div>)}
        <div className="sm:col-span-2"><Button className="w-full" onClick={createLesson} disabled={transaction.missing.length > 0 || create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Check />} Create draft lesson</Button></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Follow-up questions</CardTitle></CardHeader><CardContent className="space-y-5">
        {transaction.missing.length === 0 ? <div className="rounded-lg bg-accent/10 p-4 text-sm"><Check className="mb-2 text-accent" />All required details were extracted. Review the preview before creating.</div> : transaction.missing.map((item) => {
          const options = missingOptions(item);
          return <div key={item.field}><Label className="mb-2 block">{item.question}</Label>{options.length ? <Select value={answers[item.field] ?? ""} onValueChange={(v) => setAnswers((x) => ({ ...x, [item.field]: v }))}><SelectTrigger><SelectValue placeholder="Select an answer" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</SelectContent></Select> : <Input value={answers[item.field] ?? ""} onChange={(e) => setAnswers((x) => ({ ...x, [item.field]: e.target.value }))} />}<Button size="sm" variant="outline" className="mt-2" onClick={() => submitAnswer(item)} disabled={answer.isPending}>Add to VerionAI draft</Button></div>;
        })}
      </CardContent></Card>
      </div>
    </>}
  </div>;
}

function Edit({ label, value, onChange, wide, disabled, required }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; disabled?: boolean; required?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><Label className="mb-2 block">{label}{required && <span className="ml-1 text-destructive">*</span>}</Label><Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} /></div>;
}
function Choice({ label, value, onChange, options, disabled, required }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean; required?: boolean }) {
  return <div><Label className="mb-2 block">{label}{required && <span className="ml-1 text-destructive">*</span>}</Label><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent>{options.map((x) => <SelectItem value={x.value} key={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></div>;
}