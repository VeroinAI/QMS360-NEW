import { useEffect, useState } from "react";
import { useGetAuditPlanNumbering, useUpdateAuditPlanNumbering, useUpdateAuditPlanNumberRange, type AuditPlanNumberingPattern } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export function AuditPlanNumberingSettings() {
  const query = useGetAuditPlanNumbering();
  const savePattern = useUpdateAuditPlanNumbering();
  const saveRange = useUpdateAuditPlanNumberRange();
  const { toast } = useToast();
  const [pattern, setPattern] = useState<AuditPlanNumberingPattern>();
  const [scope, setScope] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [lastNumber, setLastNumber] = useState("0");
  const storedPattern = JSON.stringify(query.data?.pattern);
  useEffect(() => { if (query.data) setPattern(query.data.pattern); }, [storedPattern]);
  const lastUsed = query.data?.ranges[scope]?.[year] ?? 0;
  useEffect(() => { setLastNumber(String(lastUsed)); saveRange.reset(); }, [scope, year, lastUsed]);
  if (query.isLoading) return <Card><CardContent className="py-6">Loading Audit Plan numbering…</CardContent></Card>;
  if (!query.data || !pattern) return <Card><CardContent className="py-6 text-destructive">Could not load Audit Plan numbering. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></CardContent></Card>;
  const source = query.data.sources.find(item => item.key === scope);
  const yearNumber = Number(year), last = Number(lastNumber);
  const validRange = !!scope && Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 9999 &&
    lastNumber.trim() !== "" && Number.isSafeInteger(last) && last >= lastUsed && last >= 0 && last < 999_999_999_999;
  const validPattern = Number.isInteger(pattern.padding) && pattern.padding >= 1 && pattern.padding <= 12 &&
    ![pattern.prefix, pattern.middle, pattern.separator].some(value => /[{}\r\n]/.test(value));
  const preview = [pattern.prefix, source?.sourceValue || "[Department Value / Project Cost Center]", pattern.middle,
    yearNumber >= 1900 && yearNumber <= 9999 ? String(yearNumber).slice(-2) : "YY",
    String(validRange ? last + 1 : lastUsed + 1).padStart(Math.max(1, Math.min(12, pattern.padding || 1)), "0")].filter(Boolean).join(pattern.separator);
  const change = (key: keyof AuditPlanNumberingPattern, value: string) => {
    setPattern(current => ({ ...current!, [key]: key === "padding" ? Number(value) : value }));
    savePattern.reset();
  };
  return <Card data-testid="audit-plan-numbering"><CardHeader><CardTitle>Audit Plan number range</CardTitle>
    <CardDescription>Separate from Audit Number and QA/QC Reference. Each project or department has its own yearly sequence starting at 1. Existing plans retain their numbers.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm">Format: <strong>Prefix + Department Value / Project Cost Center + Middle text + YY + Running number</strong>.
        The source is determined from the linked audit. YY comes from that audit's Schedule From Date—not the date the plan is created.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="plan-number-prefix">Text before source (prefix)</Label><Input id="plan-number-prefix" maxLength={80} value={pattern.prefix} onChange={event => change("prefix", event.target.value)} /></div>
        <div><Label htmlFor="plan-number-middle">Text after source (middle)</Label><Input id="plan-number-middle" maxLength={80} value={pattern.middle} onChange={event => change("middle", event.target.value)} /></div>
        <div><Label htmlFor="plan-number-separator">Separator</Label><Input id="plan-number-separator" maxLength={80} value={pattern.separator} onChange={event => change("separator", event.target.value)} /></div>
        <div><Label htmlFor="plan-number-padding">Running number padding</Label><Input id="plan-number-padding" type="number" min={1} max={12} value={pattern.padding} onChange={event => change("padding", event.target.value)} /></div>
      </div>
      {savePattern.isError && <p role="alert" className="text-sm text-destructive">{savePattern.error.message}</p>}
      <Button type="button" disabled={!validPattern || savePattern.isPending} onClick={() => savePattern.mutate({ data: pattern }, {
        onSuccess: () => { toast({ title: "Audit Plan format saved; yearly counters retained" }); void query.refetch(); },
      })}>{savePattern.isPending ? "Saving…" : "Save Audit Plan format"}</Button>
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">Go-live: maintain the last-used number</h3>
        <p className="text-sm text-muted-foreground">Select the project or department and the full Schedule From Date year. Enter the last number already issued outside QMS360. The next plan receives that number plus 1. Enter 0 for a fresh range. A saved range cannot be moved below an already allocated number.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Project / department</Label><Select value={scope} onValueChange={setScope}>
            <SelectTrigger aria-label="Audit Plan number range project or department"><SelectValue placeholder="Select project or department" /></SelectTrigger>
            <SelectContent>{query.data.sources.map(item => <SelectItem key={item.key} value={item.key}>{item.kind === "project" ? "Project" : "Department"} — {item.label}</SelectItem>)}</SelectContent>
          </Select></div>
          <div><Label htmlFor="plan-number-year">Year (four digits)</Label><Input id="plan-number-year" type="number" min={1900} max={9999} value={year} onChange={event => setYear(event.target.value)} /></div>
          <div><Label htmlFor="plan-number-last">Last number already used</Label><Input id="plan-number-last" type="number" min={lastUsed} max={999999999998} value={lastNumber} onChange={event => { setLastNumber(event.target.value); saveRange.reset(); }} /></div>
        </div>
        {source && <p className="text-sm">Automatic source value: <strong>{source.sourceValue || "Missing—maintain Project Master → Additional Data → Cost Center"}</strong> · Saved last-used number for {year}: <strong>{lastUsed}</strong></p>}
        {validRange && <p className="text-sm">Next running number after saving: <strong>{last + 1}</strong></p>}
        {!query.data.sources.length && <p className="text-sm text-muted-foreground">No projects or department master values are available in your Audit administrator scope.</p>}
        {saveRange.isError && <p role="alert" className="text-sm text-destructive">{saveRange.error.message}</p>}
        <Button type="button" disabled={!validRange || saveRange.isPending} onClick={() => saveRange.mutate({ data: { scope, year: yearNumber, lastNumber: last } }, {
          onSuccess: () => { toast({ title: "Audit Plan go-live range saved" }); void query.refetch(); },
        })}>{saveRange.isPending ? "Saving…" : "Save last-used number"}</Button>
      </section>
      <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs uppercase text-muted-foreground">Illustrative next number — does not issue a number</p><p className="break-all font-mono font-semibold" data-testid="audit-plan-number-preview">{preview}</p>
        <p className="mt-1 text-xs text-muted-foreground">For example, prefix AGH, source CC100, middle AP, year 2027 and next number 1 produce AGH-CC100-AP-27-0001. Generation uses the saved format, not unsaved preview edits.</p></div>
    </CardContent></Card>;
}
