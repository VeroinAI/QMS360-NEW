import { useEffect, useState } from 'react';
import { useUpdateProjectAdditionalData } from '@workspace/api-client-react';
import type { DronaProjectMasterRecord, ProjectAdditionalData, ProjectAdditionalDataResult } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { projectContactErrors } from './project-contact-validation';

export const CLOSURE_TARGET_FIELDS = [['external_ncr', 'External NCR'], ['internal_ncr', 'Internal NCR'], ['rfi', 'RFI'], ['rmi', 'RMI'], ['pqi', 'PQI']] as const;
type TargetKey = typeof CLOSURE_TARGET_FIELDS[number][0];
type ClosureTargets = Record<TargetKey, number | null>;
function targetError(raw: string) {
  const t = raw.trim();
  if (!t) return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? '' : 'Enter a number from 0 to 100, or leave blank.';
}

const fields: Array<[keyof ProjectAdditionalData, string]> = [
  ['client', 'Client'], ['contractor', 'Contractor'],
  ['contractProjectNumber', 'Contract / project no.'], ['contractSigned', 'Contract signed'],
  ['contractPeriod', 'Contract period'], ['tcc', 'TCC'], ['pac', 'PAC'], ['fac', 'FAC'],
  ['name', 'Name'],
  ['email', 'Email address'], ['phone', 'Phone'],
];

export function ProjectAdditionalDataEditor({ record, canEdit, onSaved, onPendingChange, onCancel }: {
  record: DronaProjectMasterRecord;
  canEdit: boolean;
  onSaved: (result: ProjectAdditionalDataResult) => void;
  onPendingChange: (pending: boolean) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(([key]) => [key, record.additionalData?.[key] ?? ''])) as Record<keyof ProjectAdditionalData, string>);
  const [costCentre, setCostCentre] = useState(record.costCentre ?? '');
  const savedTargets = record.closureTargets ?? {};
  const [targets, setTargets] = useState(() => Object.fromEntries(CLOSURE_TARGET_FIELDS.map(([key]) => [key, savedTargets[key] == null ? '' : String(savedTargets[key])])) as Record<TargetKey, string>);
  const targetErrors = Object.fromEntries(CLOSURE_TARGET_FIELDS.map(([key]) => [key, targetError(targets[key])])) as Record<TargetKey, string>;
  const invalidTargets = Object.values(targetErrors).some(Boolean);
  const normalizedTargets = Object.fromEntries(CLOSURE_TARGET_FIELDS.map(([key]) => [key, targets[key].trim() === '' ? null : Number(targets[key])])) as ClosureTargets;
  const targetsChanged = CLOSURE_TARGET_FIELDS.some(([key]) => normalizedTargets[key] !== (savedTargets[key] ?? null));
  const update = useUpdateProjectAdditionalData();
  useEffect(() => {
    onPendingChange(update.isPending);
    return () => onPendingChange(false);
  }, [update.isPending, onPendingChange]);
  const normalized: ProjectAdditionalData = {
    name: values.name.trim() || null,
    client: values.client.trim() || null, contractor: values.contractor.trim() || null,
    contractProjectNumber: values.contractProjectNumber.trim() || null, contractSigned: values.contractSigned.trim() || null,
    contractPeriod: values.contractPeriod.trim() || null, tcc: values.tcc.trim() || null,
    pac: values.pac.trim() || null, fac: values.fac.trim() || null,
    email: values.email.trim() || null, phone: values.phone.trim() || null,
  };
  const contactErrors = projectContactErrors(values.email, values.phone);
  const invalidContact = !!(contactErrors.email || contactErrors.phone);
  const changed = targetsChanged || (costCentre.trim() || null) !== (record.costCentre ?? null) ||
    fields.some(([key]) => normalized[key] !== (record.additionalData?.[key] ?? null));

  return <form className="space-y-5" onSubmit={event => {
    event.preventDefault();
    if (!canEdit || !changed || update.isPending || invalidContact || invalidTargets) return;
    update.mutate({ projectId: record.id, data: { costCentre: costCentre.trim() || null, additionalData: normalized, closureTargets: normalizedTargets } }, { onSuccess: onSaved });
  }}>
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(([key, label]) => <div key={key} className="space-y-2">
        <Label htmlFor={`project-additional-${key}`}>{label}</Label>
        <Input id={`project-additional-${key}`} type={key === 'contractSigned' ? 'date' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
          value={values[key]} maxLength={key === 'contractSigned' ? undefined : key === 'email' ? 254 : key === 'phone' ? 32 : 500}
          autoComplete={key === 'email' ? 'email' : key === 'phone' ? 'tel' : undefined}
          aria-invalid={key === 'email' ? !!contactErrors.email : key === 'phone' ? !!contactErrors.phone : undefined}
          aria-describedby={key === 'email' || key === 'phone' ? `project-contact-${key}-help` : undefined}
          disabled={update.isPending || !canEdit}
          onChange={event => { setValues(previous => ({ ...previous, [key]: event.target.value })); update.reset(); }}
          placeholder={key === 'contractSigned' ? undefined : key === 'email' ? 'name@example.com' : key === 'phone' ? '+91 9876543210' : key === 'contractPeriod' ? 'e.g. 24 months' : `Enter ${label}`}
          data-testid={`input-project-additional-${key}`} />
        {(key === 'email' || key === 'phone') && <p id={`project-contact-${key}-help`} className={`text-xs ${contactErrors[key] ? 'text-destructive' : 'text-muted-foreground'}`} role={contactErrors[key] ? 'alert' : undefined}>
          {contactErrors[key] || (key === 'phone' ? 'Include + and the country code, e.g. +91 9876543210.' : 'Optional. Enter a valid email address.')}
        </p>}
      </div>)}
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="project-cost-centre">Cost center</Label>
        <Input id="project-cost-centre" value={costCentre} maxLength={100}
          disabled={update.isPending || !canEdit}
          onChange={event => { setCostCentre(event.target.value); update.reset(); }}
          placeholder="Enter the project's cost center" data-testid="input-project-cost-centre" />
        <p className="text-xs text-muted-foreground">Used for new Lessons Learned reference numbers. Existing references keep their numbers.</p>
      </div>
    </div>
    <fieldset className="rounded-lg border p-4" data-testid="tile-closure-target">
      <legend className="px-1 text-sm font-semibold">Closure Target (%)</legend>
      <p className="mb-3 text-xs text-muted-foreground">Project-level closure targets used by QA/QC reporting. Leave a field blank to clear the project override.</p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CLOSURE_TARGET_FIELDS.map(([key, label]) => <div key={key} className="space-y-1">
          <Label htmlFor={`project-target-${key}`}>{label}</Label>
          <Input id={`project-target-${key}`} type="number" inputMode="decimal" min={0} max={100} step="any" value={targets[key]}
            aria-invalid={!!targetErrors[key]} aria-describedby={targetErrors[key] ? `project-target-${key}-error` : undefined}
            disabled={update.isPending || !canEdit}
            onChange={event => { setTargets(previous => ({ ...previous, [key]: event.target.value })); update.reset(); }}
            data-testid={`input-project-target-${key}`} />
          {targetErrors[key] && <p id={`project-target-${key}-error`} role="alert" className="text-xs text-destructive">{targetErrors[key]}</p>}
        </div>)}
      </div>
    </fieldset>
    <p className="text-xs text-muted-foreground">All fields are optional. Leave a field blank and save to clear its value. These are QMS360-managed values; source project records are not changed.</p>
    {update.isError && <p role="alert" className="text-sm text-destructive">{update.error instanceof Error ? update.error.message : 'Additional data could not be saved. Your entries are retained; try again.'}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={update.isPending}>{canEdit ? 'Cancel' : 'Close'}</Button>
      {canEdit && <Button type="submit" disabled={!changed || update.isPending || invalidContact || invalidTargets} data-testid="button-save-project-additional-data">
        {update.isPending ? 'Saving…' : 'Save additional data'}
      </Button>}
    </div>
  </form>;
}
