import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckField, DeptField, Grid, NumField, ReadOnlyValue, RowsEditor, Section, SelectField, TextField, useForm } from './form-kit';
import { AGEING_BUCKETS, MEETING_TYPES, METRICS, PQP_STATUSES, QMS_STATUSES, QMS_TYPES, fmt, type Obj } from './reporting-types';
import { AssessmentTile } from './additional-metrics-tiles';

type Calc = { metrics: Record<string, Obj>; pqi: Obj; material: Obj; tagSum: number; qtbt: Obj; manpower: Obj };

export function MonthlyForm({ calc, target, onDraftAi, aiBusy, aiDraft, aiError, onUseDraft }: { calc: Calc; target?: Obj; onDraftAi: () => void; aiBusy: boolean; aiDraft: string; aiError?: string; onUseDraft: () => void }) {
  const { data, readOnly } = useForm();
  const pqp = data.pqpStatus as string | undefined;
  const approved = !!pqp?.startsWith('Approved');
  return <div className="space-y-6">
    <Section title="Reporting status">
      <CheckField path={['noUpdates']} label="No updates this period (current editable values are zero; historical baselines are kept)" />
    </Section>
    <Section title="Project Quality Plan and report reference">
      <Grid>
        <SelectField path={['pqpStatus']} label="PQP status" options={PQP_STATUSES} />
        {pqp === 'Others' && <TextField path={['pqpOther']} label="Describe status" />}
        {pqp && pqp !== 'Under Preparation' && <TextField path={['pqpSubmittedDate']} label="PQP submitted date" type="date" />}
        {approved && <TextField path={['pqpApprovedDate']} label="PQP approved date" type="date" />}
      </Grid>
      <Grid><TextField path={['reportReference']} label="Report reference" /><TextField path={['reportFrom']} label="Report from" type="date" /><TextField path={['reportTo']} label="Report to" type="date" /></Grid>
    </Section>
    <Section title="Meetings and internal audit" description="Last and next dates for each meeting type.">
      <RowsEditor path={['meetings']} blank={() => ({ type: MEETING_TYPES[0], lastDate: '', nextDate: '' })} addLabel="Add meeting">
        {p => <><SelectField path={[...p, 'type']} label="Meeting type" options={MEETING_TYPES} /><TextField path={[...p, 'lastDate']} label="Last date" type="date" /><TextField path={[...p, 'nextDate']} label="Next date" type="date" /></>}
      </RowsEditor>
      <Grid><CheckField path={['internalAudit', 'conducted']} label="Internal audit conducted" /><TextField path={['internalAudit', 'lastDate']} label="Last audit date" type="date" /><TextField path={['internalAudit', 'nextDate']} label="Next audit date" type="date" /></Grid>
    </Section>
    <Section title="Manpower" description={`Total headcount ${calc.manpower.total} - approved ${calc.manpower.approved} - rejected ${calc.manpower.rejected}`}>
      <RowsEditor path={['manpower']} blank={() => ({ department: '', count: undefined, approvalRequired: false, approved: 0, rejected: 0 })} addLabel="Add department">
        {p => { const need = data.manpower?.[p[1] as number]?.approvalRequired; return <><DeptField path={[...p, 'department']} /><NumField path={[...p, 'count']} label="Headcount" /><CheckField path={[...p, 'approvalRequired']} label="Approval required" onChange={v => { if (!v) { /* cleared server-side and in preview */ } }} />{need && <><NumField path={[...p, 'approved']} label="Approved" /><NumField path={[...p, 'rejected']} label="Rejected" /></>}</>; }}
      </RowsEditor>
    </Section>
    {METRICS.map(([k, label]) => {
      const c = calc.metrics[k]!;
      const below = target?.[k] != null && c.accRate < Number(target[k]);
      return <Section key={k} title={`${label} closure`} description="Previous accumulated values are read-only and come from the last submitted report.">
        <Grid><ReadOnlyValue label="Previous accumulated issued" value={c.prevIssued} /><ReadOnlyValue label="Previous accumulated closed" value={c.prevClosed} />
          <NumField path={['metrics', k, 'issued']} label="Issued this month" /><NumField path={['metrics', k, 'closed']} label="Closed this month" /></Grid>
        <Grid><ReadOnlyValue label="Accumulated issued" value={c.accIssued} /><ReadOnlyValue label="Accumulated closed" value={c.accClosed} /><ReadOnlyValue label="Open" value={c.open} /><ReadOnlyValue label="Monthly closure rate" value={`${fmt(c.monthlyRate)}%`} /></Grid>
        <Grid><ReadOnlyValue label="Accumulated closure rate" value={`${fmt(c.accRate)}%`} /><ReadOnlyValue label="Variance vs previous accumulated" value={`${c.variance >= 0 ? '+' : ''}${fmt(c.variance)} pts`} /><ReadOnlyValue label="Target" value={c.target != null ? `${c.target}%` : 'Not set'} />{below && <div className="flex items-end"><Badge variant="destructive">Below target</Badge></div>}</Grid>
        <div><p className="mb-2 text-sm font-medium">Open ageing by department <span className="font-normal text-muted-foreground">(must total {c.open}, currently {c.ageSum})</span></p>
          <RowsEditor path={['metrics', k, 'ageing']} blank={() => ({ department: '', bucket: '0-15', count: undefined })} addLabel="Add ageing row">
            {p => <><DeptField path={[...p, 'department']} /><SelectField path={[...p, 'bucket']} label="Bucket" options={AGEING_BUCKETS.map(b => b[0])} /><NumField path={[...p, 'count']} label="Count" /></>}
          </RowsEditor></div>
      </Section>;
    })}
    <Section title="Project Quality Index" description="Average of the four closure categories."><Grid><ReadOnlyValue label="Prior PQI" value={`${fmt(calc.pqi.prior)}%`} /><ReadOnlyValue label="Current PQI" value={`${fmt(calc.pqi.current)}%`} /><ReadOnlyValue label="Monthly PQI" value={`${fmt(calc.pqi.monthly)}%`} /><ReadOnlyValue label="Difference" value={`${calc.pqi.diff >= 0 ? '+' : ''}${fmt(calc.pqi.diff)} pts`} /></Grid></Section>
    <Section title="Material inspection (MIRN)" description={`Status tags total ${calc.tagSum} against total items.`}>
      <Grid><ReadOnlyValue label="Previous accumulated issued" value={calc.material.prevIssued} /><ReadOnlyValue label="Previous accumulated closed" value={calc.material.prevClosed} /><NumField path={['material', 'issued']} label="Issued this month" /><NumField path={['material', 'closed']} label="Closed this month" /></Grid>
      <Grid><ReadOnlyValue label="Accumulated issued" value={calc.material.accIssued} /><ReadOnlyValue label="Accumulated closed" value={calc.material.accClosed} /><ReadOnlyValue label="Open" value={calc.material.open} /><ReadOnlyValue label="Accumulated closure rate" value={`${fmt(calc.material.accRate)}%`} /></Grid>
      <CheckField path={['material', 'osdAvailable']} label="OSD available" />
      {data.material?.osdAvailable && <Grid><NumField path={['material', 'osdMirns']} label="OSD MIRNs" /><NumField path={['material', 'overage']} label="Overage" /><NumField path={['material', 'shortage']} label="Shortage" /><NumField path={['material', 'damage']} label="Damage" /><NumField path={['material', 'defective']} label="Defective" /></Grid>}
      <Grid><NumField path={['material', 'totalItems']} label="Total items" /><NumField path={['material', 'approved']} label="Approved" /><NumField path={['material', 'onHold']} label="On hold" /><NumField path={['material', 'rejectedDoNotUse']} label="Rejected - do not use" /><NumField path={['material', 'rejectedReturn']} label="Rejected - return" /><NumField path={['material', 'hazardous']} label="Hazardous" /><NumField path={['material', 'handleWithCare']} label="Handle with care" /></Grid>
    </Section>
    <Section title="Quality toolbox talks (QTBT)"><Grid><NumField path={['qtbt', 'talkCount']} label="Talks held" /><NumField path={['qtbt', 'attendance']} label="Attendance" /><NumField path={['qtbt', 'durationMinutes']} label="Duration (minutes)" /><ReadOnlyValue label="Manhours" value={fmt(calc.qtbt.manhours, 2)} /></Grid><Grid><ReadOnlyValue label="Accumulated talks" value={calc.qtbt.accTalks} /><ReadOnlyValue label="Accumulated manhours" value={fmt(calc.qtbt.accManhours, 2)} /></Grid></Section>
    {(['drawings', 'submittals'] as const).map(g => <Section key={g} title={`Monthly document status - ${g}`}>
      <Grid><NumField path={['documents', g, 'approved']} label="Approved" /><NumField path={['documents', g, 'resubmitted']} label="Resubmitted" /><NumField path={['documents', g, 'rejected']} label="Rejected" /><NumField path={['documents', g, 'underReview']} label="Under review" /><NumField path={['documents', g, 'clientReviewDays']} label="Client review days" /><NumField path={['documents', g, 'internalReviewDays']} label="Internal review days" /></Grid>
      <TextField path={['documents', g, 'remarks']} label="Remarks" />
    </Section>)}
    <Section title="QMS reports">
      <RowsEditor path={['qmsReports']} blank={() => ({ department: '', type: 'SOP', documentName: '', status: 'Under Review and Signature', remarks: '' })} addLabel="Add QMS row">
        {p => <><DeptField path={[...p, 'department']} /><SelectField path={[...p, 'type']} label="Type" options={QMS_TYPES} /><TextField path={[...p, 'documentName']} label="Document name" /><SelectField path={[...p, 'status']} label="Status" options={QMS_STATUSES} /><TextField path={[...p, 'remarks']} label="Remarks" /></>}
      </RowsEditor>
    </Section>
    <Section title="Final quality assessment" description="You must confirm the final narrative. An AI draft never replaces it automatically.">
      {data.assessmentConfirmationRequired === true ? <AssessmentTile onDraftAi={onDraftAi} aiBusy={aiBusy} aiDraft={aiDraft} aiError={aiError} onUseDraft={onUseDraft} /> : <>
      <TextField path={['narrative']} label="Narrative" multiline />
      {!readOnly && <div className="space-y-3"><Button variant="outline" size="sm" disabled={aiBusy} onClick={onDraftAi}><Sparkles className="mr-2 size-4" />{aiBusy ? 'Drafting...' : 'Draft with VerionAI'}</Button>
        {aiDraft && <div className="space-y-2 rounded-lg border bg-muted/30 p-3"><p className="text-xs font-medium text-muted-foreground">AI draft (editable before use)</p><p className="whitespace-pre-wrap text-sm">{aiDraft}</p><Button size="sm" onClick={onUseDraft}>Copy into narrative</Button></div>}</div>}
      </>}
    </Section>
  </div>;
}
