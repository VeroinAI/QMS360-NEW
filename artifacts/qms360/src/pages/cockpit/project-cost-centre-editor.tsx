import { useEffect, useState } from 'react';
import { useUpdateDronaProjectCostCentre } from '@workspace/api-client-react';
import type { DronaProjectMasterRecord, ProjectCostCentreResult } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ProjectCostCentreEditor({ record, onSaved, onPendingChange }: {
  record: DronaProjectMasterRecord;
  onSaved: (result: ProjectCostCentreResult) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [value, setValue] = useState(record.costCentre ?? '');
  const update = useUpdateDronaProjectCostCentre();
  useEffect(() => {
    onPendingChange(update.isPending);
    return () => onPendingChange(false);
  }, [update.isPending, onPendingChange]);
  const normalized = value.trim() || null;
  const changed = normalized !== (record.costCentre ?? null);
  return <form className="space-y-3 rounded-lg border p-4" onSubmit={event => {
    event.preventDefault();
    if (!changed || update.isPending) return;
    update.mutate({ projectId: record.id, data: { costCentre: normalized } }, { onSuccess: onSaved });
  }}>
    <div>
      <Label htmlFor="project-cost-centre">Cost center</Label>
      <Input id="project-cost-centre" value={value} maxLength={100} disabled={update.isPending}
        onChange={event => { setValue(event.target.value); update.reset(); }}
        placeholder="Enter the project's cost center" data-testid="input-project-cost-centre" />
      <p className="mt-2 text-xs text-muted-foreground">QMS360-managed cost center for Lessons Learned numbering. Leave blank and save to clear. Other project details remain maintained in Drona.</p>
    </div>
    {update.isError && <p role="alert" className="text-sm text-destructive">{update.error instanceof Error ? update.error.message : 'Cost center could not be saved. Your entry has been retained; try again.'}</p>}
    <Button type="submit" disabled={!changed || update.isPending} data-testid="button-save-project-cost-centre">
      {update.isPending ? 'Saving…' : 'Save cost center'}
    </Button>
  </form>;
}
