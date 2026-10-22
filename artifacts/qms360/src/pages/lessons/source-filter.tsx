import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LessonLearnedForm, LessonsReferenceData } from "@workspace/api-client-react";

export function lessonSourceFilter(value: string) {
  return value.startsWith("department:") ? { projectId: undefined, departmentId: value.slice(11) }
    : { projectId: value === "all" ? undefined : value, departmentId: undefined };
}
export function lessonSourceName(lesson: LessonLearnedForm, projects: Map<string, string>) {
  return lesson.departmentId ? lesson.departmentName ?? "Department"
    : projects.get(lesson.projectId ?? "") ?? "Unknown project";
}
export function LessonSourceFilter({ value, onChange, data }: { value: string; onChange: (value: string) => void; data?: LessonsReferenceData }) {
  return <div className="space-y-1.5"><Label>Project / Department</Label><Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label="Filter Project / Department"><SelectValue placeholder="All projects and departments" /></SelectTrigger>
    <SelectContent><SelectItem value="all">All projects and departments</SelectItem>
      {data?.projects.map(p => <SelectItem key={p.id} value={p.id}>Project: {p.name}</SelectItem>)}
      {data?.departments?.map(d => <SelectItem key={d.id} value={`department:${d.id}`}>Department: {d.name}</SelectItem>)}
    </SelectContent></Select></div>;
}
