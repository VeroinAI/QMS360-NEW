import { useId, type ComponentType, type ReactNode } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { getIn, useForm } from './form-kit';
import { QMS_DEPARTMENTS, QMS_STATUSES, QMS_TYPES, fmt, type Obj } from './reporting-types';

type Path = (string | number)[];
export type TileComponent = ComponentType<{ index?: number; title: string; children: ReactNode }>;
export type AdditionalMetricsTilesProps = {
  Tile: TileComponent; calc: Obj; baseline?: Obj; onDraftAi: () => void; aiBusy: boolean; aiDraft: string;
  onUseDraft: () => void; aiError?: string; onConfirm?: (v: boolean) => void;
};

const cols = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3';
export const DOCUMENT_GROUPS = [['drawings', 'Drawings'], ['submittals', 'Submittals']] as const;
const selectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const rateOf = (c: number, i: number) => (i === 0 && c === 0 ? 100 : i ? (c / i) * 100 : 0);

function Field({ label, required, id, children }: { label: string; required?: boolean; id: string; children: ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id} className="text-xs text-muted-foreground">{label}{required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}</Label>{children}</div>;
}
function Int({ path, label, required, disabled, tid }: { path: Path; label: string; required?: boolean; disabled?: boolean; tid: string }) {
  const f = useForm(); const id = useId(); const v = getIn(f.data, path);
  return <Field id={id} label={label} required={required}><Input id={id} data-testid={`input-${tid}`} type="number" min={0} step={1} inputMode="numeric" aria-required={required || undefined} disabled={f.readOnly || disabled} value={v ?? ''} onChange={e => f.set(path, e.target.value === '' ? undefined : Number(e.target.value))} /></Field>;
}
function Txt({ path, label, required, multiline, tid }: { path: Path; label: string; required?: boolean; multiline?: boolean; tid: string }) {
  const f = useForm(); const id = useId(); const v = getIn(f.data, path) ?? '';
  return <Field id={id} label={label} required={required}>{multiline
    ? <Textarea id={id} data-testid={`input-${tid}`} rows={4} aria-required={required || undefined} disabled={f.readOnly} value={v} onChange={e => f.set(path, e.target.value)} />
    : <Input id={id} data-testid={`input-${tid}`} aria-required={required || undefined} disabled={f.readOnly} value={v} onChange={e => f.set(path, e.target.value)} />}</Field>;
}
function Pick({ path, label, options, required, tid }: { path: Path; label: string; options: readonly string[]; required?: boolean; tid: string }) {
  const f = useForm(); const id = useId(); const v = getIn(f.data, path) ?? '';
  return <Field id={id} label={label} required={required}><select id={id} data-testid={`select-${tid}`} className={selectCls} aria-required={required || undefined} disabled={f.readOnly} value={v} onChange={e => f.set(path, e.target.value)}><option value="">Select</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></Field>;
}
function RO({ label, value, tid, className }: { label: string; value: ReactNode; tid: string; className?: string }) {
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><div data-testid={tid} className={`flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm ${className ?? ''}`}>{value}</div></div>;
}

export function MaterialTile({ calc, baseline }: { calc: Obj; baseline?: Obj }) {
  const f = useForm(); const mat: Obj = f.data.material ?? {}; const m = calc.material ?? {};
  void baseline;
  const osd = mat.osdAvailable; const total = mat.totalItems; const tagsOn = Number(total) > 0;
  const variance = (m.accRate ?? 0) - rateOf(m.prevClosed ?? 0, m.prevIssued ?? 0);
  const tone = variance > 0 ? 'text-emerald-700' : variance < 0 ? 'text-destructive' : 'text-muted-foreground';
  const mismatch = total !== undefined && total !== '' && calc.tagSum !== Number(total);
  const rid = useId();
  return <div className="space-y-4">
    <div className={cols}>
      <RO label="Acc. MIRN till Last Month" value={m.prevIssued} tid="text-material-prev-issued" />
      <RO label="Closed till Last Month" value={m.prevClosed} tid="text-material-prev-closed" />
      <Int path={['material', 'issued']} label="MIRN Issued (this month)" required tid="material-issued" />
      <Int path={['material', 'closed']} label="MIRN Closed (this month)" required tid="material-closed" />
      <RO label="Accumulated MIRN Issued" value={m.accIssued} tid="text-material-acc-issued" />
      <RO label="Accumulated MIRN Closed" value={m.accClosed} tid="text-material-acc-closed" />
      <RO label="Monthly Closure Rate" value={`${fmt(m.monthlyRate ?? 0)}%`} tid="text-material-monthly-rate" />
      <RO label="Variance vs prior accumulated rate" value={`${variance >= 0 ? '+' : ''}${fmt(variance)} pts`} tid="text-material-variance" className={`font-medium ${tone}`} />
    </div>
    <div className="space-y-2">
      <p id={rid} className="text-xs text-muted-foreground">Is OSD available?<span className="ml-1 text-destructive" aria-hidden="true">*</span></p>
      <RadioGroup aria-labelledby={rid} data-testid="radio-material-osd" className="flex gap-4" disabled={f.readOnly} value={typeof osd === 'boolean' ? (osd ? 'Yes' : 'No') : ''} onValueChange={v => f.set(['material', 'osdAvailable'], v === 'Yes')}>
        {['Yes', 'No'].map(o => <label key={o} className="flex items-center gap-2 text-sm"><RadioGroupItem value={o} id={`${rid}-${o}`} data-testid={`radio-material-osd-${o.toLowerCase()}`} />{o}</label>)}
      </RadioGroup>
    </div>
    <div className={cols}>
      <Int path={['material', 'osdMirns']} label="OSD MIRNs" required={osd === true} disabled={osd !== true} tid="material-osd-mirns" />
      <Int path={['material', 'overage']} label="Overage" tid="material-overage" />
      <Int path={['material', 'shortage']} label="Shortage" tid="material-shortage" />
      <Int path={['material', 'damage']} label="Damage" tid="material-damage" />
      <Int path={['material', 'defective']} label="Defective" tid="material-defective" />
      <Int path={['material', 'totalItems']} label="Total Items (MIRN)" tid="material-total-items" />
      {([['approved', 'Approved'], ['onHold', 'On Hold'], ['rejectedDoNotUse', 'Rejected - Do Not Use'], ['rejectedReturn', 'Rejected - Return'], ['hazardous', 'Hazardous'], ['handleWithCare', 'Handle With Care']] as const).map(([k, l]) =>
        <Int key={k} path={['material', k]} label={l} disabled={!tagsOn} tid={`material-${k}`} />)}
    </div>
    <div className={`rounded-md border px-3 py-2 text-sm ${mismatch ? 'border-destructive text-destructive' : 'bg-muted/40'}`} data-testid="text-material-tag-guard" role={mismatch ? 'alert' : undefined}>
      Status tags total {calc.tagSum} / Total items {total ?? 0}{mismatch ? ' - tags must equal total items before submission.' : ''}
    </div>
  </div>;
}

export function QtbtTile({ calc, baseline }: { calc: Obj; baseline?: Obj }) {
  const f = useForm(); const q: Obj = f.data.qtbt ?? {}; const c = calc.qtbt ?? {}; const b: Obj = baseline?.qtbt ?? {};
  const need = Number(q.talkCount) > 0;
  return <div className={cols}>
    <RO label="Accumulated Talks till Last Month" value={Number(b.accumulatedTalkCount) || 0} tid="text-qtbt-base-talks" />
    <RO label="Accumulated Manhours till Last Month" value={fmt(Number(b.accumulatedManhours) || 0, 2)} tid="text-qtbt-base-manhours" />
    <Int path={['qtbt', 'talkCount']} label="QTBT Talks (this month)" required tid="qtbt-talk-count" />
    <Int path={['qtbt', 'attendance']} label="Attendees" required={need} tid="qtbt-attendance" />
    <Int path={['qtbt', 'durationMinutes']} label="Duration (minutes)" required={need} tid="qtbt-duration" />
    <RO label="Monthly Manhours" value={fmt(c.manhours ?? 0, 2)} tid="text-qtbt-manhours" />
    <RO label="Accumulated Talks" value={c.accTalks ?? 0} tid="text-qtbt-acc-talks" />
    <RO label="Accumulated Manhours" value={fmt(c.accManhours ?? 0, 2)} tid="text-qtbt-acc-manhours" />
  </div>;
}

export function DocumentsTile() {
  return <div className="space-y-5">{DOCUMENT_GROUPS.map(([g, label]) => <section key={g} data-testid={`group-documents-${g}`} className="space-y-3">
    <h4 className="text-sm font-semibold">{label}</h4>
    <div className={cols}>
      <Int path={['documents', g, 'approved']} label="Approved" required tid={`documents-${g}-approved`} />
      <Int path={['documents', g, 'resubmitted']} label="Resubmitted" required tid={`documents-${g}-resubmitted`} />
      <Int path={['documents', g, 'rejected']} label="Rejected" required tid={`documents-${g}-rejected`} />
      <Int path={['documents', g, 'underReview']} label="Under Review" required tid={`documents-${g}-under-review`} />
      <Int path={['documents', g, 'clientReviewDays']} label="Client Review Time (days)" required tid={`documents-${g}-client-days`} />
      <Int path={['documents', g, 'internalReviewDays']} label="Internal Review Time (days)" required tid={`documents-${g}-internal-days`} />
    </div>
    <Txt path={['documents', g, 'remarks']} label="Remarks" multiline tid={`documents-${g}-remarks`} />
  </section>)}</div>;
}

export function QmsReportsTile() {
  const f = useForm(); const path: Path = ['qmsReports']; const rows: Obj[] = getIn(f.data, path) ?? [];
  return <div className="space-y-3">
    {rows.length === 0 && <p className="text-sm text-muted-foreground">No QMS report rows added.</p>}
    {rows.map((_, i) => { const p = [...path, i]; return <div key={i} data-testid={`row-qms-${i}`} className="flex items-end gap-2 rounded-lg border bg-muted/20 p-3">
      <div className={`${cols} flex-1`}>
        <Pick path={[...p, 'department']} label="Department" options={QMS_DEPARTMENTS} required tid={`qms-${i}-department`} />
        <Pick path={[...p, 'type']} label="Type" options={QMS_TYPES} required tid={`qms-${i}-type`} />
        <Txt path={[...p, 'documentName']} label="Name" tid={`qms-${i}-name`} />
        <Pick path={[...p, 'status']} label="Status" options={QMS_STATUSES} required tid={`qms-${i}-status`} />
        <Txt path={[...p, 'remarks']} label="Remarks" multiline tid={`qms-${i}-remarks`} />
      </div>
      {!f.readOnly && <Button type="button" size="icon" variant="ghost" data-testid={`button-remove-qms-${i}`} aria-label={`Remove QMS report ${i + 1}`} onClick={() => f.set(path, rows.filter((_, j) => j !== i))}><Trash2 className="size-4 text-destructive" /></Button>}
    </div>; })}
    {!f.readOnly && <Button type="button" size="sm" variant="outline" data-testid="button-add-qms" onClick={() => f.set(path, [...rows, { department: '', type: '', documentName: '', status: '', remarks: '' }])}><Plus className="mr-1 size-4" />Add QMS report</Button>}
  </div>;
}

export function AssessmentTile({ onDraftAi, aiBusy, aiDraft, onUseDraft, aiError, onConfirm }: Omit<AdditionalMetricsTilesProps, 'Tile' | 'calc' | 'baseline'>) {
  const f = useForm(); const cid = useId(); const ro = f.readOnly;
  const confirmed = f.data.assessmentConfirmed === true;
  return <div className="space-y-4">
    <Txt path={['narrative']} label="Quality Assessment Brief" required multiline tid="narrative" />
    {!ro && <div className="space-y-3">
      <Button type="button" variant="outline" size="sm" data-testid="button-draft-ai" disabled={aiBusy} onClick={onDraftAi}><Sparkles className="mr-2 size-4" />{aiBusy ? 'VerionAI is updating suggestion...' : aiDraft ? 'Update suggestion with VerionAI' : 'Generate suggestion with VerionAI'}</Button>
      {aiError && <p role="alert" data-testid="text-ai-error" className="text-sm text-destructive">{aiError}</p>}
      {aiDraft && <div data-testid="panel-ai-suggestion" className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">VerionAI suggestion (preview only)</p>
        <p data-testid="text-ai-suggestion" className="whitespace-pre-wrap text-sm">{aiDraft}</p>
        <Button type="button" size="sm" data-testid="button-use-suggestion" disabled={aiBusy} onClick={onUseDraft}>Use suggestion</Button>
      </div>}
    </div>}
    <div className="flex items-center gap-2">
      <Checkbox id={cid} data-testid="checkbox-assessment-confirmed" disabled={ro || aiBusy} checked={confirmed} onCheckedChange={v => { f.set(['assessmentConfirmed'], v === true); onConfirm?.(v === true); }} />
      <Label htmlFor={cid} className="text-sm">I have reviewed and confirmed this assessment</Label>
    </div>
  </div>;
}

export function AdditionalMetricsTiles({ Tile, calc, baseline, ...ai }: AdditionalMetricsTilesProps) {
  return <>
    <Tile index={9} title="Material Inspection"><MaterialTile calc={calc} baseline={baseline} /></Tile>
    <Tile index={10} title="Quality Toolbox Talk (QTBT)"><QtbtTile calc={calc} baseline={baseline} /></Tile>
    <Tile index={11} title="Project Monthly Document Status – Submittals & Drawings"><DocumentsTile /></Tile>
    <Tile index={12} title="QMS Report"><QmsReportsTile /></Tile>
    <Tile index={13} title="Quality Assessment Brief"><AssessmentTile {...ai} /></Tile>
  </>;
}
