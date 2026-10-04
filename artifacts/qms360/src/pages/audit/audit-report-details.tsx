import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSaveAuditReportDetails } from "@workspace/api-client-react";
import type { Audit } from "@workspace/api-client-react";
import { auditReportDetailGroups, auditReportDetailsErrors, type AuditReportDetailsData } from "@workspace/field-controls";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuditEditAccess } from "./audit-complete";

type FieldDef = { key: string; label: string; type?: "date" | "textarea" | "select"; options?: string[] };

function Control({ id, field, value, disabled, onChange }: { id: string; field: FieldDef; value: string; disabled: boolean; onChange: (v: string) => void }) {
  if (field.type === "textarea") return <Textarea id={id} rows={3} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />;
  if (field.type === "select") return <><Select value={value} disabled={disabled} onValueChange={onChange}><SelectTrigger id={id}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{field.options?.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>{value && !disabled && <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => onChange("")} data-testid={`button-clear-${id}`}>Clear selection</Button>}</>;
  return <Input id={id} type={field.type === "date" ? "date" : "text"} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />;
}

export function AuditReportDetailsEditor({ audit }: { audit: Audit }) {
  const [data, setData] = useState<AuditReportDetailsData>({ values: audit.reportDetails?.values ?? {}, rows: audit.reportDetails?.rows ?? {} });
  const dirty = useRef(false);
  const serverKey = JSON.stringify(audit.reportDetails ?? null);
  useEffect(() => { // refresh from server only when there are no unsaved edits
    if (!dirty.current) setData({ values: audit.reportDetails?.values ?? {}, rows: audit.reportDetails?.rows ?? {} });
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = useAuditEditAccess(audit, "reportDetails");
  const save = useSaveAuditReportDetails(); const qc = useQueryClient(); const { toast } = useToast();
  const setValue = (k: string, v: string) => { dirty.current = true; setData(d => ({ ...d, values: { ...d.values, [k]: v } })); };
  const setRows = (k: string, fn: (rows: Array<Record<string, string>>) => Array<Record<string, string>>) => { dirty.current = true; setData(d => ({ ...d, rows: { ...d.rows, [k]: fn(d.rows[k] ?? []) } })); };
  const submit = () => {
    const errors = auditReportDetailsErrors(data);
    if (errors.length) { toast({ title: "Check report details", description: errors.join("; "), variant: "destructive" }); return; }
    save.mutate({ id: audit.id, data }, {
      onSuccess: () => {
        dirty.current = false;
        void qc.invalidateQueries({ queryKey: [`/api/audit/audits/${audit.id}`] });
        void qc.invalidateQueries({ queryKey: ["/api/audit/audits"] });
        void qc.invalidateQueries({ queryKey: [`/api/audit/audits/${audit.id}/report`] });
        toast({ title: "Report details saved" });
      },
      onError: e => toast({ title: "Unable to save report details", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" }),
    });
  };
  const disabled = !canEdit || save.isPending;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">These fields appear only in the consolidated audit report. They can be completed before or after the audit is marked Complete.</p>
    {auditReportDetailGroups.map(group => <Card key={group.key}>
      <CardHeader><CardTitle className="text-base">{group.label}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {group.fields.length > 0 && <div className="grid gap-4 md:grid-cols-2">{group.fields.map(f => {
          const id = `rd-${group.key}-${f.key}`;
          return <div key={f.key} className={`space-y-1.5 ${f.type === "textarea" ? "md:col-span-2" : ""}`}><Label htmlFor={id}>{f.label}</Label><Control id={id} field={f} value={data.values[f.key] ?? ""} disabled={disabled} onChange={v => setValue(f.key, v)} /></div>;
        })}</div>}
        {group.collections?.map(col => {
          const rows = data.rows[col.key] ?? [];
          return <div key={col.key} className="space-y-3">
            <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{col.label}</h4>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRows(col.key, r => [...r, {}])} data-testid={`button-add-${col.key}`}><Plus className="mr-1 size-4" />Add row</Button></div>
            {rows.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No rows added.</p>}
            {rows.map((row, i) => <div key={i} className="rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{col.columns.map(c => {
                const id = `rd-${col.key}-${i}-${c.key}`;
                return <div key={c.key} className="space-y-1.5"><Label htmlFor={id}>{c.label}</Label><Control id={id} field={c} value={row[c.key] ?? ""} disabled={disabled} onChange={v => setRows(col.key, r => r.map((x, j) => j === i ? { ...x, [c.key]: v } : x))} /></div>;
              })}</div>
              <div className="mt-2 flex justify-end"><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`Remove ${col.label} row ${i + 1}`} onClick={() => setRows(col.key, r => r.filter((_, j) => j !== i))}><Trash2 className="mr-1 size-4" />Remove</Button></div>
            </div>)}
          </div>;
        })}
      </CardContent></Card>)}
    <div className="flex justify-end"><Button onClick={submit} disabled={disabled} data-testid="button-save-report-details">{save.isPending ? "Saving…" : "Save report details"}</Button></div>
  </div>;
}
