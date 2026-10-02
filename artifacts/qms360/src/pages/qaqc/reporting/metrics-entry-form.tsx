import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getIn, useForm } from './form-kit';
import { MetricDetailsForm } from './metric-details-form';
import { MEETING_TYPES, PQP_STATUSES, num, type Obj } from './reporting-types';

type Path = (string | number)[];

export function Tile({ index, title, children }: { index?: number; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const uid = useId();
  return <Card>
    <CardHeader className="p-0">
      <button type="button" aria-expanded={open} aria-controls={`${uid}-body`} onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between gap-3 rounded-t-xl px-6 py-4 text-left hover:bg-muted/40">
        <CardTitle className="text-base">{index ? `${index}. ` : ''}{title}</CardTitle>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
    </CardHeader>
    <div id={`${uid}-body`} hidden={!open}><CardContent className="space-y-4">{children}</CardContent></div>
  </Card>;
}

const Req = () => <span className="ml-1 text-destructive" aria-hidden="true">*</span>;
function Field({ label, required, children, id }: { label: string; required?: boolean; children: ReactNode; id: string }) {
  return <div className="space-y-1"><Label htmlFor={id} className="text-xs text-muted-foreground">{label}{required && <Req />}</Label>{children}</div>;
}
const cols = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3';

function useP(path: Path) { const f = useForm(); return { value: getIn(f.data, path), set: (v: unknown) => f.set(path, v), ro: f.readOnly }; }

function TextIn({ path, label, required, type = 'text', disabled, hint }: { path: Path; label: string; required?: boolean; type?: 'text' | 'date'; disabled?: boolean; hint?: string }) {
  const { value, set, ro } = useP(path); const id = useId();
  return <Field id={id} label={label} required={required}><Input id={id} type={type} aria-required={required} disabled={ro || disabled} value={value ?? ''} onChange={e => set(e.target.value)} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</Field>;
}
function IntIn({ path, label, required, min = 0 }: { path: Path; label: string; required?: boolean; min?: number }) {
  const { value, set, ro } = useP(path); const id = useId();
  return <Field id={id} label={label} required={required}><Input id={id} type="number" min={min} step={1} inputMode="numeric" aria-required={required} disabled={ro} value={value ?? ''} onChange={e => set(e.target.value === '' ? undefined : Number(e.target.value))} /></Field>;
}
function PickIn({ path, label, required, options }: { path: Path; label: string; required?: boolean; options: string[] }) {
  const { value, set, ro } = useP(path); const id = useId();
  return <Field id={id} label={label} required={required}><Select disabled={ro} value={value == null ? '' : String(value)} onValueChange={set}><SelectTrigger id={id} aria-required={required}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></Field>;
}
function YesNo({ path, label, required }: { path: Path; label: string; required?: boolean }) {
  const { value, set, ro } = useP(path); const id = useId();
  return <Field id={id} label={label} required={required}><Select disabled={ro} value={typeof value === 'boolean' ? (value ? 'Yes' : 'No') : ''} onValueChange={v => set(v === 'Yes')}><SelectTrigger id={id} aria-required={required}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent></Select></Field>;
}

function Rows({ path, blank, addLabel, noun, children }: { path: Path; blank: () => Obj; addLabel: string; noun: string; children: (p: Path, row: Obj) => ReactNode }) {
  const f = useForm();
  const rows: Obj[] = getIn(f.data, path) ?? [];
  return <div className="space-y-3">
    {rows.length === 0 && <p className="text-sm text-muted-foreground">No {noun} added.</p>}
    {rows.map((row, i) => <div key={i} className="flex items-end gap-2 rounded-lg border bg-muted/20 p-3">
      <div className={`${cols} flex-1`}>{children([...path, i], row)}</div>
      {!f.readOnly && <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => f.set(path, rows.filter((_, j) => j !== i))}><Trash2 className="size-4 text-destructive" /></Button>}
    </div>)}
    {!f.readOnly && <Button type="button" size="sm" variant="outline" onClick={() => f.set(path, [...rows, blank()])}><Plus className="mr-1 size-4" />{addLabel}</Button>}
  </div>;
}

export function MetricsEntryForm({ calc }: { calc?: Record<string, Obj> }) {
  const { data } = useForm();
  const pqp = data.pqpStatus as string | undefined;
  const approved = !!pqp?.startsWith('Approved');
  const submitOff = !pqp || pqp === 'Under Preparation';
  const manpower: Obj[] = data.manpower ?? [];
  const total = manpower.reduce((a, r) => a + num(r.count), 0);
  return <div className="space-y-4">
    <Tile index={2} title="PQP Status">
      <div className={cols}>
        <PickIn path={['pqpStatus']} label="PQP Status" required options={PQP_STATUSES} />
        {pqp === 'Others' && <TextIn path={['pqpOther']} label="Other (specify)" required />}
        <TextIn path={['pqpSubmittedDate']} label="PQP Submission Date" type="date" disabled={submitOff} hint={submitOff ? 'Not applicable while Under Preparation or unset.' : undefined} />
        <TextIn path={['pqpApprovedDate']} label="PQP Approval Date" type="date" disabled={!approved} required={approved} hint={!approved ? 'Enabled only for Approved A, B or C.' : undefined} />
      </div>
    </Tile>
    <Tile index={3} title="Report Reference">
      <div className={cols}>
        <TextIn path={['reportReference']} label="Last Report Sent to Client (Ref. No)" />
        <TextIn path={['reportFrom']} label="Report Date (from)" type="date" required={!!String(data.reportReference ?? '').trim()} />
        <TextIn path={['reportTo']} label="Report Date (To)" type="date" required={!!String(data.reportReference ?? '').trim()} />
      </div>
    </Tile>
    <Tile index={4} title="Meetings Conducted">
      <Rows path={['meetings']} noun="meeting" addLabel="Add meeting" blank={() => ({ type: '', lastDate: '', nextDate: '' })}>
        {(p, row) => { const sel = !!row.type; return <><PickIn path={[...p, 'type']} label="Meeting Type" options={MEETING_TYPES} /><TextIn path={[...p, 'lastDate']} label="Date (from)" type="date" required={sel} /><TextIn path={[...p, 'nextDate']} label="Date (to)" type="date" required={sel} /></>; }}
      </Rows>
    </Tile>
    <Tile index={5} title="QMS Internal Audit">
      <div className={cols}>
        <YesNo path={['internalAudit', 'conducted']} label="Is Internal Audit Conducted?" required />
        <TextIn path={['internalAudit', 'lastDate']} label="Last Internal Audit Conducted Date" type="date" required />
        <TextIn path={['internalAudit', 'nextDate']} label="Next Internal Audit Conducted Date" type="date" required />
      </div>
    </Tile>
    <Tile index={6} title="Quality Manpower">
      <Rows path={['manpower']} noun="manpower row" addLabel="Add manpower row" blank={() => ({ department: '' })}>
        {(p, row) => <><TextIn path={[...p, 'department']} label="Department" required /><IntIn path={[...p, 'count']} label="Nos" required min={1} /><YesNo path={[...p, 'approvalRequired']} label="Is client approval required?" required />
          {row.approvalRequired === true && <><IntIn path={[...p, 'approved']} label="Approved" required /><IntIn path={[...p, 'rejected']} label="Rejected" required /></>}</>}
      </Rows>
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Total Manpower</span><span data-testid="text-total-manpower" className="font-semibold">{total}</span></div>
    </Tile>
    <MetricDetailsForm calc={calc} Tile={Tile} />
  </div>;
}
