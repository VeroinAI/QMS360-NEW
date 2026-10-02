import { Grid, SelectField, Section, TextField, getIn, useForm } from './form-kit';
import { CSAT_RATINGS, OUTCOMES, fmt, num } from './reporting-types';

export function CsatForm() {
  const f = useForm();
  const vals = CSAT_RATINGS.map(([k]) => num(getIn(f.data, ['ratings', k])));
  const filled = vals.filter(Boolean);
  const avg = filled.length ? filled.reduce((a, b) => a + b, 0) / filled.length : 0;
  return <div className="space-y-6">
    <Section title="Service ratings" description={`Rate 1 (poor) to 5 (excellent). Average score ${fmt(avg, 2)} of 5.`}>
      <Grid cols={3}>{CSAT_RATINGS.map(([k, l]) => <SelectField key={k} path={['ratings', k]} label={l} options={['1', '2', '3', '4', '5']} />)}</Grid>
    </Section>
    <Section title="Outcomes"><Grid cols={2}><SelectField path={['expectations']} label="Were expectations met?" options={OUTCOMES} /><SelectField path={['recommend']} label="Would the customer recommend us?" options={OUTCOMES} /></Grid></Section>
    <Section title="Comments"><TextField path={['satisfactoryAspects']} label="Satisfactory aspects" multiline /><TextField path={['improvementSuggestions']} label="Improvement suggestions" multiline /><TextField path={['comments']} label="Other comments" multiline /></Section>
  </div>;
}
