import { emailReportOptions } from '@workspace/field-controls';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';

export function EmailRuleAttachmentEditor({ eventType, value, onChange }: {
  eventType: string; value: string[]; onChange: (value: string[]) => void;
}) {
  const options = emailReportOptions(eventType);
  const selected = options.filter(option => value.includes(option.value));
  return <div className="mt-4 space-y-2">
    <Label htmlFor="email-rule-report-attachment">Report attachment (optional)</Label>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" id="email-rule-report-attachment" aria-label="Report attachment"
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>{selected.length ? selected.map(option => option.label).join(', ') : 'No attachment'}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
        <DropdownMenuCheckboxItem checked={!selected.length} onCheckedChange={() => onChange([])} onSelect={event => event.preventDefault()}>
          No attachment
        </DropdownMenuCheckboxItem>
        {options.length > 0 && <DropdownMenuSeparator />}
        {options.map(option => <DropdownMenuCheckboxItem key={option.value} checked={value.includes(option.value)}
          onSelect={event => event.preventDefault()}
          onCheckedChange={checked => onChange(checked ? [...new Set([...value, option.value])] : value.filter(item => item !== option.value))}>
          {option.label}
        </DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <p className="text-xs text-muted-foreground">{options.length
      ? 'Select one or more reports. All selected reports are generated from the triggering record and attached to the same email. No attachment clears the selection.'
      : eventType ? 'This event has no standalone PDF or PowerPoint report. Its email will be sent without an attachment.'
        : 'Select an event to see its available PDF or PowerPoint reports.'}</p>
  </div>;
}
