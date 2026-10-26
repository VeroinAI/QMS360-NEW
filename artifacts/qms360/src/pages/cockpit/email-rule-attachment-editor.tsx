import { emailReportOptions } from '@workspace/field-controls';
import { NativeSelection } from '@/components/ui/native-selection';
import { Label } from '@/components/ui/label';

export function EmailRuleAttachmentEditor({ eventType, value, onChange }: {
  eventType: string; value: string; onChange: (value: string) => void;
}) {
  const options = emailReportOptions(eventType);
  return <div className="mt-4 space-y-2">
    <Label htmlFor="email-rule-report-attachment">Report attachment (optional)</Label>
    <NativeSelection id="email-rule-report-attachment" aria-label="Report attachment"
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
      value={value} onChange={event => onChange(event.target.value)}>
      <option value="">No attachment</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </NativeSelection>
    <p className="text-xs text-muted-foreground">{options.length
      ? 'Generated from the record that triggers this event. No attachment sends the email without a report.'
      : eventType ? 'This event has no standalone PDF or PowerPoint report. Its email will be sent without an attachment.'
        : 'Select an event to see its available PDF or PowerPoint reports.'}</p>
  </div>;
}
