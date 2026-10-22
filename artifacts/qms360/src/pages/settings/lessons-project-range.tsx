import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateLessonsProjectNumbering, getGetLessonsProjectNumberingQueryKey, useUpdateLessonsDepartmentNumbering, getGetLessonsDepartmentNumberingQueryKey, type LessonsProjectNumbering } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export function LessonsProjectRange({ projectId, counter, loading, error, onRetry, sourceType = "Project" }: {
  projectId: string; counter?: Omit<LessonsProjectNumbering, "projectId">; loading: boolean; error: unknown;
  sourceType?: "Project" | "Department";
  onRetry: () => void;
}) {
  const [number, setNumber] = useState("");
  const client = useQueryClient();
  const { toast } = useToast();
  const projectUpdate = useUpdateLessonsProjectNumbering();
  const departmentUpdate = useUpdateLessonsDepartmentNumbering();
  const department = sourceType === "Department";
  const sourceLabel = department ? "department" : "project";
  const update = department ? departmentUpdate : projectUpdate;
  useEffect(() => { setNumber(counter ? String(counter.nextNumber) : ""); update.reset(); }, [projectId, sourceType, counter?.nextNumber]);
  const save = () => {
    const onSuccess = () => {
      void client.invalidateQueries({ queryKey: department ? getGetLessonsDepartmentNumberingQueryKey(projectId) : getGetLessonsProjectNumberingQueryKey(projectId) });
      toast({ title: `${sourceType} Lessons Learned number range saved` });
    };
    if (department) departmentUpdate.mutate({ departmentId: projectId, data: { nextNumber: Number(number) } }, { onSuccess });
    else projectUpdate.mutate({ projectId, data: { nextNumber: Number(number) } }, { onSuccess });
  };
  const valid = Number.isSafeInteger(Number(number)) && Number(number) >= 1 && Number(number) < 1_000_000_000_000;
  return <div className="space-y-3 rounded-lg border p-4">
    <div><p className="font-medium">{sourceType} Lessons Learned number range</p>
      <p className="text-xs text-muted-foreground">Each {sourceLabel} has its own counter. An unmaintained {sourceLabel} starts at 1. Set the starting number before go-live, or advance the next number later. Existing references are never changed.</p></div>
    {!projectId ? <p className="text-sm text-muted-foreground">Select a {sourceLabel} above to maintain its range.</p>
      : loading ? <p>Loading {sourceLabel} range…</p>
      : error ? <p role="alert" className="text-destructive">Could not load this {sourceLabel}'s range. <Button variant="link" onClick={onRetry}>Retry</Button></p>
      : counter && <>
        <p className="text-sm">Starting number: {counter.startingNumber} · Last issued under {sourceLabel} numbering: {counter.lastIssued ?? "None"} · {counter.configured ? "Manually maintained" : "Automatic default"}</p>
        <Label htmlFor="lessons-project-next-number">Next running number / go-live starting number</Label>
        <Input id="lessons-project-next-number" data-testid="lessons-project-next-number" type="number" min={counter.lastIssued === null ? 1 : counter.lastIssued + 1} max={999999999999}
          value={number} disabled={update.isPending} onChange={event => { setNumber(event.target.value); update.reset(); }} />
        <p className="text-xs text-muted-foreground">Enter the next number to issue—not the last number used. Numbering continues across disciplines within this {sourceLabel}. Historical references already in use are skipped when a new reference is generated.</p>
        {update.isError && <p role="alert" className="text-sm text-destructive">{update.error instanceof Error ? update.error.message : "Could not save the range."}</p>}
        <Button type="button" data-testid="save-lessons-project-range" disabled={!valid || update.isPending || (counter.lastIssued !== null && Number(number) <= counter.lastIssued)}
          onClick={save}>{update.isPending ? "Saving…" : `Save ${sourceLabel} range`}</Button>
      </>}
  </div>;
}
