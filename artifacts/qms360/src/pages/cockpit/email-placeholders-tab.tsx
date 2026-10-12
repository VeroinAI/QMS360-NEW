import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListEmailPlaceholdersQueryKey, useCreateEmailPlaceholder, useDeleteEmailPlaceholder, useEmailRuleEventCatalog,
  useListEmailPlaceholders, useSetEmailPlaceholderActivation, useUpdateEmailPlaceholder,
} from '@workspace/api-client-react';
import type { EmailPlaceholderDefinition, EmailPlaceholderInput } from '@workspace/api-client-react';
import { AlertTriangle, ArrowLeft, ArrowRight, Braces, Check, CloudUpload, HardDrive, Info, Lock, Pencil, Plus, Power, PowerOff, RefreshCw, Search, Server, Trash2 } from 'lucide-react';
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
function errMsg(e: unknown) { return e instanceof Error ? e.message : 'Request failed'; }
function isConflict(e: unknown) { return !!e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 409; }
function toInput(d: PlaceholderDraft): EmailPlaceholderInput {
  return { workspace: d.workspace, sourceKey: d.sourceKey, applicability: d.applicability, eventIds: d.eventIds, format: d.format, fallback: d.fallback, description: d.description };
}

// Access the localStorage getter inside model try/catch, including restricted browsers.
const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

type Editing = { kind: 'new' } | { kind: 'server'; def: EmailPlaceholderDefinition } | { kind: 'local'; draft: PlaceholderDraft };

export function EmailPlaceholdersTab({ userId, organizationName }: { userId?: string; organizationName?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const eventsQuery = useEmailRuleEventCatalog();
  const allEvents: EventOption[] = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  // Separate client caches by identity as well as server-side organization scoping.
  const registry = useListEmailPlaceholders({ query: { queryKey: [...getListEmailPlaceholdersQueryKey(), userId], refetchOnMount: 'always', refetchInterval: 30_000, enabled: !!userId } });
  const defs = useMemo(() => registry.data ?? [], [registry.data]);
  const createM = useCreateEmailPlaceholder();
  const updateM = useUpdateEmailPlaceholder();
  const deleteM = useDeleteEmailPlaceholder();
  const activationM = useSetEmailPlaceholderActivation();
  const invalidate = () => qc.invalidateQueries({ queryKey: getListEmailPlaceholdersQueryKey() });

  const key = userId ? storageKey(userId) : null;
  const [loaded, setLoaded] = useState<{ key: string; drafts: PlaceholderDraft[]; error: string | null } | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceKey>('lessons');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<EmailPlaceholderDefinition | null>(null);
  const [deletingLocal, setDeletingLocal] = useState<PlaceholderDraft | null>(null);
  const [toggling, setToggling] = useState<EmailPlaceholderDefinition | null>(null);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<{ created: number; skipped: number; failed: Array<{ name: string; error: string }> } | null>(null);

  useEffect(() => {
    if (!key) { setLoaded(null); return; }
    setEditing(null); setDeleting(null); setDeletingLocal(null); setToggling(null); setImportReport(null);
    const r = loadDrafts(browserStorage, key);
    setLoaded({ key, drafts: r.drafts, error: r.error });
  }, [key]);

  const ready = !!key && loaded?.key === key;
  const drafts = ready ? loaded.drafts : [];
  const wsDefs = defs.filter((d) => d.workspace === workspace);
  const wsEvents = eventsForWorkspace(allEvents, workspace);
  const serverNames = new Set(defs.map((d) => `${d.workspace}:${d.name}`));
  const pendingImport = drafts.filter((d) => !serverNames.has(`${d.workspace}:${d.name}`));
  const wsDrafts = pendingImport.filter((d) => d.workspace === workspace);
  const catalogBlocked = eventsQuery.isLoading || !!eventsQuery.error;

  const persistLocal = (next: PlaceholderDraft[], success: string) => {
    if (!key || !ready || loaded.error) return false;
    const err = saveDrafts(browserStorage, key, next);
    if (err) { toast({ title: 'Browser draft not saved', description: err, variant: 'destructive' }); return false; }
    setLoaded({ key, drafts: next, error: loaded?.error ?? null });
    toast({ title: success, description: 'Kept in this browser only.' });
    return true;
  };

  const saveServer = async (d: PlaceholderDraft) => {
    try {
      if (editing?.kind === 'server') {
        await updateM.mutateAsync({ id: editing.def.id, data: toInput(d) });
        toast({ title: 'Placeholder updated', description: editing.def.active ? 'Changes apply to future emails.' : 'Still inactive.' });
      } else {
        await createM.mutateAsync({ data: toInput(d) });
        toast({ title: 'Placeholder saved as inactive', description: 'Activate it when you want email rules to offer it.' });
      }
      await invalidate();
      setWorkspace(d.workspace); setEditing(null);
    } catch (e) {
      toast({ title: 'Placeholder not saved', description: isConflict(e) ? `${errMsg(e)} Active or referenced placeholders cannot be renamed or narrowed in scope where rules still use them.` : errMsg(e), variant: 'destructive' });
    }
  };

  const runImport = async () => {
    setImporting(true);
    const report = { created: 0, skipped: drafts.length - pendingImport.length, failed: [] as Array<{ name: string; error: string }> };
    // Sequential on purpose: clear per-item results, and a re-run skips names already on the server.
    for (const d of pendingImport) {
      try { await createM.mutateAsync({ data: toInput(d) }); report.created++; }
      catch (e) { report.failed.push({ name: d.name, error: isConflict(e) ? 'A different definition with this name already exists on the server.' : errMsg(e) }); }
    }
    await invalidate();
    setImporting(false); setImportReport(report);
    toast({ title: report.failed.length ? 'Import finished with problems' : 'Import complete', description: `${report.created} imported (new ones inactive), ${report.skipped} already on server, ${report.failed.length} failed. Browser copies kept.`, variant: report.failed.length ? 'destructive' : undefined });
  };

  const confirmToggle = () => {
    if (!toggling) return;
    const next = !toggling.active;
    activationM.mutate({ id: toggling.id, data: { active: next } }, {
      onSuccess: () => { invalidate(); toast({ title: next ? 'Placeholder activated' : 'Placeholder deactivated' }); },
      onError: (e) => toast({ title: next ? 'Could not activate' : 'Could not deactivate', description: errMsg(e), variant: 'destructive' }),
    });
    setToggling(null);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteM.mutate({ id: deleting.id }, {
      onSuccess: () => { invalidate(); toast({ title: 'Placeholder deleted' }); },
      onError: (e) => toast({
        title: 'Placeholder not deleted',
        description: isConflict(e) ? 'One or more email rules still reference this placeholder. Remove it from those templates first, or deactivate it instead.' : errMsg(e),
        variant: 'destructive',
      }),
    });
    setDeleting(null);
  };

  const editingExisting = editing?.kind === 'server' ? editing.def : editing?.kind === 'local' ? editing.draft : null;

  return <div className="min-w-0 max-w-full space-y-6 [overflow-wrap:anywhere]">
    <Alert className="border-primary/30 bg-primary/5" data-testid="alert-registry">
      <Server className="h-4 w-4" />
      <AlertTitle>Shared registry for {organizationName || 'your organization'}</AlertTitle>
      <AlertDescription>Definitions saved here are shared with every administrator in your organization. New and imported placeholders start <strong>inactive</strong>; only active ones are offered in email rules. Deactivating makes future emails use the fallback; emails already queued are unchanged.</AlertDescription>
    </Alert>

    <div role="radiogroup" aria-label="Workspace" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {WORKSPACES.map((w) => {
        const count = eventsForWorkspace(allEvents, w.key).length;
        const activeWs = w.key === workspace;
        const nActive = defs.filter((d) => d.workspace === w.key && d.active).length;
        return <button key={w.key} type="button" role="radio" aria-checked={activeWs} data-testid={`button-workspace-${w.key}`} onClick={() => setWorkspace(w.key)}
          className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeWs ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{w.label}</span><span className="font-mono text-xs text-muted-foreground">{w.tokenPrefix}_</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{eventsQuery.isLoading ? 'Loading events...' : `${count} event${count === 1 ? '' : 's'} · ${nActive} active`}</p>
        </button>;
      })}
    </div>

    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle className="flex items-center gap-2"><Server className="h-4 w-4 text-primary" />{workspaceDef(workspace).label} placeholders</CardTitle><CardDescription>{workspaceDef(workspace).blurb}</CardDescription></div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" aria-label="Refresh registry" data-testid="button-refresh-registry" onClick={() => registry.refetch()}><RefreshCw className={`h-4 w-4 ${registry.isFetching ? 'animate-spin' : ''}`} /></Button>
          <Button data-testid="button-new-placeholder" disabled={!registry.data || catalogBlocked || wsEvents.length === 0} onClick={() => setEditing({ kind: 'new' })}><Plus className="mr-2 h-4 w-4" />New placeholder</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {eventsQuery.error && <div className="flex items-center justify-between rounded-lg border border-destructive/40 p-3 text-sm"><span className="text-destructive">Event catalog could not be loaded.</span><Button size="sm" variant="outline" onClick={() => eventsQuery.refetch()}>Retry</Button></div>}
        {registry.error && <div className="flex items-center justify-between rounded-lg border border-destructive/40 p-3 text-sm" data-testid="status-registry-error"><span className="text-destructive">Placeholder registry could not be loaded: {errMsg(registry.error)}</span><Button size="sm" variant="outline" onClick={() => registry.refetch()}>Retry</Button></div>}
        {(registry.isLoading || eventsQuery.isLoading) && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>}
        {!eventsQuery.isLoading && !eventsQuery.error && wsEvents.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm" data-testid="status-no-events">
          <Lock className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
          <p className="font-medium">Unavailable for this workspace</p>
          <p className="text-muted-foreground">No email events are registered for {workspaceDef(workspace).label}.</p>
        </div>}
        {registry.data && wsDefs.length === 0 && wsEvents.length > 0 && <div className="rounded-lg border border-dashed p-8 text-center"><Braces className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="font-medium">No placeholders in this workspace</p><p className="text-sm text-muted-foreground">Create one from an approved field, or import your browser drafts below.</p></div>}
        {wsDefs.length > 0 && <ul className="divide-y rounded-lg border">
          {wsDefs.map((d) => {
            const src = findSource(d.workspace, d.sourceKey);
            const stale = d.applicability === 'selected' && src ? d.eventIds.filter((id) => !eventsForSource(src, wsEvents).some((e) => e.value === id)) : [];
            return <li key={d.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${d.active ? '' : 'bg-muted/20'}`} data-testid={`row-placeholder-${d.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${d.active ? 'bg-emerald-600' : 'bg-muted-foreground/40'}`} aria-hidden />
                  <code className="max-w-full rounded bg-muted px-2 py-0.5 text-sm">{formatToken(d.name)}</code>
                  <Badge data-testid={`status-placeholder-${d.id}`} variant={d.active ? 'default' : 'secondary'}>{d.active ? 'Active' : 'Inactive'}</Badge>
                  {stale.length > 0 && <Badge variant="destructive">{stale.length} stale event{stale.length === 1 ? '' : 's'}</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{src ? `${src.entityLabel} / ${src.fieldLabel}` : d.sourceKey} · {FORMAT_LABELS[d.format]} · {d.applicability === 'all' ? 'All compatible events' : `${d.eventIds.length} selected event(s)`} · fallback "{d.fallback}"</p>
                {d.description && <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="sm" disabled={activationM.isPending} data-testid={`button-toggle-${d.id}`} onClick={() => setToggling(d)}>
                  {d.active ? <><PowerOff className="mr-1 h-4 w-4" />Deactivate</> : <><Power className="mr-1 h-4 w-4" />Activate</>}
                </Button>
                <Button disabled={catalogBlocked} variant="ghost" size="sm" data-testid={`button-edit-${d.id}`} onClick={() => setEditing({ kind: 'server', def: d })}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                <Button variant="ghost" size="sm" disabled={deleteM.isPending} className="text-destructive hover:text-destructive" data-testid={`button-delete-${d.id}`} onClick={() => setDeleting(d)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
              </div>
            </li>;
          })}
        </ul>}
        <details className="rounded-lg border bg-muted/30 p-3 text-sm"><summary className="cursor-pointer font-medium">Built-in placeholders (reserved, cannot be overwritten)</summary><div className="mt-2 flex flex-wrap gap-1.5">{BUILT_IN_PLACEHOLDERS.map((p) => <code key={p} className="rounded bg-background px-1.5 py-0.5 text-xs">{formatToken(p)}</code>)}</div></details>
      </CardContent>
    </Card>

    {registry.data && ready && (wsDrafts.length > 0 || !!loaded?.error) && <Card className="border-dashed border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10" data-testid="panel-browser-drafts">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-4 w-4 text-amber-700" />Browser drafts (this browser only)</CardTitle>
          <CardDescription>Older drafts kept in this browser for your account. They are never active and never used by email. Import copies them to the shared registry as inactive; the browser copies stay here.</CardDescription>
        </div>
        <Button variant="outline" data-testid="button-import-drafts" disabled={!ready || !!loaded?.error || !registry.data || importing || pendingImport.length === 0} onClick={runImport}>
          <CloudUpload className="mr-2 h-4 w-4" />{importing ? 'Importing...' : `Import browser drafts${pendingImport.length ? ` (${pendingImport.length})` : ''}`}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!key && <p className="text-sm text-muted-foreground">Waiting for your administrator identity before reading local drafts...</p>}
        {loaded?.error && ready && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Storage problem</AlertTitle><AlertDescription>{loaded.error} Existing stored data will not be overwritten. <Button size="sm" variant="outline" className="ml-2" onClick={() => { if (key) { const r = loadDrafts(browserStorage, key); setLoaded({ key, drafts: r.drafts, error: r.error }); } }}>Retry storage</Button></AlertDescription></Alert>}
        {importReport && <div className="rounded-lg border bg-background p-3 text-sm" data-testid="status-import-report" role="status">
          <p className="font-medium">Last import: {importReport.created} imported (new entries inactive, existing statuses unchanged), {importReport.skipped} already on server, {importReport.failed.length} failed.</p>
          {importReport.failed.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-destructive">{importReport.failed.map((f) => <li key={f.name}><code>{formatToken(f.name)}</code>: {f.error}</li>)}</ul>}
        </div>}
        {ready && wsDrafts.length === 0 && <p className="text-sm text-muted-foreground">No browser drafts for {workspaceDef(workspace).label}.</p>}
        {wsDrafts.length > 0 && <ul className="divide-y rounded-lg border bg-background">
          {wsDrafts.map((d) => {
            const onServer = serverNames.has(`${d.workspace}:${d.name}`);
            return <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid={`row-draft-${d.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><code className="text-sm">{formatToken(d.name)}</code><Badge variant="outline">Browser draft</Badge>{onServer ? <Badge variant="secondary">On server</Badge> : <Badge variant="outline" className="border-amber-500/60 text-amber-800 dark:text-amber-300">Not imported</Badge>}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{FORMAT_LABELS[d.format]} · fallback "{d.fallback}"</p>
              </div>
              <div className="flex gap-1">
                <Button disabled={!!loaded?.error || catalogBlocked} variant="ghost" size="sm" data-testid={`button-edit-draft-${d.id}`} onClick={() => setEditing({ kind: 'local', draft: d })}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                <Button disabled={!!loaded?.error} variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid={`button-delete-draft-${d.id}`} onClick={() => setDeletingLocal(d)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
              </div>
            </li>;
          })}
        </ul>}
      </CardContent>
    </Card>}

    {editing && <PlaceholderWizard key={`${key}:${editing.kind}:${editingExisting?.id ?? 'new'}`} initialWorkspace={workspace} draft={editingExisting} allEvents={allEvents}
      drafts={editing.kind === 'local' ? drafts : defs} local={editing.kind === 'local'} busy={createM.isPending || updateM.isPending}
      onClose={() => setEditing(null)}
      onSave={(d) => {
        if (editing.kind === 'local') {
          if (persistLocal(drafts.map((x) => (x.id === d.id ? d : x)), 'Browser draft updated')) { setWorkspace(d.workspace); setEditing(null); }
        } else void saveServer(d);
      }} />}

    <AlertDialog open={!!toggling} onOpenChange={(o) => { if (!o) setToggling(null); }}>
      <AlertDialogContent className="w-[calc(100vw_-_2rem)] max-h-[90dvh] overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0">
        <AlertDialogHeader>
          <AlertDialogTitle>{toggling?.active ? 'Deactivate' : 'Activate'} {toggling ? formatToken(toggling.name) : ''}?</AlertDialogTitle>
          <AlertDialogDescription>{toggling?.active
            ? `Email rules will stop offering it for new insertion. Only future emails are affected: templates that reference it will show the fallback "${toggling.fallback}". Emails already queued keep their content.`
            : 'Email rules for compatible events will offer this placeholder, and future emails will resolve its value instead of the fallback. Emails already queued are unchanged. Applies for all administrators.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-toggle" onClick={confirmToggle}>{toggling?.active ? 'Deactivate' : 'Activate'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
      <AlertDialogContent className="w-[calc(100vw_-_2rem)] max-h-[90dvh] overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0">
        <AlertDialogHeader><AlertDialogTitle>Delete {deleting ? formatToken(deleting.name) : ''}?</AlertDialogTitle><AlertDialogDescription>This removes the definition for all administrators. If an email rule still references it, the server will refuse; deactivate it instead.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-delete" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>Delete</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={!!deletingLocal} onOpenChange={(o) => { if (!o) setDeletingLocal(null); }}>
      <AlertDialogContent className="w-[calc(100vw_-_2rem)] max-h-[90dvh] overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0">
        <AlertDialogHeader><AlertDialogTitle>Delete browser draft {deletingLocal ? formatToken(deletingLocal.name) : ''}?</AlertDialogTitle><AlertDialogDescription>Removes only the copy in this browser. Server definitions are not affected.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-delete-draft" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (deletingLocal) persistLocal(drafts.filter((d) => d.id !== deletingLocal.id), 'Browser draft deleted'); setDeletingLocal(null); }}>Delete draft</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function PlaceholderWizard({ initialWorkspace, draft, allEvents, drafts, local, busy, onClose, onSave }: {
  initialWorkspace: WorkspaceKey; draft: PlaceholderDraft | null; allEvents: EventOption[]; drafts: PlaceholderDraft[]; local: boolean; busy: boolean;
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
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw_-_1.5rem)] max-w-3xl flex-col gap-0 overflow-x-hidden p-0 [overflow-wrap:anywhere] [&>*]:min-w-0">
        <DialogHeader className="border-b p-5">
          <DialogTitle>{local ? 'Edit browser draft' : draft ? 'Edit placeholder' : 'New placeholder'}</DialogTitle>
          <DialogDescription>{local ? 'Browser-only copy. Not shared and never active.' : 'Saved to the shared registry. New placeholders start inactive.'}</DialogDescription>
          <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Wizard progress">
            {WIZARD_STEPS.map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${i === step ? 'border-primary bg-primary text-primary-foreground' : i < step ? 'border-primary/40 text-primary' : 'text-muted-foreground'}`}>
              {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}{label}
            </li>)}
          </ol>
        </DialogHeader>

        <div className="min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-5">
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
            <p className="text-sm text-muted-foreground">{src.origin === 'system'
              ? src.eventEntities === 'all'
                ? 'This draft can apply to registered events in this workspace. Actual system values depend on the event; missing values use the fallback.'
                : 'This source applies only to events for its associated record in this workspace. Unassigned or unavailable values use the configured fallback.'
              : `${src.entityLabel} fields are scoped to events for that entity; configuration events are excluded.`}</p>
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
            <dl className="grid min-w-0 gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)] [&_dd]:min-w-0">
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
              <p className="mt-2 text-xs text-muted-foreground">Fixed sample values only. No records are read. While inactive, emails show the fallback.</p>
            </div>
          </div>}

          {showErrors && errors.length > 0 && <Alert variant="destructive" role="alert"><AlertTriangle className="h-4 w-4" /><AlertTitle>Fix before continuing</AlertTitle><AlertDescription><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></AlertDescription></Alert>}
        </div>

        <DialogFooter className="flex-col gap-2 border-t p-4 sm:flex-row sm:justify-between">
          <Button variant="ghost" data-testid="button-wizard-cancel" onClick={requestClose}>Cancel</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {step > 0 && <Button variant="outline" data-testid="button-wizard-back" onClick={() => { setShowErrors(false); setStep(step - 1); }}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>}
            {step < WIZARD_STEPS.length - 1 ? <Button data-testid="button-wizard-next" onClick={next}>Next<ArrowRight className="ml-1 h-4 w-4" /></Button>
              : <Button data-testid="button-wizard-save" disabled={busy} onClick={finish}><Check className="mr-1 h-4 w-4" />{busy ? 'Saving...' : local ? 'Save browser draft' : 'Save placeholder'}</Button>}
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
