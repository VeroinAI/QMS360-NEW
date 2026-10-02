import { createContext, useContext, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Obj } from './reporting-types';

type Path = (string | number)[];
export const getIn = (o: unknown, p: Path): any => p.reduce<any>((a, k) => (a == null ? undefined : a[k]), o);
export const setIn = (o: any, p: Path, v: unknown): any => {
  if (!p.length) return v;
  const [h, ...r] = p;
  const base = o ?? (typeof h === 'number' ? [] : {});
  const copy: any = Array.isArray(base) ? [...base] : { ...base };
  copy[h!] = setIn(base[h!], r, v);
  return copy;
};

export type FormCtxValue = { data: Obj; set: (p: Path, v: unknown) => void; readOnly: boolean; fc: (key: string) => { disabled: boolean; required: boolean }; departments?: (string | { value: string; label?: string })[] };
export const FormCtx = createContext<FormCtxValue | null>(null);
export function useForm() { const c = useContext(FormCtx); if (!c) throw new Error('FormCtx missing'); return c; }

function useField(path: Path) {
  const f = useForm();
  const fcp = f.fc(String(path[0]));
  return { value: getIn(f.data, path), set: (v: unknown) => f.set(path, v), disabled: f.readOnly || fcp.disabled, required: fcp.required };
}
const Lbl = ({ label, required }: { label: string; required?: boolean }) => <Label className="text-xs text-muted-foreground">{label}{required && <span className="ml-1 text-destructive">*</span>}</Label>;

export function NumField({ path, label, hint, bare }: { path: Path; label: string; hint?: string; bare?: boolean }) {
  const { value, set, disabled, required } = useField(path);
  if (bare) return <Input aria-label={label} className="h-8 w-20 px-2 text-right" type="number" min={0} step={1} inputMode="numeric" disabled={disabled} value={value ?? ''} onChange={e => set(e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value))))} />;
  return <div className="space-y-1"><Lbl label={label} required={required} /><Input type="number" min={0} step={1} inputMode="numeric" disabled={disabled} value={value ?? ''} onChange={e => set(e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value))))} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
export function TextField({ path, label, multiline, type = 'text', max }: { path: Path; label: string; multiline?: boolean; type?: 'text' | 'date'; max?: string }) {
  const { value, set, disabled, required } = useField(path);
  return <div className="space-y-1"><Lbl label={label} required={required} />{multiline ? <Textarea rows={5} disabled={disabled} value={value ?? ''} onChange={e => set(e.target.value)} /> : <Input type={type} max={max} disabled={disabled} value={value ?? ''} onChange={e => set(e.target.value)} />}</div>;
}
export function SelectField({ path, label, options }: { path: Path; label: string; options: string[] }) {
  const { value, set, disabled, required } = useField(path);
  return <div className="space-y-1"><Lbl label={label} required={required} /><Select disabled={disabled} value={value == null ? '' : String(value)} onValueChange={set}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></div>;
}
export function DeptField({ path, label = 'Department' }: { path: Path; label?: string }) {
  const f = useForm();
  const { value, set, disabled } = useField(path);
  const list = (f.departments ?? []).map(item => typeof item === 'string' ? { value: item, label: item } : { value: item.value, label: item.label ?? item.value }).filter(item => item.value);
  if (!list.length) return <TextField path={path} label={label} />;
  const options = value && !list.some(item => item.value === value) ? [{ value: String(value), label: String(value) }, ...list] : list;
  return <div className="space-y-1"><Lbl label={label} /><Select disabled={disabled} value={value ?? ''} onValueChange={set}><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>;
}
export function CheckField({ path, label, onChange }: { path: Path; label: string; onChange?: (v: boolean) => void }) {
  const { value, set, disabled } = useField(path);
  return <label className="flex items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={!!value} onCheckedChange={v => { set(!!v); onChange?.(!!v); }} />{label}</label>;
}

export function RowsEditor({ path, blank, addLabel, children }: { path: Path; blank: () => Obj; addLabel: string; children: (rowPath: Path, i: number) => ReactNode }) {
  const f = useForm();
  const rows: Obj[] = getIn(f.data, path) ?? [];
  return <div className="space-y-3">
    {rows.map((_, i) => <div key={i} className="flex items-end gap-2 rounded-lg border bg-muted/20 p-3"><div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children([...path, i], i)}</div>{!f.readOnly && <Button size="icon" variant="ghost" aria-label="Remove row" onClick={() => f.set(path, rows.filter((_, j) => j !== i))}><Trash2 className="size-4 text-destructive" /></Button>}</div>)}
    {!f.readOnly && <Button size="sm" variant="outline" onClick={() => f.set(path, [...rows, blank()])}><Plus className="mr-1 size-4" />{addLabel}</Button>}
  </div>;
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <Card><CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
export const Grid = ({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) => <div className={`grid gap-3 sm:grid-cols-2 ${cols >= 3 ? 'lg:grid-cols-3' : ''} ${cols >= 4 ? 'xl:grid-cols-4' : ''}`}>{children}</div>;
export function ReadOnlyValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{value ?? '-'}</div></div>;
}
