import { useEffect, useState } from "react";
import { useGetAuditCarNumbering, useUpdateAuditCarNumbering, useUpdateAuditCarNumberRange, getGetAuditCarNumberingQueryKey, type AuditPlanNumberingPattern } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const invalidText = (value: string) => /[{}\r\n]/.test(value) || value.length > 80;

export function AuditCarNumberingSettings() {
  const query = useGetAuditCarNumbering();
  const savePattern = useUpdateAuditCarNumbering();
  const saveRange = useUpdateAuditCarNumberRange();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pattern, setPattern] = useState<AuditPlanNumberingPattern>();
  const [scope, setScope] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [nextNumber, setNextNumber] = useState("1");
  const lastUsed = query.data?.ranges[scope]?.[String(Number(year))] ?? 0;
  useEffect(() => { setNextNumber(String(lastUsed + 1)); saveRange.reset(); }, [scope, year, lastUsed]);
  const storedPattern = JSON.stringify(query.data?.pattern);
  useEffect(() => { if (query.data) setPattern(query.data.pattern); }, [storedPattern]);
  const refreshAll = () => { void qc.invalidateQueries({ queryKey: getGetAuditCarNumberingQueryKey() }); void query.refetch(); };
  if (query.isLoading) return <Card><CardContent className="space-y-3 py-6"><div className="h-5 w-1/3 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Loading Audit CAR numbering…</p></CardContent></Card>;
  if (!query.data || !pattern) return <Card><CardContent className="flex items-center gap-3 py-6 text-destructive">Could not load Audit CAR numbering. <Button variant="outline" data-testid="button-retry-car-numbering" onClick={() => void query.refetch()}>Retry</Button></CardContent></Card>;
  const saved = query.data.pattern;
  const source = query.data.sources.find(item => item.key === scope);
  const yearNumber = Number(year);
  const validYear = Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 9999;
  const next = Number(nextNumber);
  const validRange = !!scope && validYear && nextNumber.trim() !== "" &&
    Number.isSafeInteger(next) && next > lastUsed && next >= 1 && next <= 999999999999;
  const validPattern = Number.isInteger(pattern.padding) && pattern.padding >= 1 && pattern.padding <= 12 &&
    !invalidText(pattern.prefix) && !invalidText(pattern.middle) && !invalidText(pattern.separator);
  const preview = [saved.prefix, source?.sourceValue || "[Department Value / Project Cost Center]", saved.middle,
    validYear ? String(yearNumber).slice(-2) : "YY", String(validRange ? next : lastUsed + 1).padStart(Math.max(1, Math.min(12, saved.padding || 1)), "0")].filter(Boolean).join(saved.separator);
  const change = (key: keyof AuditPlanNumberingPattern, value: string) => {
    setPattern(current => ({ ...current!, [key]: key === "padding" ? Number(value) : value }));
    savePattern.reset();
  };
  return <Card data-testid="audit-car-numbering"><CardHeader><CardTitle>Audit CAR number range</CardTitle>
    <CardDescription>Separate counters for each project or department and full Schedule From Date year, each starting at 1 annually. A CAR Number is issued only on the first successful Save response or Save & submit. Retries and later edits keep the same number, and format changes do not reset counters.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm">Format: <strong>Prefix + Department Value / Project Cost Center + Middle text + YY + Running number</strong>.
        The source is derived from the linked Plan. YY comes from the linked child Schedule From Date, not the date the CAR is saved.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="car-number-prefix">Prefix</Label><Input id="car-number-prefix" data-testid="input-car-number-prefix" maxLength={80} value={pattern.prefix} onChange={e => change("prefix", e.target.value)} /></div>
        <div><Label htmlFor="car-number-middle">Middle text</Label><Input id="car-number-middle" data-testid="input-car-number-middle" maxLength={80} value={pattern.middle} onChange={e => change("middle", e.target.value)} /></div>
        <div><Label htmlFor="car-number-separator">Separator</Label><Input id="car-number-separator" data-testid="input-car-number-separator" maxLength={80} value={pattern.separator} onChange={e => change("separator", e.target.value)} /></div>
        <div><Label htmlFor="car-number-padding">Running number padding</Label><Input id="car-number-padding" data-testid="input-car-number-padding" type="number" min={1} max={12} value={pattern.padding} onChange={e => change("padding", e.target.value)} /></div>
      </div>
      {!validPattern && <p role="alert" className="text-sm text-destructive">Text fields cannot contain braces or line breaks (maximum 80 characters). Padding must be a whole number from 1 to 12.</p>}
      {savePattern.isError && <p role="alert" className="text-sm text-destructive">{savePattern.error.message}</p>}
      <Button type="button" data-testid="button-save-car-format" disabled={!validPattern || savePattern.isPending} onClick={() => savePattern.mutate({ data: pattern }, {
        onSuccess: () => { toast({ title: "Audit CAR format saved; counters retained" }); refreshAll(); },
      })}>{savePattern.isPending ? "Saving…" : "Save Audit CAR format"}</Button>
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">Maintain next running number</h3>
        <p className="text-sm text-muted-foreground">Select the project or department and Schedule From Date year. Enter the next running number to issue. For example, if the last CAR number used before go-live was 125, enter 126. Use 1 for a fresh range. Saving does not issue a CAR Number or change existing CARs.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Project / department</Label><Select value={scope} onValueChange={setScope} disabled={saveRange.isPending}>
            <SelectTrigger aria-label="Audit CAR number project or department" data-testid="select-car-number-scope"><SelectValue placeholder="Select project or department" /></SelectTrigger>
            <SelectContent>{query.data.sources.map(item => <SelectItem key={item.key} value={item.key}>{item.kind === "project" ? "Project" : "Department"} — {item.label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="car-number-year">Schedule From Date year (four digits)</Label><Input id="car-number-year" data-testid="input-car-number-year" type="number" min={1900} max={9999} value={year} disabled={saveRange.isPending} onChange={e => setYear(e.target.value)} /></div>
          <div><Label htmlFor="car-number-next">Next running number</Label><Input id="car-number-next" data-testid="input-car-number-next" type="number" min={lastUsed + 1} max={999999999999} value={nextNumber} disabled={saveRange.isPending} onChange={e => { setNextNumber(e.target.value); saveRange.reset(); }} /></div>
        </div>
        {source && <p className="text-sm">Source value: <strong>{source.sourceValue || "Missing — maintain Project Master Cost Center"}</strong> · Last-used CAR number for {year}: <strong data-testid="text-car-number-last-used">{lastUsed}</strong></p>}
        {source && !validRange && <p role="alert" className="text-sm text-destructive">Enter a year from 1900 to 9999 and a whole next number from {lastUsed + 1} to 999999999999. The counter cannot move backwards.</p>}
        {saveRange.isError && <p role="alert" className="text-sm text-destructive">{saveRange.error.message}</p>}
        <Button type="button" data-testid="button-save-car-range" disabled={!validRange || saveRange.isPending} onClick={() => saveRange.mutate({ data: { scope, year: yearNumber, nextNumber: next } }, {
          onSuccess: () => { toast({ title: "Audit CAR next running number saved" }); refreshAll(); },
        })}>{saveRange.isPending ? "Saving…" : "Save next running number"}</Button>
        {!query.data.sources.length && <p className="text-sm text-muted-foreground">No projects or department master values are available in your Audit administrator scope.</p>}
      </section>
      <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs uppercase text-muted-foreground">Illustrative next number — does not issue a number</p><p className="break-all font-mono font-semibold" data-testid="audit-car-number-preview">{preview}</p>
        <p className="mt-1 text-xs text-muted-foreground">For example, prefix AGH, source CC100, middle CAR, year 2027 and next number 1 produce AGH-CC100-CAR-27-0001. Uses the saved format and the entered valid next number. Save the next running number to apply it.</p></div>
    </CardContent></Card>;
}
