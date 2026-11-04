import { useEffect, useState } from "react";
import { useGetCsatNumbering, useUpdateCsatNumbering, useUpdateCsatNumberRange, type CsatNumberingPattern } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export function CsatNumberingSettings() {
  const query = useGetCsatNumbering();
  const savePattern = useUpdateCsatNumbering();
  const saveRange = useUpdateCsatNumberRange();
  const { toast } = useToast();
  const [pattern, setPattern] = useState<CsatNumberingPattern>();
  const [projectId, setProjectId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [lastNumber, setLastNumber] = useState("0");
  const storedPattern = JSON.stringify(query.data?.pattern);
  useEffect(() => { if (query.data) setPattern(query.data.pattern); }, [storedPattern]);
  const lastUsed = query.data?.ranges[projectId]?.[year] ?? 0;
  useEffect(() => { setLastNumber(String(lastUsed)); saveRange.reset(); }, [projectId, year, lastUsed]);
  if (query.isLoading) return <Card><CardContent className="py-6">Loading CSAT numbering…</CardContent></Card>;
  if (query.isError || !query.data || !pattern) return <Card><CardContent className="py-6 text-destructive">Could not load CSAT numbering. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></CardContent></Card>;
  const source = query.data.sources.find(item => item.key === projectId);
  const yearNumber = Number(year), last = Number(lastNumber);
  const validYear = /^\d{4}$/.test(year) && yearNumber >= 1900 && yearNumber <= 9999;
  const validRange = !!source && validYear && lastNumber.trim() !== "" && Number.isSafeInteger(last) && last >= lastUsed && last >= 0 && last < 999_999_999_999;
  const validPattern = Number.isInteger(pattern.padding) && pattern.padding >= 1 && pattern.padding <= 12 &&
    ![pattern.prefix, pattern.separator].some(value => /[{}\r\n]/.test(value));
  const preview = [pattern.prefix, source?.sourceValue || "[Contract / project no.]", validYear ? year : "YYYY",
    String(validRange ? last + 1 : lastUsed + 1).padStart(Math.max(1, Math.min(12, pattern.padding || 1)), "0")].filter(Boolean).join(pattern.separator);
  const change = (key: keyof CsatNumberingPattern, value: string) => {
    setPattern(current => ({ ...current!, [key]: key === "padding" ? Number(value) : value }));
    savePattern.reset();
  };
  return <Card data-testid="csat-numbering"><CardHeader><CardTitle>Customer Satisfaction (CSAT) — Reference number range</CardTitle>
    <CardDescription>Maintain the CSAT reference format and go-live counters. References are allocated when Create Draft succeeds; existing references are retained.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm">Format: <strong>Prefix + Contract / project no. + Year (YYYY) + Running number</strong>. The source comes from Integration Cockpit → Project Master → Additional Data. The year comes from the CSAT form's Date, not its creation date. Each project and year has an independent sequence starting at 1.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="csat-number-prefix">Prefix</Label><Input id="csat-number-prefix" maxLength={80} value={pattern.prefix} onChange={event => change("prefix", event.target.value)} /></div>
        <div><Label htmlFor="csat-number-separator">Separator</Label><Input id="csat-number-separator" maxLength={80} value={pattern.separator} onChange={event => change("separator", event.target.value)} /></div>
        <div><Label htmlFor="csat-number-padding">Running number padding</Label><Input id="csat-number-padding" type="number" min={1} max={12} value={pattern.padding} onChange={event => change("padding", event.target.value)} /></div>
      </div>
      {savePattern.isError && <p role="alert" className="text-sm text-destructive">{savePattern.error.message}</p>}
      <Button type="button" disabled={!validPattern || savePattern.isPending} onClick={() => savePattern.mutate({ data: pattern }, {
        onSuccess: () => { toast({ title: "CSAT reference format saved; counters retained" }); void query.refetch(); },
      })}>{savePattern.isPending ? "Saving…" : "Save CSAT format"}</Button>
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">Go-live: maintain the last-used number</h3>
        <p className="text-sm text-muted-foreground">Choose a project and the year corresponding to the CSAT Date. Enter the last running number already used. The next number will be this number plus 1. Use 0 for a fresh range. Saved counters cannot be moved backwards.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Project</Label><Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label="CSAT number range project"><SelectValue placeholder="Select project" /></SelectTrigger>
            <SelectContent>{query.data.sources.map(item => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
          </Select></div>
          <div><Label htmlFor="csat-number-year">Year (four digits)</Label><Input id="csat-number-year" type="number" min={1900} max={9999} value={year} onChange={event => setYear(event.target.value)} /></div>
          <div><Label htmlFor="csat-number-last">Last number already used</Label><Input id="csat-number-last" type="number" min={lastUsed} max={999999999998} value={lastNumber} onChange={event => { setLastNumber(event.target.value); saveRange.reset(); }} /></div>
        </div>
        {source && <p className="text-sm">Contract / project no.: <strong>{source.sourceValue || 'Missing—maintain Integration Cockpit → Project Master → Additional Data → Contract / project no.'}</strong> · Saved last-used number for {year}: <strong>{lastUsed}</strong></p>}
        {validRange && <p className="text-sm">Next running number after saving: <strong>{last + 1}</strong></p>}
        {!query.data.sources.length && <p className="text-sm text-muted-foreground">No projects are available in your QA/QC administration scope.</p>}
        {saveRange.isError && <p role="alert" className="text-sm text-destructive">{saveRange.error.message}</p>}
        <Button type="button" disabled={!validRange || saveRange.isPending} onClick={() => saveRange.mutate({ data: { projectId, year: yearNumber, lastNumber: last } }, {
          onSuccess: () => { toast({ title: "CSAT go-live range saved" }); void query.refetch(); },
        })}>{saveRange.isPending ? "Saving…" : "Save CSAT last-used number"}</Button>
      </section>
      <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs uppercase text-muted-foreground">Illustrative next reference — no number is issued</p>
        <p className="break-all font-mono font-semibold" data-testid="csat-number-preview">{preview}</p>
        <p className="mt-1 text-xs text-muted-foreground">Example: CSAT-CTR100-2026-0126 when Contract / project no. is CTR100 and the last-used number is 125. Saving settings does not modify existing CSAT documents or reset project/year counters.</p>
      </div>
    </CardContent></Card>;
}
