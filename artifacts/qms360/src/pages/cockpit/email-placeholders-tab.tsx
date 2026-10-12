import { useEffect, useMemo, useState } from 'react';
import { useEmailRuleEventCatalog } from '@workspace/api-client-react';
import { AlertTriangle, ArrowLeft, ArrowRight, Braces, Check, HardDrive, Info, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  BUILT_IN_PLACEHOLDERS, FORMAT_LABELS, WIZARD_STEPS, WORKSPACES, blankWizardState, buildDraft, changeSource, changeWorkspace,
  draftToState, eventsForSource, eventsForWorkspace, findSource, formatToken, formatsForType, generateToken, loadDrafts,
  sampleValue, saveDrafts, sourcesForWorkspace, storageKey, validateStep, workspaceDef,
} from './email-placeholder-model';
import type { EventOption, PlaceholderDraft, WizardState, WorkspaceKey } from './email-placeholder-model';

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Access the localStorage getter inside model try/catch, including restricted browsers.
const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

export function EmailPlaceholdersTab({ userId, organizationName }: { userId?: string; organizationName?: string }) {
  const { toast } = useToast();
  const eventsQuery = useEmailRuleEventCatalog();
  const allEvents: EventOption[] = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const key = userId ? storageKey(userId) : null;
  const [loaded, setLoaded] = useState<{ key: string; drafts: PlaceholderDraft[]; error: string | null } | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceKey>('lessons');
  const [editing, setEditing] = useState<PlaceholderDraft | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PlaceholderDraft | null>(null);

  useEffect(() => {
    if (!key) { setLoaded(null); return; }
    setEditing(null);
    setDeleting(null);
    const r = loadDrafts(browserStorage, key);
    setLoaded({ key, drafts: r.drafts, error: r.error });
  }, [key]);

  // Only expose drafts that belong to the current identity key (avoids cross-user flash).
  const ready = !!key && loaded?.key === key;
  const drafts = ready ? loaded.drafts : [];
  const wsDrafts = drafts.filter((d) => d.workspace === workspace);
  const wsEvents = eventsForWorkspace(allEvents, workspace);

  const persist = (next: PlaceholderDraft[], success: string) => {
    if (!key || !ready || loaded.error) return false;
    const err = saveDrafts(browserStorage, key, next);
    if (err) { toast({ title: 'Draft not saved', description: err, variant: 'destructive' }); return false; }
    setLoaded({ key, drafts: next, error: loaded?.error ?? null });
    toast({ title: success, description: 'Stored in this browser only. Not active in email rules.' });
    return true;
  };

  return <div className="space-y-6">
    <Alert className="border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20" data-testid="alert-draft-phase">
      <HardDrive className="h-4 w-4" />
      <AlertTitle>Draft phase: administrator-local, browser-only</AlertTitle>
      <AlertDescription>Placeholder definitions here are saved only in this browser for your administrator account in {organizationName || 'your organization'}. They are not shared with other administrators, not stored on the server, and cannot be used or activated in email rules yet. Live emails continue to use the built-in placeholders only.</AlertDescription>
    </Alert>

    <div role="radiogroup" aria-label="Workspace" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {WORKSPACES.map((w) => {
        const count = eventsForWorkspace(allEvents, w.key).length;
        const active = w.key === workspace;
        return <button key={w.key} type="button" role="radio" aria-checked={active} data-testid={`button-workspace-${w.key}`} onClick={() => setWorkspace(w.key)}
          className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{w.label}</span><span className="font-mono text-xs text-muted-foreground">{w.tokenPrefix}_</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{eventsQuery.isLoading ? 'Loading events...' : `${count} registered event${count === 1 ? '' : 's'}`}</p>
        </button>;
      })}
    </div>

    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle>{workspaceDef(workspace).label} placeholder drafts</CardTitle><CardDescription>{workspaceDef(workspace).blurb}</CardDescription></div>
        <Button data-testid="button-new-placeholder" disabled={!ready || !!loaded?.error || eventsQuery.isLoading || !!eventsQuery.error || wsEvents.length === 0} onClick={() => setEditing('new')}><Plus className="mr-2 h-4 w-4" />New draft placeholder</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!key && <p className="text-sm text-muted-foreground">Waiting for your administrator identity before reading local drafts...</p>}
        {loaded?.error && ready && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Storage problem</AlertTitle><AlertDescription>{loaded.error} Existing stored data will not be overwritten. <Button size="sm" variant="outline" className="ml-2" onClick={() => { if (key) { const r = loadDrafts(browserStorage, key); setLoaded({ key, drafts: r.drafts, error: r.error }); } }}>Retry storage</Button></AlertDescription></Alert>}
        {eventsQuery.error && <div className="flex items-center justify-between rounded-lg border border-destructive/40 p-3 text-sm"><span className="text-destructive">Event catalog could not be loaded.</span><Button size="sm" variant="outline" onClick={() => eventsQuery.refetch()}>Retry</Button></div>}
        {eventsQuery.isLoading && <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>}
        {!eventsQuery.isLoading && !eventsQuery.error && wsEvents.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm" data-testid="status-no-events">
          <Lock className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="font-medium">Unavailable for this workspace</p>
          <p className="text-muted-foreground">No email events are registered for {workspaceDef(workspace).label}. Source fields are not offered until the platform registers events here.</p>
        </div>}
        {ready && wsDrafts.length === 0 && wsEvents.length > 0 && <div className="rounded-lg border border-dashed p-8 text-center"><Braces className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="font-medium">No drafts yet</p><p className="text-sm text-muted-foreground">Sketch a placeholder from an approved field. It stays a draft in this browser.</p></div>}
        {wsDrafts.length > 0 && <ul className="divide-y rounded-lg border">
          {wsDrafts.map((d) => {
            const src = findSource(d.workspace, d.sourceKey);
            const stale = d.applicability === 'selected' && src ? d.eventIds.filter((id) => !eventsForSource(src, wsEvents).some((e) => e.value === id)) : [];
            return <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={`row-draft-${d.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><code className="rounded bg-muted px-2 py-0.5 text-sm">{formatToken(d.name)}</code><Badge variant="outline">Draft</Badge><Badge variant="secondary">Not active</Badge>{stale.length > 0 && <Badge variant="destructive">{stale.length} stale event{stale.length === 1 ? '' : 's'}</Badge>}</div>
                <p className="mt-1 text-sm text-muted-foreground">{src ? `${src.entityLabel} / ${src.fieldLabel}` : d.sourceKey} · {FORMAT_LABELS[d.format]} · {d.applicability === 'all' ? 'All compatible events' : `${d.eventIds.length} selected event(s)`} · fallback "{d.fallback}"</p>
                {d.description && <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>}
              </div>
              <div className="flex gap-1">
                <Button disabled={!!loaded?.error || eventsQuery.isLoading || !!eventsQuery.error} variant="ghost" size="sm" data-testid={`button-edit-${d.id}`} onClick={() => setEditing(d)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                <Button disabled={!!loaded?.error} variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid={`button-delete-${d.id}`} onClick={() => setDeleting(d)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
              </div>
            </li>;
          })}
        </ul>}
        <details className="rounded-lg border bg-muted/30 p-3 text-sm"><summary className="cursor-pointer font-medium">Built-in placeholders (reserved, cannot be overwritten)</summary><div className="mt-2 flex flex-wrap gap-1.5">{BUILT_IN_PLACEHOLDERS.map((p) => <code key={p} className="rounded bg-background px-1.5 py-0.5 text-xs">{formatToken(p)}</code>)}</div></details>
      </CardContent>
    </Card>

    {editing && ready && <PlaceholderWizard key={`${key}:${editing === 'new' ? 'new' : editing.id}`} initialWorkspace={workspace} draft={editing === 'new' ? null : editing} allEvents={allEvents} drafts={drafts}
      onClose={() => setEditing(null)}
      onSave={(d) => {
        const next = drafts.some((x) => x.id === d.id) ? drafts.map((x) => (x.id === d.id ? d : x)) : [...drafts, d];
        if (persist(next, editing === 'new' ? 'Draft placeholder saved' : 'Draft placeholder updated')) { setWorkspace(d.workspace); setEditing(null); }
      }} />}

    <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete draft {deleting ? formatToken(deleting.name) : ''}?</AlertDialogTitle><AlertDialogDescription>This removes the draft from this browser. It was never active, so no email is affected.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-delete" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (deleting) persist(drafts.filter((d) => d.id !== deleting.id), 'Draft deleted'); setDeleting(null); }}>Delete draft</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function PlaceholderWizard({ initialWorkspace, draft, allEvents, drafts, onClose, onSave }: {
  initialWorkspace: WorkspaceKey; draft: PlaceholderDraft | null; allEvents: EventOption[]; drafts: PlaceholderDraft[];
  onClose: () => void; onSave: (d: PlaceholderDraft) => void;
}) {
  const initial = useMemo<WizardState>(() => {
    if (!draft) return blankWizardState(initialWorkspace);
    const s = draftToState(draft);
    const src = findSource(draft.workspace, draft.sourceKey);
    // Drop stale event IDs that are no longer registered/compatible.
    if (src) s.eventIds = s.eventIds.filter((id) => eventsForSource(src, eventsForWorkspace(allEvents, draft.workspace)).some((e) => e.value === id));
    return s;
  }, [draft, initialWorkspace, allEvents]);
  const [state, setState] = useState<WizardState>(initial);
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [query, setQuery] = useState('');

  const wsEvents = state.workspace ? eventsForWorkspace(allEvents, state.workspace) : [];
  const src = state.workspace ? findSource(state.workspace, state.sourceKey) : undefined;
  const srcEvents = src ? eventsForSource(src, wsEvents) : [];
  const errors = validateStep(step, state, wsEvents, drafts, draft?.id ?? null);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const tokenName = src && state.workspace ? generateToken(state.workspace, src) : '';
  const set = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  const requestClose = () => (dirty ? setConfirmCancel(true) : onClose());
  const next = () => { if (errors.length) { setShowErrors(true); return; } setShowErrors(false); setStep((s) => s + 1); };
  const finish = () => {
    const all = validateStep(4, state, wsEvents, drafts, draft?.id ?? null);
    if (all.length) { setShowErrors(true); return; }
    onSave(buildDraft(state, draft, new Date().toISOString(), newId()));
  };

  const sources = state.workspace ? sourcesForWorkspace(state.workspace) : [];
  const q = query.trim().toLowerCase();
  const filtered = sources.filter((s) => !q || `${s.entityLabel} ${s.fieldLabel} ${s.description} ${s.key}`.toLowerCase().includes(q));
  const groups = [...new Set(filtered.map((s) => s.entityLabel))];

  return <>
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b p-5">
          <DialogTitle>{draft ? 'Edit draft placeholder' : 'New draft placeholder'}</DialogTitle>
          <DialogDescription>Browser-local draft. Not shared and not active in email rules.</DialogDescription>
          <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Wizard progress">
            {WIZARD_STEPS.map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${i === step ? 'border-primary bg-primary text-primary-foreground' : i < step ? 'border-primary/40 text-primary' : 'text-muted-foreground'}`}>
              {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}{label}
            </li>)}
          </ol>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {step === 0 && <fieldset className="space-y-3">
            <legend className="text-sm text-muted-foreground">Which application will this placeholder belong to? Changing workspace clears the source, events and formatting.</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WORKSPACES.map((w) => {
                const n = eventsForWorkspace(allEvents, w.key).length;
                return <label key={w.key} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${state.workspace === w.key ? 'border-primary bg-primary/5' : ''}`}>
                  <input type="radio" name="ws" className="mt-1 accent-[hsl(var(--primary))]" checked={state.workspace === w.key} data-testid={`radio-workspace-${w.key}`} onChange={() => { setState((s) => changeWorkspace(s, w.key)); setQuery(''); }} />
                  <span><span className="block font-medium">{w.label}</span><span className="block text-xs text-muted-foreground">{w.blurb}</span><span className={`mt-1 block text-xs ${n ? 'text-primary' : 'text-destructive'}`}>{n ? `${n} registered events` : 'No registered events: unavailable'}</span></span>
                </label>;
              })}
            </div>
          </fieldset>}

          {step === 1 && <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Only approved fields verified against the {workspaceDef(state.workspace as WorkspaceKey).label} schema are listed. Free-form paths, SQL or code are not accepted.</p>
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search source fields" data-testid="input-search-source" className="pl-9" placeholder="Search fields, entities or descriptions" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <div role="listbox" aria-label="Source fields" className="max-h-[42dvh] overflow-y-auto rounded-lg border">
              {groups.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No fields match "{query}".</p>}
              {groups.map((g) => <div key={g}>
                <p className="sticky top-0 bg-muted/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{g}</p>
                {filtered.filter((s) => s.entityLabel === g).map((s) => {
                  const n = eventsForSource(s, wsEvents).length;
                  const selected = s.key === state.sourceKey;
                  return <button key={s.key} type="button" role="option" aria-selected={selected} disabled={n === 0} data-testid={`option-source-${s.key}`}
                    onClick={() => setState((st) => changeSource(st, s.key, wsEvents))}
                    className={`flex w-full items-start gap-3 border-t px-3 py-2.5 text-left text-sm disabled:opacity-50 ${selected ? 'bg-primary/10' : 'hover:bg-muted/50'}`}>
                    <span className="flex-1"><span className="font-medium">{s.fieldLabel}</span><span className="block text-xs text-muted-foreground">{s.description}</span><span className="block font-mono text-[11px] text-muted-foreground">{s.schemaRef}</span></span>
                    <span className="flex flex-col items-end gap-1"><Badge variant="outline" className="capitalize">{s.type}</Badge><span className="text-[11px] text-muted-foreground">{n ? `${n} event${n === 1 ? '' : 's'}` : 'no events'}</span></span>
                  </button>;
                })}
              </div>)}
            </div>
            {src && <div className="rounded-lg border bg-muted/30 p-3"><Label className="text-xs">Generated token (read-only)</Label><Input readOnly value={formatToken(tokenName)} className="mt-1 font-mono" data-testid="input-generated-token" /><p className="mt-1 text-xs text-muted-foreground">Derived from the workspace prefix and the catalog key, so it stays stable across edits.</p></div>}
          </div>}

          {step === 2 && src && <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{src.origin === 'system' ? 'This draft can apply to registered events in this workspace. Actual system values depend on the event; missing values will use the fallback once email integration is implemented.' : `${src.entityLabel} fields are scoped to events for that entity; configuration events are excluded. Live value resolution will be implemented after the wizard is finalized.`}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['all', 'selected'] as const).map((mode) => <label key={mode} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${state.applicability === mode ? 'border-primary bg-primary/5' : ''}`}>
                <input type="radio" name="app" className="mt-1" checked={state.applicability === mode} data-testid={`radio-applicability-${mode}`} onChange={() => set({ applicability: mode })} />
                <span><span className="block font-medium">{mode === 'all' ? 'All compatible events' : 'Selected events'}</span><span className="text-xs text-muted-foreground">{mode === 'all' ? `${srcEvents.length} registered events today` : 'Pick specific events below'}</span></span>
              </label>)}
            </div>
            {state.applicability === 'selected' && <div className="max-h-[36dvh] space-y-1 overflow-y-auto rounded-lg border p-2">
              {srcEvents.map((e) => <label key={e.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                <Checkbox className="mt-0.5" checked={state.eventIds.includes(e.value)} data-testid={`checkbox-event-${e.value}`} onCheckedChange={(v) => set({ eventIds: v === true ? [...state.eventIds, e.value] : state.eventIds.filter((x) => x !== e.value) })} />
                <span><span className="block">{e.label}</span><span className="font-mono text-[11px] text-muted-foreground">{e.value}</span></span>
              </label>)}
            </div>}
          </div>}

          {step === 3 && src && <div className="space-y-4">
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Format ({src.type})</legend>
              <div className="grid gap-2 sm:grid-cols-2">{formatsForType(src.type).map((f) => <label key={f} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${state.format === f ? 'border-primary bg-primary/5' : ''}`}><input type="radio" name="fmt" checked={state.format === f} data-testid={`radio-format-${f}`} onChange={() => set({ format: f })} />{FORMAT_LABELS[f]}</label>)}</div>
            </fieldset>
            <div><Label htmlFor="ph-fallback">Fallback text</Label><Input id="ph-fallback" data-testid="input-fallback" maxLength={120} value={state.fallback} onChange={(e) => set({ fallback: e.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Shown when the value is empty. Matches built-in behavior: "Not available".</p></div>
            <div><Label htmlFor="ph-desc">Description (optional)</Label><Textarea id="ph-desc" data-testid="input-description" maxLength={300} rows={3} value={state.description} onChange={(e) => set({ description: e.target.value })} placeholder="Why this placeholder is needed and where it will be used" /></div>
          </div>}

          {step === 4 && src && <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Token</dt><dd><code>{formatToken(tokenName)}</code></dd>
              <dt className="text-muted-foreground">Workspace</dt><dd>{workspaceDef(state.workspace as WorkspaceKey).label}</dd>
              <dt className="text-muted-foreground">Source</dt><dd>{src.entityLabel} / {src.fieldLabel} <span className="font-mono text-xs text-muted-foreground">({src.schemaRef})</span></dd>
              <dt className="text-muted-foreground">Events</dt><dd>{state.applicability === 'all' ? `All compatible (${srcEvents.length})` : state.eventIds.join(', ')}</dd>
              <dt className="text-muted-foreground">Format</dt><dd>{FORMAT_LABELS[state.format]}</dd>
              <dt className="text-muted-foreground">Fallback</dt><dd>{state.fallback}</dd>
              {state.description && <><dt className="text-muted-foreground">Description</dt><dd>{state.description}</dd></>}
            </dl>
            <div className="rounded-lg border border-dashed p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Info className="h-3.5 w-3.5" />Illustrative sample, not a live preview</p>
              <p className="text-sm">With value: <span className="rounded bg-primary/10 px-1.5 font-medium">{sampleValue(src, state.format)}</span></p>
              <p className="mt-1 text-sm">When empty: <span className="rounded bg-muted px-1.5">{state.fallback}</span></p>
              <p className="mt-2 text-xs text-muted-foreground">Fixed sample values only. No records are read, and this token is not validated by the email engine.</p>
            </div>
          </div>}

          {showErrors && errors.length > 0 && <Alert variant="destructive" role="alert"><AlertTriangle className="h-4 w-4" /><AlertTitle>Fix before continuing</AlertTitle><AlertDescription><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></AlertDescription></Alert>}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 border-t p-4 sm:justify-between">
          <Button variant="ghost" data-testid="button-wizard-cancel" onClick={requestClose}>Cancel</Button>
          <div className="flex gap-2">
            {step > 0 && <Button variant="outline" data-testid="button-wizard-back" onClick={() => { setShowErrors(false); setStep(step - 1); }}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>}
            {step < WIZARD_STEPS.length - 1 ? <Button data-testid="button-wizard-next" onClick={next}>Next<ArrowRight className="ml-1 h-4 w-4" /></Button>
              : <Button data-testid="button-wizard-save" onClick={finish}><Check className="mr-1 h-4 w-4" />Save draft</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Nothing from this wizard has been saved yet.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-discard" onClick={onClose}>Discard</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
