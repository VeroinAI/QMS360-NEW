import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Inbox } from 'lucide-react';
import type { Obj } from './reporting-types';

export const REPORT_MODULE = { monthly: 'monthly_reports', daily: 'daily_reports', csat: 'csat_reports' } as const;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'The request could not be completed.');
export const useInvalidate = () => { const qc = useQueryClient(); return () => qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('/api/qaqc') }); };

export function PageFrame({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="min-h-full bg-muted/30 p-4 md:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div className="rounded-xl bg-primary p-6 text-primary-foreground shadow-sm"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest opacity-75">QA/QC Reporting</p><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 max-w-2xl text-sm opacity-80">{description}</p></div>
      <div className="flex flex-wrap gap-2">{actions}</div></div></div>
    {children}</div></div>;
}
export function Loading() { return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>; }
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return <Alert variant="destructive"><AlertTitle>Unable to load</AlertTitle><AlertDescription className="flex items-center justify-between gap-3"><span>{errMsg(error)}</span>{retry && <button className="underline" onClick={retry}>Retry</button>}</AlertDescription></Alert>;
}
export function Empty({ text }: { text: string }) { return <Card><CardContent className="py-14 text-center"><Inbox className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">{text}</p></CardContent></Card>; }
export function StateBadge({ state }: { state: string }) {
  const label = state.replace('_', ' ');
  return <Badge className="capitalize" variant={state === 'approved' ? 'default' : state === 'sent_back' ? 'destructive' : 'secondary'}>{label}</Badge>;
}

export function saveFile(res: unknown, fallbackName: string) {
  if (res instanceof Blob) {
    const url = URL.createObjectURL(res); const a = document.createElement('a'); a.href = url; a.download = fallbackName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); return;
  }
  const r = res as Obj;
  if (r?.downloadUrl) { window.location.assign(r.downloadUrl); return; }
  if (r?.contentBase64) { const bin = atob(r.contentBase64); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); saveFile(new Blob([bytes]), r.fileName ?? fallbackName); return; }
  throw new Error(r?.message || 'The server did not return a file.');
}
export function useBusy() { const [busy, setBusy] = useState(false); return { busy, run: async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } } }; }

export function DataTree({ value, level = 0 }: { value: unknown; level?: number }) {
  const human = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase());
  const scalar = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null || v === '' ? '-' : String(v));
  if (value == null || typeof value !== 'object') return <span>{scalar(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">None</span>;
    if (typeof value[0] !== 'object') return <span>{value.map(scalar).join(', ')}</span>;
    const cols = Array.from(new Set(value.flatMap(r => Object.keys(r as Obj).filter(k => typeof (r as Obj)[k] !== 'object' || (r as Obj)[k] === null))));
    return <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/50"><tr>{cols.map(c => <th key={c} className="px-3 py-2 text-left font-medium">{human(c)}</th>)}</tr></thead><tbody>{value.map((r, i) => <tr key={i} className="border-t">{cols.map(c => <td key={c} className="px-3 py-2">{scalar((r as Obj)[c])}</td>)}</tr>)}</tbody></table></div>;
  }
  const entries = Object.entries(value as Obj);
  const scalars = entries.filter(([, v]) => v == null || typeof v !== 'object');
  const nested = entries.filter(([, v]) => v != null && typeof v === 'object');
  return <div className="space-y-3">
    {scalars.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{scalars.map(([k, v]) => <div key={k} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{human(k)}</p><p className={level === 0 ? 'text-2xl font-bold' : 'text-lg font-semibold'}>{scalar(v)}</p></div>)}</div>}
    {nested.map(([k, v]) => <div key={k} className="space-y-2"><p className="text-sm font-semibold">{human(k)}</p><div className="border-l pl-3"><DataTree value={v} level={level + 1} /></div></div>)}
  </div>;
}
