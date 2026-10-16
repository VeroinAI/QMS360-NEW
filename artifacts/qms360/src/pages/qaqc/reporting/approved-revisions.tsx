import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumField, Section, useForm } from './form-kit';
import { calcDaily, num, type Obj } from './reporting-types';

type Category = 'drawings' | 'submittals';
const categories: Category[] = ['drawings', 'submittals'];
const normalize = (name: unknown) => String(name ?? '').trim().toLowerCase();
const categoryLabel = (cat: Category) => cat === 'drawings' ? 'Drawing' : 'Submittal';

export function moveRevision(revisions: Obj, from: Category, index: number, to: Category): Obj {
  if (from === to) return revisions;
  const row = revisions[from]?.[index];
  if (!row) return revisions;
  return {
    ...revisions,
    [from]: revisions[from].filter((_: unknown, i: number) => i !== index),
    [to]: [...(revisions[to] ?? []), row],
  };
}

export function ApprovedRevisions({ baseline }: { baseline: Obj }) {
  const f = useForm();
  const disabled = f.readOnly || f.fc('revisions').disabled;
  const revisions: Obj = f.data.revisions ?? {};
  const totals = calcDaily(f.data).disc;
  const overall = Object.values(totals).reduce((total, row) => total + num(row.total), 0);
  const priorValue = (cat: Category, name: unknown) =>
    (baseline.revisions?.[cat] ?? []).find((row: Obj) => normalize(row.name) === normalize(name))?.value ?? 0;
  const missing = categories.flatMap(cat => (baseline.revisions?.[cat] ?? [])
    .filter((row: Obj) => !(revisions[cat] ?? []).some((current: Obj) => normalize(current.name) === normalize(row.name)))
    .map((row: Obj) => ({ cat, row })));
  const add = (cat: Category, row: Obj) => f.set(['revisions'], { ...revisions, [cat]: [...(revisions[cat] ?? []), row] });

  return <Section title="Approved status by Rivision" description={'“Yesterday Approved” is auto-fetched from the last log for this project and is read-only. Percentage is calculated against overall cumulative documents (Drawings + Submittals Total).'}>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm" aria-label="Approved status by revision">
      <thead><tr>
        {['Document Type', 'Revision No.', 'Yesterday Approved (auto)', 'Current Approved', '% of Overall Cum'].map((label, i) =>
          <th key={label} scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">{label}{(i === 0 || i === 3) && <span aria-hidden="true"> *</span>}</th>)}
        <th scope="col"><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>
        {categories.flatMap(cat => (revisions[cat] ?? []).map((row: Obj, i: number) => {
          const label = `${categoryLabel(cat)} revision ${i + 1}`;
          return <tr key={`${cat}-${i}`} className="border-t">
            <td className="px-2 py-2"><select aria-label={`${label} document type`} disabled={disabled} value={cat}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              onChange={e => f.set(['revisions'], moveRevision(revisions, cat, i, e.target.value as Category))}>
              <option value="drawings">Drawing</option><option value="submittals">Submittal</option>
            </select></td>
            <td className="px-2 py-2"><Input aria-label={`${label} number`} disabled={disabled} value={row.name ?? ''} placeholder="0"
              onChange={e => f.set(['revisions', cat, i, 'name'], e.target.value)} /></td>
            <td className="px-2 py-2"><Input aria-label={`${label} yesterday approved`} readOnly className="bg-muted/50 text-muted-foreground" value={priorValue(cat, row.name)} /></td>
            <td className="px-2 py-2 [&_input]:h-9 [&_input]:w-full"><NumField bare path={['revisions', cat, i, 'value']} label={`${label} current approved`} /></td>
            <td className="px-2 py-2 font-medium" aria-live="polite">{overall > 0 ? (num(row.value) / overall * 100).toFixed(1) : '0.0'}%</td>
            <td className="px-2 py-2">{!disabled && <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${label}`}
              onClick={() => f.set(['revisions', cat], revisions[cat].filter((_: unknown, index: number) => index !== i))}><Trash2 className="size-4 text-destructive" /></Button>}</td>
          </tr>;
        }))}
        {missing.map(({ cat, row }, i) => <tr key={`prior-${cat}-${i}`} className="border-t">
          <td className="px-2 py-2">{categoryLabel(cat)}</td>
          <td className="px-2 py-2">{row.name}</td>
          <td className="px-2 py-2"><Input aria-label={`${categoryLabel(cat)} revision ${row.name} previous log approved`} readOnly className="bg-muted/50 text-muted-foreground" value={row.value ?? 0} /></td>
          <td className="px-2 py-2">{!disabled ? <Button type="button" variant="outline" size="sm" onClick={() => add(cat, { ...row, value: undefined })}>Enter current</Button> : '—'}</td>
          <td className="px-2 py-2">—</td><td />
        </tr>)}
      </tbody>
    </table></div>
    {!disabled && <Button type="button" variant="outline" size="sm" onClick={() => add('drawings', { name: '', value: undefined })}><Plus className="mr-1 size-4" />Add Revision</Button>}
  </Section>;
}
