import { useEffect, useState } from "react";
import { useGetAuditFindingNumbering, useUpdateAuditFindingNumbering, useUpdateAuditFindingNumberRange, getGetAuditFindingNumberingQueryKey, type AuditFindingNumberingPattern } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const invalidText = (value: string) => /[{}\r\n]/.test(value) || value.length > 80;

export function AuditFindingNumberingSettings() {
  const query = useGetAuditFindingNumbering();
  const savePattern = useUpdateAuditFindingNumbering();
  const saveRange = useUpdateAuditFindingNumberRange();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pattern, setPattern] = useState<AuditFindingNumberingPattern>();
  const [type, setType] = useState("Minor NC");
  const [scope, setScope] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [nextNumber, setNextNumber] = useState("1");
  const lastUsed = query.data?.ranges[type]?.[scope]?.[String(Number(year))] ?? 0;
  useEffect(() => { setNextNumber(String(lastUsed + 1)); saveRange.reset(); }, [type, scope, year, lastUsed]);
  const storedPattern = JSON.stringify(query.data?.pattern);
  useEffect(() => { if (query.data) setPattern(query.data.pattern); }, [storedPattern]);
  if (query.isLoading) return <Card><CardContent className="space-y-3 py-6"><div className="h-5 w-1/3 animate-pulse rounded bg-muted" /><p className="text-sm text-muted-foreground">Loading Audit Finding numbering…</p></CardContent></Card>;
  if (!query.data || !pattern) return <Card><CardContent className="flex items-center gap-3 py-6 text-destructive">Could not load Audit Finding numbering. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></CardContent></Card>;
  const types = query.data.findingTypes.filter(t => t !== ("Not applicable" as string));
  const saved = query.data.pattern;
  const source = query.data.sources.find(item => item.key === scope);
  const yearNumber = Number(year);
  const validYear = Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 9999;
  const next = Number(nextNumber);
  const validRange = Boolean(source?.sourceValue) && validYear && nextNumber.trim() !== "" &&
    Number.isSafeInteger(next) && next > lastUsed && next >= 1 && next <= 999999999999;
  const codes = types.map(t => (pattern.codes[t] ?? "").trim());
  const codesValid = codes.every(c => c && !invalidText(c));
  const validPattern = codesValid && Number.isInteger(pattern.padding) && pattern.padding >= 1 && pattern.padding <= 12 && !invalidText(pattern.prefix) && !invalidText(pattern.separator);
  const preview = [saved.prefix, source?.sourceValue || "[Department Cost ID / Project Contract no.]", saved.codes[type] || "[code]",
    validYear ? String(yearNumber).slice(-2) : "YY", String(validRange ? next : lastUsed + 1).padStart(Math.max(1, Math.min(12, saved.padding || 1)), "0")].filter(Boolean).join(saved.separator);
  const change = (key: "prefix" | "separator" | "padding", value: string) => {
    setPattern(current => ({ ...current!, [key]: key === "padding" ? Number(value) : value }));
    savePattern.reset();
  };
  const changeCode = (value: string) => { setPattern(current => ({ ...current!, codes: { ...current!.codes, [type]: value } })); savePattern.reset(); };
  return <Card data-testid="audit-finding-numbering"><CardHeader><CardTitle>Audit Finding number range</CardTitle>
    <CardDescription>Separate counters for each finding type, project or department and full Schedule From Date year, each starting at 1 annually. A number is issued only on a successful Save Finding. Saved numbers are never rewritten, and format changes do not reset counters.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm">Format: <strong>Prefix + Department Cost ID / Project Contract / project no. + Finding type code + YY + Running number</strong>.
        The source is derived from the linked Plan. YY comes from the linked child Schedule From Date, not the date the finding is saved.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="finding-number-prefix">Prefix</Label><Input id="finding-number-prefix" maxLength={80} value={pattern.prefix} onChange={e => change("prefix", e.target.value)} /></div>
        <div><Label htmlFor="finding-number-separator">Separator</Label><Input id="finding-number-separator" maxLength={80} value={pattern.separator} onChange={e => change("separator", e.target.value)} /></div>
        <div><Label htmlFor="finding-number-padding">Running number padding</Label><Input id="finding-number-padding" type="number" min={1} max={12} value={pattern.padding} onChange={e => change("padding", e.target.value)} /></div>
        <div><Label>Audit Finding type</Label><Select value={type} onValueChange={setType} disabled={saveRange.isPending}>
          <SelectTrigger aria-label="Audit Finding type"><SelectValue /></SelectTrigger>
          <SelectContent>{types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="max-w-sm"><Label htmlFor="finding-number-code">Middle code for {type}</Label><Input id="finding-number-code" maxLength={80} value={pattern.codes[type] ?? ""} onChange={e => changeCode(e.target.value)} /></div>
      <p className="text-sm text-muted-foreground">The same middle code can be used for multiple finding types. Their counters remain separate, so displayed numbers may match across types.</p>
      {!codesValid && <p role="alert" className="text-sm text-destructive">Every finding type needs a nonempty code without braces or line breaks (maximum 80 characters).</p>}
      {savePattern.isError && <p role="alert" className="text-sm text-destructive">{savePattern.error.message}</p>}
      <Button type="button" disabled={!validPattern || savePattern.isPending} onClick={() => savePattern.mutate({ data: { ...pattern, codes: Object.fromEntries(types.map(t => [t, (pattern.codes[t] ?? "").trim()])) } }, {
        onSuccess: () => { toast({ title: "Audit Finding format saved; counters retained" }); void qc.invalidateQueries({ queryKey: getGetAuditFindingNumberingQueryKey() }); void query.refetch(); },
      })}>{savePattern.isPending ? "Saving…" : "Save Audit Finding format"}</Button>
      <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Finding type</TableHead><TableHead>Saved code</TableHead></TableRow></TableHeader>
        <TableBody>{types.map(t => <TableRow key={t} className={t === type ? "bg-muted/40" : undefined}><TableCell>{t}</TableCell><TableCell className="font-mono">{saved.codes[t] || "Not set"}</TableCell></TableRow>)}</TableBody></Table></div>
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">Maintain next running number</h3>
        <p className="text-sm text-muted-foreground">Select the finding type above, project or department and Schedule From Date year. Enter the next running number to issue. For example, if the last number used before go-live was 125, enter 126. Use 1 for a fresh range. Saving does not issue a finding number or change existing findings.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Project / department</Label><Select value={scope} onValueChange={setScope} disabled={saveRange.isPending}>
            <SelectTrigger aria-label="Audit Finding number project or department"><SelectValue placeholder="Select project or department" /></SelectTrigger>
            <SelectContent>{query.data.sources.map(item => <SelectItem key={item.key} value={item.key}>{item.kind === "project" ? "Project" : "Department"} — {item.label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="finding-number-year">Schedule From Date year (four digits)</Label><Input id="finding-number-year" type="number" min={1900} max={9999} value={year} disabled={saveRange.isPending} onChange={e => setYear(e.target.value)} /></div>
          <div><Label htmlFor="finding-number-next">Next running number for {type}</Label><Input id="finding-number-next" type="number" min={lastUsed + 1} max={999999999999} value={nextNumber} disabled={saveRange.isPending} onChange={e => { setNextNumber(e.target.value); saveRange.reset(); }} /></div>
        </div>
        {source && <p className="text-sm">Source value: <strong>{source.sourceValue || (source.kind === "department" ? "Missing—maintain Department Master → Cost ID" : "Missing—maintain Project Master → Additional Data → Contract / project no.")}</strong> · Last-used {type} number for {year}: <strong>{lastUsed}</strong></p>}
        {source && !validRange && <p role="alert" className="text-sm text-destructive">Maintain a source value, a year from 1900 to 9999 and a whole next number from {lastUsed + 1} to 999999999999. The counter cannot move backwards.</p>}
        {saveRange.isError && <p role="alert" className="text-sm text-destructive">{saveRange.error.message}</p>}
        <Button type="button" disabled={!validRange || saveRange.isPending} onClick={() => saveRange.mutate({ data: { findingType: type as "Minor NC" | "Moderate NC" | "Major NC" | "OFI", scope, year: yearNumber, nextNumber: next } }, {
          onSuccess: () => { toast({ title: "Audit Finding next running number saved" }); void qc.invalidateQueries({ queryKey: getGetAuditFindingNumberingQueryKey() }); void query.refetch(); },
        })}>{saveRange.isPending ? "Saving…" : "Save next running number"}</Button>
        {!query.data.sources.length && <p className="text-sm text-muted-foreground">No projects or department master values are available in your Audit administrator scope.</p>}
      </section>
      <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs uppercase text-muted-foreground">Illustrative next number — does not issue a number</p><p className="break-all font-mono font-semibold" data-testid="audit-finding-number-preview">{preview}</p>
        <p className="mt-1 text-xs text-muted-foreground">For example, prefix AGH, contract number CTR100, code MNC, year 2027 and next number 1 produce AGH-CTR100-MNC-27-0001. Department audits use Cost ID instead. Uses the saved format and the entered valid next number. Save the next running number to apply it.</p></div>
    </CardContent></Card>;
}
