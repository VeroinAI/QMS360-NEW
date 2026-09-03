import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAnswerLessonPromptQuestion, useCreateLessonForm, useGetLessonsReferenceData, usePromptToLessonTransaction } from "@workspace/api-client-react";
import type { LessonLearnedForm, MissingField, PromptTransaction } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { PageHeader, errorMessage } from "./common";

type Extracted = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : "";

export function AiEntryPage() {
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [transaction, setTransaction] = useState<PromptTransaction | null>(null);
  const [extracted, setExtracted] = useState<Extracted>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const refs = useGetLessonsReferenceData();
  const queryClient = useQueryClient();
  const generate = usePromptToLessonTransaction({
    mutation: {
      onSuccess: (result) => { setTransaction(result); setExtracted(result.extracted); },
      onError: (e) => toast({ title: "AI extraction failed", description: errorMessage(e), variant: "destructive" }),
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
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/lessons/log"] }); toast({ title: "AI-assisted lesson created", description: "Review it in the Lesson Learned Log before submission." }); navigate("/lessons/log"); },
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
    const data = {
      title: text(extracted.title), projectId: text(extracted.projectId), disciplineId: text(extracted.disciplineId),
      categorisationId: text(extracted.categorisationId), issueCategory: text(extracted.issueCategory) || "Minor",
      impact: text(extracted.impact) || "Negative", description: text(extracted.description), rootCause: text(extracted.rootCause),
      correction: text(extracted.correction), correctiveAction: text(extracted.correctiveAction), capturedAt: new Date().toISOString(),
    } as LessonLearnedForm;
    create.mutate({ data });
  }

  return <div>
    <PageHeader title="Describe it" description="Turn a plain-language site experience into a structured lesson." back="/lessons" />
    <Card className="overflow-hidden border-primary/20">
      <div className="bg-primary px-6 py-5 text-primary-foreground"><div className="flex items-center gap-3"><Sparkles /><div><p className="font-serif text-xl font-semibold">Prompt to transaction</p><p className="text-sm opacity-80">AI extracts a draft; you remain in control.</p></div></div></div>
      <CardContent className="pt-6">
        <Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what happened, where, the impact, root cause, and what should be done differently…" />
        <div className="mt-3 flex items-center justify-between"><p className="text-xs text-muted-foreground">Nothing is created until you review and confirm the structured form.</p><Button onClick={() => generate.mutate({ data: { prompt } })} disabled={!prompt.trim() || generate.isPending}>{generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Build draft</Button></div>
      </CardContent>
    </Card>

    {transaction && <div className="mt-6 grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2"><CardHeader className="flex-row items-center justify-between"><CardTitle>Structured preview</CardTitle><Badge variant="secondary">AI assembled</Badge></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Edit label="Title" value={text(extracted.title)} onChange={(v) => update("title", v)} wide />
        <Choice label="Project" value={text(extracted.projectId)} onChange={(v) => update("projectId", v)} options={refs.data?.projects.map((x) => ({ value: x.id, label: x.name })) ?? []} />
        <Choice label="Discipline" value={text(extracted.disciplineId)} onChange={(v) => update("disciplineId", v)} options={refs.data?.disciplines.map((x) => ({ value: x.id, label: x.name })) ?? []} />
        <Choice label="Categorisation" value={text(extracted.categorisationId)} onChange={(v) => update("categorisationId", v)} options={refs.data?.categorisation.map((x) => ({ value: x.id, label: x.name })) ?? []} />
        <Choice label="Issue category" value={text(extracted.issueCategory)} onChange={(v) => update("issueCategory", v)} options={["Minor","Moderate","Major"].map((x) => ({ value: x, label: x }))} />
        <Choice label="Impact" value={text(extracted.impact)} onChange={(v) => update("impact", v)} options={["Positive","Negative"].map((x) => ({ value: x, label: x }))} />
        {["description","rootCause","correction","correctiveAction"].map((field) => <div className="sm:col-span-2" key={field}><Label className="mb-2 block capitalize">{field.replace(/([A-Z])/g, " $1")}</Label><Textarea rows={4} value={text(extracted[field])} onChange={(e) => update(field, e.target.value)} /></div>)}
        <div className="sm:col-span-2"><Button className="w-full" onClick={createLesson} disabled={transaction.missing.length > 0 || create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Check />} Create draft lesson</Button></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Follow-up questions</CardTitle></CardHeader><CardContent className="space-y-5">
        {transaction.missing.length === 0 ? <div className="rounded-lg bg-accent/10 p-4 text-sm"><Check className="mb-2 text-accent" />All required details were extracted. Review the preview before creating.</div> : transaction.missing.map((item) => <div key={item.field}><Label className="mb-2 block">{item.question}</Label>{item.options.length ? <Select value={answers[item.field] ?? ""} onValueChange={(v) => setAnswers((x) => ({ ...x, [item.field]: v }))}><SelectTrigger><SelectValue placeholder="Select an answer" /></SelectTrigger><SelectContent>{item.options.map((option) => <SelectItem value={option} key={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input value={answers[item.field] ?? ""} onChange={(e) => setAnswers((x) => ({ ...x, [item.field]: e.target.value }))} />}<Button size="sm" variant="outline" className="mt-2" onClick={() => submitAnswer(item)} disabled={answer.isPending}>Submit answer</Button></div>)}
      </CardContent></Card>
    </div>}
  </div>;
}

function Edit({ label, value, onChange, wide }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><Label className="mb-2 block">{label}</Label><Input value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}
function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <div><Label className="mb-2 block">{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger><SelectContent>{options.map((x) => <SelectItem value={x.value} key={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></div>;
}