import { useEffect, useState } from 'react';
import { useUpdateProjectAdditionalData } from '@workspace/api-client-react';
import type { DronaProjectMasterRecord, ProjectAdditionalData, ProjectAdditionalDataResult } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { projectContactErrors } from './project-contact-validation';

const fields: Array<[keyof ProjectAdditionalData, string]> = [
  ['client', 'Client'], ['contractor', 'Contractor'],
  ['contractProjectNumber', 'Contract / project no.'], ['contractSigned', 'Contract signed'],
  ['contractPeriod', 'Contract period'], ['tcc', 'TCC'], ['pac', 'PAC'], ['fac', 'FAC'],
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
  const update = useUpdateProjectAdditionalData();
  useEffect(() => {
    onPendingChange(update.isPending);
    return () => onPendingChange(false);
  }, [update.isPending, onPendingChange]);
  const normalized: ProjectAdditionalData = {
    client: values.client.trim() || null, contractor: values.contractor.trim() || null,
    contractProjectNumber: values.contractProjectNumber.trim() || null, contractSigned: values.contractSigned.trim() || null,
    contractPeriod: values.contractPeriod.trim() || null, tcc: values.tcc.trim() || null,
    pac: values.pac.trim() || null, fac: values.fac.trim() || null,
    email: values.email.trim() || null, phone: values.phone.trim() || null,
  };
  const contactErrors = projectContactErrors(values.email, values.phone);
  const invalidContact = !!(contactErrors.email || contactErrors.phone);
  const changed = (costCentre.trim() || null) !== (record.costCentre ?? null) ||
    fields.some(([key]) => normalized[key] !== (record.additionalData?.[key] ?? null));

  return <form className="space-y-5" onSubmit={event => {
    event.preventDefault();
    if (!canEdit || !changed || update.isPending || invalidContact) return;
    update.mutate({ projectId: record.id, data: { costCentre: costCentre.trim() || null, additionalData: normalized } }, { onSuccess: onSaved });
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
    <p className="text-xs text-muted-foreground">All fields are optional. Leave a field blank and save to clear its value. These are QMS360-managed values; source project records are not changed.</p>
    {update.isError && <p role="alert" className="text-sm text-destructive">{update.error instanceof Error ? update.error.message : 'Additional data could not be saved. Your entries are retained; try again.'}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={update.isPending}>{canEdit ? 'Cancel' : 'Close'}</Button>
      {canEdit && <Button type="submit" disabled={!changed || update.isPending || invalidContact} data-testid="button-save-project-additional-data">
        {update.isPending ? 'Saving…' : 'Save additional data'}
      </Button>}
    </div>
  </form>;
}
