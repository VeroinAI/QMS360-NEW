import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { saveDailyOpeningManual } from '@workspace/api-client-react';
import { formatDate } from '@workspace/spreadsheet-dates';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errMsg } from './shell';
import type { DailyHistField, DailyHistProject } from './daily-historical-balances-page';

type Revision = { name: string; value: string };
type Revisions = Record<'drawings' | 'submittals', Revision[]>;
export function manualOpeningData(fields: DailyHistField[], raw: Record<string, string>, revisions: Revisions) {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  const count = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  for (const field of fields) {
    const value = count(raw[field.key] ?? '');
    if (value === null) { errors.push(`${field.label}: enter a non-negative whole number (0 if none).`); continue; }
    const parts = field.key.split('.');
    let parent = data;
    for (const part of parts.slice(0, -1)) parent = (parent[part] ??= {}) as Record<string, unknown>;
    parent[parts.at(-1)!] = value;
  }
  data.revisions = Object.fromEntries((['drawings', 'submittals'] as const).map(category => {
    const seen = new Set<string>();
    return [category, revisions[category].map(row => {
      const name = row.name.trim(), value = count(row.value);
      if (!name || name.length > 100 || seen.has(name.toLowerCase())) errors.push(`${category}: revision names are required, unique and at most 100 characters.`);
      if (value === null) errors.push(`${category} revision ${name}: enter a non-negative whole number.`);
      seen.add(name.toLowerCase());
      return { name, value };
    })];
  }));
  return { data, errors };
}

export function DailyHistoricalManual({ project, fields, goLiveDate, balancesAsOf, disabled, onBusyChange, onSaved }: {
  project: DailyHistProject; fields: DailyHistField[]; goLiveDate: string; balancesAsOf: string | null;
  disabled: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void;
}) {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<Revisions>({ drawings: [], submittals: [] });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<Parameters<typeof saveDailyOpeningManual>[0] | null>(null);
  const applying = useRef(false);
  const save = useMutation({ mutationFn: (input: Parameters<typeof saveDailyOpeningManual>[0]) => saveDailyOpeningManual(input) });
  const blocked = project.loaded || project.blocked;
  const busy = disabled || save.isPending;
  const groups = [...new Set(fields.map(f => f.label.split(' / ')[0]))];
  const review = () => {
    const result = manualOpeningData(fields, raw, revisions);
    const issues = [...result.errors];
    if (!goLiveDate || !balancesAsOf) issues.unshift('Select a valid Go-Live date.');
    if (reason.trim().length < 3 || reason.trim().length > 1000) issues.unshift('Enter a load reason of 3–1000 characters.');
    setErrors(issues);
    if (!issues.length) setPending({ confirmed: true, projectId: project.id, goLiveDate, reason: reason.trim(), data: result.data });
  };
  const apply = () => {
    if (!pending || busy || blocked || applying.current) return;
    applying.current = true; onBusyChange(true);
    save.mutate(pending, {
      onSuccess: () => {
        setPending(null); setRaw({}); setRevisions({ drawings: [], submittals: [] }); setReason(''); setErrors([]);
        onSaved();
      },
      onError: e => { setPending(null); setErrors([`${errMsg(e)} Nothing was saved.`]); },
      onSettled: () => { applying.current = false; onBusyChange(false); },
    });
  };
  return <Card>
    <CardHeader><CardTitle className="text-base">Manual opening balances — {project.label || project.name}</CardTitle>
      <CardDescription>Enter cumulative counts through {balancesAsOf ? formatDate(balancesAsOf) : 'the day before Go-Live'}. Enter 0 where there is no balance. Totals and percentages are calculated, not entered. Use either manual entry or Excel, not both for the same project.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {blocked ? <Alert><AlertDescription>{project.reason || 'This project has already been loaded or has existing Daily Submissions. Its opening balances cannot be changed.'}</AlertDescription></Alert> : <>
        {!fields.length ? <p role="alert" className="text-sm text-destructive">Opening balance fields could not be loaded. Refresh the page before entering data.</p> : <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setRaw(Object.fromEntries(fields.map(f => [f.key, raw[f.key]?.trim() ? raw[f.key] : '0'])))}>Fill empty counts with 0</Button>
          {groups.map(group => <details key={group} open className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-semibold">{group}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.filter(f => f.label.split(' / ')[0] === group).map(f =>
              <div key={f.key} className="space-y-1"><Label htmlFor={`daily-opening-${f.key}`} className="text-xs">{f.label} *</Label>
                <Input id={`daily-opening-${f.key}`} type="number" min="0" step="1" required disabled={busy} value={raw[f.key] ?? ''} onChange={e => setRaw(p => ({ ...p, [f.key]: e.target.value }))} /></div>)}</div>
          </details>)}
          {(['drawings', 'submittals'] as const).map(category => <div key={category} className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-semibold">{category === 'drawings' ? 'Drawing' : 'Submittal'} approved revisions (optional)</p>
            <p className="text-xs text-muted-foreground">Leave the list empty if none. Otherwise enter each revision and its approved count.</p>
            {revisions[category].map((row, i) => <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="flex-1 space-y-1"><Label htmlFor={`${category}-revision-${i}`}>Revision *</Label><Input id={`${category}-revision-${i}`} maxLength={100} value={row.name} disabled={busy}
                onChange={e => setRevisions(p => ({ ...p, [category]: p[category].map((r, n) => n === i ? { ...r, name: e.target.value } : r) }))} /></div>
              <div className="flex-1 space-y-1"><Label htmlFor={`${category}-count-${i}`}>Approved count *</Label><Input id={`${category}-count-${i}`} type="number" min="0" step="1" value={row.value} disabled={busy}
                onChange={e => setRevisions(p => ({ ...p, [category]: p[category].map((r, n) => n === i ? { ...r, value: e.target.value } : r) }))} /></div>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRevisions(p => ({ ...p, [category]: p[category].filter((_, n) => n !== i) }))}>Remove revision</Button>
            </div>)}
            <Button type="button" variant="outline" size="sm" disabled={busy || revisions[category].length >= 100} onClick={() => setRevisions(p => ({ ...p, [category]: [...p[category], { name: '', value: '' }] }))}>Add {category === 'drawings' ? 'drawing' : 'submittal'} revision</Button>
          </div>)}
          <div className="space-y-1"><Label htmlFor="daily-opening-reason">Load reason *</Label><Textarea id="daily-opening-reason" required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></div>
          <Button type="button" disabled={busy || !goLiveDate || !balancesAsOf} onClick={review}>Review manual balances</Button>
        </>}
      </>}
      {errors.length > 0 && <Alert variant="destructive"><AlertDescription><ul className="max-h-48 list-inside list-disc overflow-auto">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></AlertDescription></Alert>}
      <AlertDialog open={!!pending} onOpenChange={open => { if (!open && !save.isPending) setPending(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Load daily opening balances once?</AlertDialogTitle>
          <AlertDialogDescription>Project: {project.label || project.name}. Go-Live: {pending ? formatDate(pending.goLiveDate) : ''}. Balances are through {balancesAsOf ? formatDate(balancesAsOf) : ''}. This is a one-time load. Existing Daily Submissions and prior loads block saving; submitted history is never rewritten.</AlertDialogDescription></AlertDialogHeader>
          <p className="text-sm">Reason: {pending?.reason}</p>
          <p className="text-sm">{fields.length} source counts and {revisions.drawings.length + revisions.submittals.length} revision rows will be saved.</p>
          <AlertDialogFooter><AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); apply(); }}>{save.isPending ? 'Saving…' : 'Confirm and save'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardContent>
  </Card>;
}
