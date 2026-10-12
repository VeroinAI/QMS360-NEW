import { useLayoutEffect, useRef, useState } from 'react';
import type { EmailPlaceholderDefinition } from '@workspace/api-client-react';
import { auditEmailTemplateExamples, emailTemplateFields, renderEmailRuleTemplate, type EmailRuleTemplate, type EmailRichDocument } from '@workspace/field-controls';
import { AlertTriangle, Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { definitionMatchesEvent, findSource, formatToken, sampleValue } from './email-placeholder-model';
import { insertEmailPlaceholder } from './insert-email-placeholder';
import { EmailRichBodyEditor, type EmailRichBodyEditorHandle } from './email-rich-body-editor';

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
  type TemplateField = 'subjectTemplate' | 'bodyTemplate';
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<EmailRichBodyEditorHandle>(null);
  const lastFocusedField = useRef<TemplateField | null>(null);
  const pendingInsertion = useRef<{ field: TemplateField; value: string; caret: number; scrollTop: number } | null>(null);
  const [insertionError, setInsertionError] = useState<string | null>(null);

  // Restore focus and caret only after React has applied the controlled value.
  useLayoutEffect(() => {
    const pending = pendingInsertion.current;
    if (!pending || template[pending.field] !== pending.value) return;
    const element = subjectRef.current;
    pendingInsertion.current = null;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(pending.caret, pending.caret);
    element.scrollTop = pending.scrollTop;
  });

  const insertPlaceholder = (token: string) => {
    const field = lastFocusedField.current ?? 'bodyTemplate';
    if (field === 'bodyTemplate') {
      const result = bodyRef.current?.insertPlaceholder(token) ?? { ok: false as const, error: 'The body editor is still loading.' };
      setInsertionError(result.ok ? null : result.error);
      lastFocusedField.current = 'bodyTemplate';
      return;
    }
    const element = subjectRef.current;
    const text = template[field] ?? '';
    const start = lastFocusedField.current ? element?.selectionStart ?? text.length : text.length;
    const end = lastFocusedField.current ? element?.selectionEnd ?? start : start;
    const maxLength = field === 'subjectTemplate' ? 250 : 20000;
    const inserted = insertEmailPlaceholder(text, token, start, end, maxLength);
    if (!inserted) {
      setInsertionError(`The email ${field === 'subjectTemplate' ? 'subject' : 'body'} cannot exceed ${maxLength.toLocaleString()} characters. Shorten it or select text to replace.`);
      return;
    }
    setInsertionError(null);
    pendingInsertion.current = { field, ...inserted, scrollTop: element?.scrollTop ?? 0 };
    lastFocusedField.current = field;
    onChange({ [field]: inserted.value });
  };
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
        lastFocusedField.current = null;
        pendingInsertion.current = null;
        setInsertionError(null);
        onChange({ subjectTemplate: selected.subjectTemplate, bodyTemplate: selected.bodyTemplate, bodyRichText: null });
      }}>Use example</Button>
    </div>
    <p className="text-xs text-muted-foreground">Examples are adapted from the supplied Audit email document. “Use example” replaces the draft subject and body; you can edit them before saving.</p>
    <div className="space-y-2">
      <Label htmlFor="rule-email-subject">Email subject</Label>
      <Input ref={subjectRef} id="rule-email-subject" maxLength={250} value={template.subjectTemplate ?? ''}
        onFocus={() => { lastFocusedField.current = 'subjectTemplate'; }}
        onChange={event => { setInsertionError(null); onChange({ subjectTemplate: event.target.value }); }} placeholder="{audit_schedule_name} – Approval Required" />
    </div>
    <div className="space-y-2">
      <Label htmlFor="rule-email-body" onClick={() => bodyRef.current?.focus()}>Email body</Label>
      <EmailRichBodyEditor ref={bodyRef} value={template.bodyRichText as EmailRichDocument | null | undefined} plain={template.bodyTemplate ?? ''}
        onFocus={() => { lastFocusedField.current = 'bodyTemplate'; }}
        onError={setInsertionError}
        onChange={next => onChange(next)} placeholder={'Dear {recipient_name},\n\nEnter the email body for this rule…'} />
      <p className="text-xs text-muted-foreground">Select text and use the toolbar for bold, italic, underline or color; formatting is kept in the sent email. Line breaks are preserved. Missing record values appear as “Not available”. Click in the subject or body, then choose a placeholder to insert at the cursor or replace selected text.</p>
    </div>
    {inactiveReferenced.length > 0 && <div role="alert" data-testid="alert-inactive-placeholders" className="rounded-md border border-amber-500/50 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/20">
      <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Inactive custom placeholders in this template</p>
      <ul className="mt-1 space-y-0.5 text-xs">{inactiveReferenced.map((d) => <li key={d.id}><code>{formatToken(d.name)}</code> is inactive. Future emails will show its fallback “{d.fallback}”. Already queued emails are unchanged.</li>)}</ul>
    </div>}
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Insert a placeholder at the cursor</summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {emailTemplateFields.map(key => <Button type="button" key={key} variant="outline" size="sm"
          className="h-7 font-mono text-xs" onClick={() => insertPlaceholder(`{${key}}`)}>{`{${key}}`}</Button>)}
      </div>
      <div className="mt-3 rounded-md border border-dashed p-2.5" data-testid="section-custom-placeholders">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Braces className="h-3.5 w-3.5" />Custom placeholders for this event</p>
        {!eventType ? <p className="text-xs text-muted-foreground">Select an event to see compatible custom placeholders.</p>
          : definitionsLoading ? <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          : definitionsError ? <p className="text-xs text-destructive">Custom placeholders could not be loaded. Built-in placeholders still work.</p>
          : active.length === 0 ? <p className="text-xs text-muted-foreground">No active custom placeholders match this event.</p>
          : <div className="flex flex-wrap gap-1.5">{active.map((d) => <Button type="button" key={d.id} variant="outline" size="sm" title={d.description || undefined}
              data-testid={`button-insert-custom-${d.name}`} className="h-7 border-primary/40 font-mono text-xs"
              onClick={() => insertPlaceholder(formatToken(d.name))}>{formatToken(d.name)}</Button>)}</div>}
      </div>
      {insertionError && <p role="alert" className="mt-2 text-sm text-destructive">{insertionError}</p>}
    </details>
    <details className="rounded-md border bg-background p-3 text-sm">
      <summary className="cursor-pointer font-medium">Preview with sample values</summary>
      <p className="my-2 text-xs text-muted-foreground">Illustration only. Actual values come from the recipient and event record, where available. Inactive custom placeholders show their fallback.</p>
      <p className="break-words font-semibold">{preview.subject}</p>
      {preview.html
        ? <div className="email-rich-preview mt-3 break-words" data-testid="text-preview-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
        : <p className="mt-3 whitespace-pre-wrap break-words" data-testid="text-preview-body">{preview.text}</p>}
    </details>
  </section>;
}
