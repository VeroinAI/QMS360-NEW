import { useEffect, useState } from "react";
import { useUpdateAuditOverallProjectProgress } from "@workspace/api-client-react";
import type { Audit, AuditAdditionalDocuments, AuditProjectProgressInputRow } from "@workspace/api-client-react";
import { normalizeProjectProgress, projectProgressPhases, projectProgressTotalWeight, projectProgressVariance } from "@workspace/field-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type NumKey = "weight" | "plan" | "actual" | "priorPeriod";
type Draft = { id: (typeof projectProgressPhases)[number][0]; phase: string; weight: string; plan: string; actual: string; priorPeriod: string; remarks: string };
const numericKeys: NumKey[] = ["weight", "plan", "actual", "priorPeriod"];
const pattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const text = (value: number | null | undefined) => value == null ? "" : String(value);
const parse = (value: string): number | null => value.trim() === "" ? null : Number(value.trim());
const valid = (value: string, max: number) => {
  const v = value.trim();
  return v === "" || (pattern.test(v) && Number.isFinite(Number(v)) && Number(v) <= max);
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "Please try again.";

function toDraft(saved: AuditAdditionalDocuments["overallProjectProgress"] = []): Draft[] {
  return projectProgressPhases.map(([id, phase]) => {
    const row = saved.find(item => item.id === id);
    return { id, phase, weight: text(row?.weight), plan: text(row?.plan), actual: text(row?.actual), priorPeriod: text(row?.priorPeriod), remarks: row?.remarks ?? "" };
  });
}

export function OverallProjectProgress({ auditId, saved, onUpdated }: {
  auditId: string; saved?: AuditAdditionalDocuments["overallProjectProgress"]; onUpdated: (audit: Audit) => void;
}) {
  const { toast } = useToast();
  const mutation = useUpdateAuditOverallProjectProgress();
  const [rows, setRows] = useState<Draft[]>(() => toDraft(saved));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!dirty) setRows(toDraft(saved)); }, [saved, dirty]);

  const change = (id: string, key: NumKey | "remarks", value: string) => {
    setRows(current => current.map(row => row.id === id ? { ...row, [key]: value } : row));
    setDirty(true);
  };
  const total = projectProgressTotalWeight(rows.map(row => ({ id: row.id, weight: valid(row.weight, 100) ? parse(row.weight) : null })));
  const fieldInvalid = (row: Draft, key: NumKey) => !valid(row[key], key === "weight" ? 100 : 1_000_000_000);
  const invalidNumbers = rows.some(row => numericKeys.some(key => fieldInvalid(row, key)));
  const payload: AuditProjectProgressInputRow[] = rows.map(row => ({
    id: row.id, weight: parse(row.weight), plan: parse(row.plan), actual: parse(row.actual),
    priorPeriod: parse(row.priorPeriod), remarks: row.remarks,
  }));
  let totalError: string | null = null;
  if (!invalidNumbers) {
    try { normalizeProjectProgress(payload); }
    catch (error) { totalError = errorText(error); }
  }
  const overTotal = totalError !== null;

  const save = async () => {
    if (invalidNumbers) {
      toast({ title: "Enter valid non-negative numbers (Weight 0–100, others up to 1,000,000,000)", variant: "destructive" });
      return;
    }
    if (overTotal) {
      toast({ title: totalError ?? "Total Weight must be 100% or less", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await mutation.mutateAsync({ id: auditId, data: { rows: payload } });
      setDirty(false);
      onUpdated(updated);
      toast({ title: "Overall project progress saved" });
    } catch (error) {
      toast({ title: "Unable to save project progress", description: errorText(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const labels: Record<NumKey, string> = { weight: "Weight (%)", plan: "Plan", actual: "Actual", priorPeriod: "Prior period" };
  const grid = "grid grid-cols-[minmax(200px,1.2fr)_110px_110px_110px_110px_110px_minmax(220px,1.5fr)] items-start gap-3";
  return <div className="space-y-4">
    <div className="overflow-x-auto">
      <div className="min-w-[980px] space-y-3">
        <div className={`${grid} text-xs font-semibold uppercase tracking-wide text-muted-foreground`}>
          <span>Phase</span><span>Weight (%)</span><span>Plan</span><span>Actual</span><span>Variance</span><span>Prior period</span><span>REMARKS</span>
        </div>
        {rows.map(row => {
          const variance = projectProgressVariance(
            valid(row.plan, 1e9) ? parse(row.plan) : null, valid(row.actual, 1e9) ? parse(row.actual) : null);
          const cell = (key: NumKey) => <Input type="number" min="0" max={key === "weight" ? "100" : "1000000000"} step="any" inputMode="decimal"
            aria-label={`${row.phase} ${labels[key]}`} aria-invalid={fieldInvalid(row, key) || (key === "weight" && overTotal) || undefined}
            value={row[key]} onChange={event => change(row.id, key, event.target.value)} disabled={saving}/>;
          return <div key={row.id} className={grid}>
            <span className="py-2 text-sm font-medium">{row.phase}</span>
            {cell("weight")}{cell("plan")}{cell("actual")}
             <Input readOnly aria-label={`${row.phase} Variance (Actual minus Plan)`} value={text(variance)} className="bg-muted/50"/>
            {cell("priorPeriod")}
             <Input aria-label={`${row.phase} remarks`} value={row.remarks} onChange={event => change(row.id, "remarks", event.target.value)} disabled={saving}/>
          </div>;
        })}
        <div className={`${grid} border-t pt-3`}>
          <span className="py-2 text-sm font-semibold">Total Weight</span>
          <span className={`py-2 text-sm font-semibold ${overTotal ? "text-destructive" : ""}`} data-testid="text-total-weight">{total}%</span>
        </div>
      </div>
    </div>
    {overTotal && <p role="alert" className="text-sm text-destructive">{totalError}</p>}
    {invalidNumbers && <p role="alert" className="text-sm text-destructive">Enter non-negative numbers. Weight must be 0–100%; Plan, Actual and Prior period must not exceed 1,000,000,000.</p>}
    <div className="flex flex-wrap items-center justify-end gap-3">
      {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
       <Button type="button" size="sm" onClick={() => void save()} disabled={!dirty || saving || overTotal || invalidNumbers}>{saving ? "Saving…" : "Save"}</Button>
    </div>
  </div>;
}
