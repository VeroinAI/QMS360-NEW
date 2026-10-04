import { useState } from 'react';
import { auditEmailTemplateExamples, emailTemplateFields, renderEmailRuleTemplate, type EmailRuleTemplate } from '@workspace/field-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const previewValues = Object.fromEntries(emailTemplateFields.map(key => [key, `[Sample ${key.replaceAll('_', ' ')}]`]));
export function EmailRuleTemplateEditor({ template, onChange }: {
  template: EmailRuleTemplate; onChange: (value: EmailRuleTemplate) => void;
}) {
  const [example, setExample] = useState<keyof typeof auditEmailTemplateExamples>('request');
  const preview = renderEmailRuleTemplate(template, {
    subject: '[Default event subject]', text: '[Default event body]',
  }, { ...previewValues, system_name: 'QMS360' });
  return <section className="space-y-4 rounded-lg border bg-muted/20 p-4" aria-label="Email template">
    <div>
      <h4 className="text-sm font-semibold">Email template</h4>
      <p className="mt-1 text-xs text-muted-foreground">Saved separately for this rule and used when its event sends email. Leave either field blank to keep the default subject or body. Templates do not change recipients, approval routing or attachments.</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Audit email example" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        value={example} onChange={event => setExample(event.target.value as typeof example)}>
        {Object.entries(auditEmailTemplateExamples).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={() => {
        const selected = auditEmailTemplateExamples[example];
        onChange({ subjectTemplate: selected.subjectTemplate, bodyTemplate: selected.bodyTemplate });
      }}>Use example</Button>
    </div>
    <p className="text-xs text-muted-foreground">Examples are adapted from the supplied Audit email document. “Use example” replaces the draft subject and body; you can edit them before saving.</p>
    <div className="space-y-2">
      <Label htmlFor="rule-email-subject">Email subject</Label>
      <Input id="rule-email-subject" maxLength={250} value={template.subjectTemplate ?? ''}
        onChange={event => onChange({ subjectTemplate: event.target.value })} placeholder="{audit_schedule_name} – Approval Required" />
    </div>
    <div className="space-y-2">
      <Label htmlFor="rule-email-body">Email body</Label>
      <Textarea id="rule-email-body" rows={10} maxLength={20000} value={template.bodyTemplate ?? ''}
        onChange={event => onChange({ bodyTemplate: event.target.value })} placeholder="Dear {recipient_name},&#10;&#10;Enter the email body for this rule…" />
      <p className="text-xs text-muted-foreground">Plain text; line breaks are preserved. Missing record values appear as “Not available”.</p>
    </div>
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Insert a body placeholder</summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {emailTemplateFields.map(key => <Button type="button" key={key} variant="outline" size="sm"
          className="h-7 font-mono text-xs" onClick={() => onChange({ bodyTemplate: `${template.bodyTemplate ?? ''}{${key}}` })}>{`{${key}}`}</Button>)}
      </div>
    </details>
    <details className="rounded-md border bg-background p-3 text-sm">
      <summary className="cursor-pointer font-medium">Preview with sample values</summary>
      <p className="my-2 text-xs text-muted-foreground">Illustration only. Actual values come from the recipient and event record, where available.</p>
      <p className="break-words font-semibold">{preview.subject}</p>
      <p className="mt-3 whitespace-pre-wrap break-words">{preview.text}</p>
    </details>
  </section>;
}