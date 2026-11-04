import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@workspace/spreadsheet-dates";
import { getGetAuditQueryKey, useUpdateAuditFindingDate } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export function FindingDate({ auditId, itemId, value, readOnly }: {
  auditId: string; itemId: string; value?: string | null; readOnly: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const mutation = useUpdateAuditFindingDate();
  const qc = useQueryClient();
  const { toast } = useToast();
  if (readOnly) return <span>{value ? formatDate(value) : "—"}</span>;
  if (!editing) return <Button type="button" variant="ghost" className="h-auto px-1 text-left" onClick={() => {
    setDraft(value ?? ""); setEditing(true);
  }} aria-label={`Edit Finding Date for ${itemId}`}>{value ? formatDate(value) : "Set Finding Date"}</Button>;
  return <form className="min-w-44 space-y-2" onSubmit={async event => {
    event.preventDefault();
    try {
      const updated = await mutation.mutateAsync({ id: auditId, itemId, data: { findingDate: draft } });
      qc.setQueryData(getGetAuditQueryKey(auditId), updated);
      void qc.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
      // CAR lists, details, queues and report previews all depend on this date.
      void qc.invalidateQueries({ predicate: query => query.queryKey.some(key =>
        typeof key === "string" && key.startsWith("/api/audit/")) });
      setEditing(false);
      toast({ title: "Finding Date saved", description: "Linked CAR due dates have been recalculated." });
    } catch (error) {
      toast({ title: "Unable to save Finding Date", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }}>
    <Input type="date" required aria-label="Finding Date" value={draft} onChange={event => setDraft(event.target.value)} disabled={mutation.isPending}/>
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={mutation.isPending || !draft}>Save</Button>
      <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={() => setEditing(false)}>Cancel</Button></div>
  </form>;
}
