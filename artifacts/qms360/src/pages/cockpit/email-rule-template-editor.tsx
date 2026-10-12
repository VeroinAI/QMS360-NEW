import { useState } from 'react';
import type { EmailPlaceholderDefinition } from '@workspace/api-client-react';
import { auditEmailTemplateExamples, emailTemplateFields, renderEmailRuleTemplate, type EmailRuleTemplate } from '@workspace/field-controls';
import { AlertTriangle, Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { definitionMatchesEvent, findSource, formatToken, sampleValue } from './email-placeholder-model';

/** Saved definitions (active or inactive) that can resolve on this exact event. */
export function compatibleDefinitions(defs: EmailPlaceholderDefinition[], eventType: string) {
  return eventType ? defs.filter((d) => definitionMatchesEvent(d, eventType)) : [];
}

function referencedNames(text: string) {
  return new Set([...text.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*\}/g)].map((m) => m[1].toLowerCase()));
}

const previewValues = Object.fromEntries(emailTemplateFields.map(key => [key, `[Sample ${key.replaceAll('_', ' ')}]`]));
export function EmailRuleTemplateEditor({ template, onChange, eventType = '', definitions = [], definitionsLoading, definitionsError }: {
  template: EmailRuleTemplate; onChange: (value: EmailRuleTemplate) => void;
  eventType?: string; definitions?: EmailPlaceholderDefinition[]; definitionsLoading?: boolean; definitionsError?: boolean;
}) {
  const [example, setExample] = useState<keyof typeof auditEmailTemplateExamples>('request');
  const compatible = compatibleDefinitions(definitions, eventType);
  const active = compatible.filter((d) => d.active);
  const refs = referencedNames(`${template.subjectTemplate ?? ''}\n${template.bodyTemplate ?? ''}`);
  const inactiveReferenced = compatible.filter((d) => !d.active && refs.has(d.name));
  const customValues = Object.fromEntries(compatible.map((d) => {
    const src = findSource(d.workspace, d.sourceKey);
    return [d.name, d.active && src ? sampleValue(src, d.format) : d.fallback];
  }));
  const preview = renderEmailRuleTemplate(template, {
    subject: '[Default event subject]', text: '[Default event body]',
  }, { ...previewValues, ...customValues, system_name: 'QMS360' });
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
      <p className="text-xs text-muted-foreground">Plain text; line breaks are preserved. Missing record values appear as “Not available”. Placeholders can be typed into the subject too.</p>
    </div>
    {inactiveReferenced.length > 0 && <div role="alert" data-testid="alert-inactive-placeholders" className="rounded-md border border-amber-500/50 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/20">
      <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Inactive custom placeholders in this template</p>
      <ul className="mt-1 space-y-0.5 text-xs">{inactiveReferenced.map((d) => <li key={d.id}><code>{formatToken(d.name)}</code> is inactive. Future emails will show its fallback “{d.fallback}”. Already queued emails are unchanged.</li>)}</ul>
    </div>}
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Insert a body placeholder</summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {emailTemplateFields.map(key => <Button type="button" key={key} variant="outline" size="sm"
          className="h-7 font-mono text-xs" onClick={() => onChange({ bodyTemplate: `${template.bodyTemplate ?? ''}{${key}}` })}>{`{${key}}`}</Button>)}
      </div>
      <div className="mt-3 rounded-md border border-dashed p-2.5" data-testid="section-custom-placeholders">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Braces className="h-3.5 w-3.5" />Custom placeholders for this event</p>
        {!eventType ? <p className="text-xs text-muted-foreground">Select an event to see compatible custom placeholders.</p>
          : definitionsLoading ? <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          : definitionsError ? <p className="text-xs text-destructive">Custom placeholders could not be loaded. Built-in placeholders still work.</p>
          : active.length === 0 ? <p className="text-xs text-muted-foreground">No active custom placeholders match this event.</p>
          : <div className="flex flex-wrap gap-1.5">{active.map((d) => <Button type="button" key={d.id} variant="outline" size="sm" title={d.description || undefined}
              data-testid={`button-insert-custom-${d.name}`} className="h-7 border-primary/40 font-mono text-xs"
              onClick={() => onChange({ bodyTemplate: `${template.bodyTemplate ?? ''}${formatToken(d.name)}` })}>{formatToken(d.name)}</Button>)}</div>}
      </div>
    </details>
    <details className="rounded-md border bg-background p-3 text-sm">
      <summary className="cursor-pointer font-medium">Preview with sample values</summary>
      <p className="my-2 text-xs text-muted-foreground">Illustration only. Actual values come from the recipient and event record, where available. Inactive custom placeholders show their fallback.</p>
      <p className="break-words font-semibold">{preview.subject}</p>
      <p className="mt-3 whitespace-pre-wrap break-words">{preview.text}</p>
    </details>
  </section>;
}
