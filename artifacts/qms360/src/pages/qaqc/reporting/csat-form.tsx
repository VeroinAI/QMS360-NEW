import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Grid, Section, TextField, getIn, useForm } from './form-kit';
import { CSAT_QUESTIONS, CSAT_SCALE, OUTCOMES, fmt } from './reporting-types';

const SELECTED_COLORS: Record<string, string> = {
  '1': 'border-red-600 bg-red-50 text-red-900',
  '2': 'border-orange-600 bg-orange-50 text-orange-900',
  '3': 'border-amber-500 bg-amber-50 text-amber-900',
  '4': 'border-lime-600 bg-lime-50 text-lime-900',
  '5': 'border-green-600 bg-green-50 text-green-900',
};

function SurveyRadio({ path, label, numeric = false }: { path: string[]; label: string; numeric?: boolean }) {
  const f = useForm();
  const id = useId();
  const value = getIn(f.data, path);
  const disabled = f.readOnly || f.fc(path[0]!).disabled;
  const options = numeric ? CSAT_SCALE : OUTCOMES.map(value => ({ value, label: value }));
  return <fieldset disabled={disabled} role="radiogroup" aria-labelledby={`${id}-label`} aria-required="true" className="min-w-0 rounded-lg border p-4">
    <legend id={`${id}-label`} className="px-1 text-sm font-medium">{label}<span className="ml-1 text-destructive" aria-hidden="true">*</span></legend>
    <div className={numeric ? 'grid grid-cols-2 gap-3 sm:grid-cols-5' : 'flex flex-wrap gap-x-6 gap-y-3'}>
      {options.map(option => <label key={option.value} className={numeric ? `relative flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border-2 px-2 py-3 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${String(value ?? '') === option.value ? SELECTED_COLORS[option.value] : 'border-border bg-background text-foreground'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:shadow-sm'}` : `flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input type="radio" name={id} value={option.value} aria-label={option.label} required disabled={disabled} className={numeric ? 'sr-only' : 'size-5 shrink-0 accent-primary'}
          data-testid={`radio-csat-${path.at(-1)}-${option.value}`}
          checked={String(value ?? '') === option.value}
          onChange={() => f.set(path, numeric ? Number(option.value) : option.value)} />
        {numeric ? <><span className="text-2xl font-semibold" aria-hidden="true">{option.value}</span><span>{option.label.slice(option.label.indexOf('–') + 1).trim()}</span><span className="sr-only">{option.value}</span></> : <span className="font-medium">{option.label}</span>}
      </label>)}
    </div>
  </fieldset>;
}

export function CsatForm({ projectName }: { projectName?: string }) {
  const f = useForm();
  const filled = CSAT_QUESTIONS.map(([key]) => Number(getIn(f.data, ['ratings', key])))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 5);
  const avg = filled.length ? filled.reduce((sum, value) => sum + value, 0) / filled.length : 0;
  return <div className="space-y-6">
    <Section title="Project Name" description="Auto-filled from the selected project master record.">
      <Input aria-label="Project Name" data-testid="input-csat-project-name" readOnly value={projectName ?? ''} placeholder="Select a project above" />
    </Section>
    <Section title="Customer feedback" description="Scale: 1 = Very Dissatisfied, 5 = Excellent">
      <p className="text-sm text-muted-foreground">Select one rating for each question. All six ratings are required.</p>
      <div className="space-y-4">{CSAT_QUESTIONS.map(([key, label]) =>
        <SurveyRadio key={key} path={['ratings', key]} label={label} numeric />)}</div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{filled.length ? `Average score: ${fmt(avg, 2)} of 5 (${filled.length} of 6 answered).` : 'No ratings selected yet.'}</p>
    </Section>
    <Section title="Qualitative Feedback" description="These text fields are optional.">
      <TextField path={['satisfactoryAspects']} label="Most Satisfactory Aspects" multiline />
      <TextField path={['improvementSuggestions']} label="Improvement Suggestions" multiline />
    </Section>
    <Section title="Project outcomes"><Grid cols={2}>
      <SurveyRadio path={['expectations']} label="Project Completed as per Expectations" />
      <SurveyRadio path={['recommend']} label="Would Recommend Our Services" />
    </Grid></Section>
    <Section title="Additional Comments / Recommendations" description="Optional comments or recommendations.">
      <TextField path={['comments']} label="Additional Comments / Recommendations" multiline />
    </Section>
  </div>;
}