import { useRef, useState } from 'react';
import {
  useGetLessonsReferenceData, useGetMasterDataLov, usePreviewLessonsNumbering,
  getGetLessonsReferenceDataQueryKey, getGetMasterDataLovQueryKey,
  useResetNumberingPattern, useUpdateNumberingPattern,
  useGetLessonsProjectNumbering, getGetLessonsProjectNumberingQueryKey,
  useGetLessonsDepartmentNumbering, getGetLessonsDepartmentNumberingQueryKey,
  type NumberingModuleConfig, type NumberingPatternInput,
} from '@workspace/api-client-react';
import { LESSON_NUMBER_FIELDS, lessonSourcePrefixError } from '@workspace/field-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';
import { LessonsProjectRange } from './lessons-project-range';

function formatNumberPreview(p: NumberingPatternInput, n: number) {
  const running = String(n).padStart(p.padding, '0');
  const parts = p.position === 'before_prefix' ? [running, p.prefix, p.suffix]
    : p.position === 'after_suffix' ? [p.prefix, p.suffix, running]
    : [p.prefix, running, p.suffix];
  return parts.filter(part => part !== '').join(p.separator);
}

export function NumberingForm({ app, displayName, module, onSaved, sourceType = 'Project' }: {
  app: 'lessons' | 'audit' | 'qaqc'; displayName: string;
  sourceType?: 'Project' | 'Department';
  module: NumberingModuleConfig; onSaved: (title: string) => void;
}) {
  const department = sourceType === 'Department';
  const sourceLabel = department ? 'department' : 'project';
  const [form, setForm] = useState<NumberingPatternInput>({
    prefix: module.pattern.prefix, suffix: module.pattern.suffix, separator: module.pattern.separator,
    position: module.pattern.position, padding: module.pattern.padding, startingNumber: module.pattern.startingNumber,
  });
  const [projectId, setProjectId] = useState('');
  const [disciplineValue, setDisciplineValue] = useState('');
  const [preview, setPreview] = useState<{ key: string; text: string }>();
  const [previewError, setPreviewError] = useState<{ key: string; text: string }>();
  const [saveError, setSaveError] = useState('');
  const prefixRef = useRef<HTMLInputElement>(null);
  const cursor = useRef({ start: form.prefix.length, end: form.prefix.length });
  const projects = useGetLessonsReferenceData(undefined, { query: { enabled: app === 'lessons', queryKey: getGetLessonsReferenceDataQueryKey() } });
  const disciplines = useGetMasterDataLov('disciplines', { query: { enabled: app === 'lessons', queryKey: getGetMasterDataLovQueryKey('disciplines') } });
  const update = useUpdateNumberingPattern();
  const reset = useResetNumberingPattern();
  const check = usePreviewLessonsNumbering();
  const projectCounterQuery = useGetLessonsProjectNumbering(projectId, { query: { queryKey: getGetLessonsProjectNumberingQueryKey(projectId), enabled: app === 'lessons' && !department && !!projectId, staleTime: 0 } });
  const departmentCounterQuery = useGetLessonsDepartmentNumbering(projectId, { query: { queryKey: getGetLessonsDepartmentNumberingQueryKey(projectId), enabled: app === 'lessons' && department && !!projectId, staleTime: 0 } });
  const projectCounter = department ? departmentCounterQuery : projectCounterQuery;
  const sources = department ? projects.data?.departments : projects.data?.projects;
  const busy = update.isPending || reset.isPending;
  const hasFields = app === 'lessons' && /[{}]/.test(form.prefix);
  const prefixError = app === 'lessons' ? lessonSourcePrefixError(form.prefix, sourceType) : null;
  const needsDiscipline = form.prefix.includes(LESSON_NUMBER_FIELDS[1].token);
  const previewKey = JSON.stringify({ form, projectId, disciplineValue, next: projectCounter.data?.nextNumber });
  const nextNumber = app === 'lessons' ? projectCounter.data?.nextNumber ?? 1 : module.pattern.nextNumber > module.pattern.startingNumber
    ? module.pattern.nextNumber : form.startingNumber;
  const set = <K extends keyof NumberingPatternInput>(key: K, value: NumberingPatternInput[K]) => {
    setForm(f => ({ ...f, [key]: value })); setSaveError('');
  };
  const rememberCursor = () => {
    const input = prefixRef.current;
    if (input) cursor.current = { start: input.selectionStart ?? form.prefix.length, end: input.selectionEnd ?? form.prefix.length };
  };
  const insertField = (token: string) => {
    const { start, end } = cursor.current;
    const prefix = form.prefix.slice(0, start) + token + form.prefix.slice(end);
    if (prefix.length > 200) { setSaveError('Prefix must be no longer than 200 characters.'); return; }
    set('prefix', prefix);
    const position = start + token.length;
    cursor.current = { start: position, end: position };
    requestAnimationFrame(() => { prefixRef.current?.focus(); prefixRef.current?.setSelectionRange(position, position); });
  };
  const fail = (error: unknown) => setSaveError(error instanceof Error ? error.message : 'Could not save numbering settings.');
  const checkPreview = () => {
    const key = previewKey;
    setPreview(undefined); setPreviewError(undefined);
    check.mutate({ data: { pattern: form, sourceType, ...(projectId ? department ? { departmentId: projectId } : { projectId } : {}), ...(disciplineValue ? { disciplineValue } : {}) } }, {
      onSuccess: result => setPreview({ key, text: result.preview }),
      onError: error => setPreviewError({ key, text: error instanceof Error ? error.message : 'Could not load preview.' }),
    });
  };
  return <Card>
    <CardHeader><div className="flex items-center justify-between gap-3"><div>
      <CardTitle>Reference numbers{app === 'lessons' ? ` — ${sourceType}` : ''}</CardTitle>
      <CardDescription>Pattern used when new {displayName} records are created. Existing records keep their numbers.</CardDescription>
    </div><Badge variant={module.configured ? 'default' : 'secondary'}>{module.configured ? 'Custom' : 'Default'}</Badge></div></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="numbering-prefix">Prefix</Label>
          <Input id="numbering-prefix" ref={prefixRef} maxLength={app === 'lessons' ? 200 : 20} value={form.prefix}
            onSelect={rememberCursor} onBlur={rememberCursor} onChange={e => { set('prefix', e.target.value); rememberCursor(); }}
            data-testid="numbering-prefix" />
          {app === 'lessons' && <Select value="" onValueChange={insertField}><SelectTrigger aria-label="Insert prefix field" data-testid="numbering-insert-field"><SelectValue placeholder="Insert field…" /></SelectTrigger><SelectContent>
            {LESSON_NUMBER_FIELDS.filter(field => department ? field.source !== 'Project Master' : field.source !== 'Department Master').map(field => <SelectItem key={field.key} value={field.token}>{field.source} → {field.label}</SelectItem>)}
          </SelectContent></Select>}
        </div>
        <div><Label htmlFor="numbering-suffix">Suffix</Label><Input id="numbering-suffix" maxLength={20} value={form.suffix} onChange={e => set('suffix', e.target.value)} /></div>
        <div><Label htmlFor="numbering-separator">Separator</Label><Input id="numbering-separator" maxLength={3} value={form.separator} onChange={e => set('separator', e.target.value)} /></div>
      </div>
      {app === 'lessons' && <p className="text-xs text-muted-foreground">Fields use the {sourceLabel} and discipline selected on each new Lesson. Insert them at the cursor; include any hyphens you want between prefix parts. Discipline uses the master data Value, not its label.</p>}
      {prefixError && <p role="alert" className="text-sm text-destructive">{prefixError}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label>Running number position</Label><Select value={form.position} onValueChange={v => set('position', v as NumberingPatternInput['position'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="after_prefix">After prefix</SelectItem><SelectItem value="after_suffix">After suffix</SelectItem><SelectItem value="before_prefix">Before prefix</SelectItem></SelectContent></Select></div>
        <div><Label htmlFor="numbering-padding">Padding (digits)</Label><Input id="numbering-padding" type="number" min={0} max={12} value={form.padding} onChange={e => set('padding', Math.max(0, Math.min(12, Number(e.target.value) || 0)))} /></div>
        {app !== 'lessons' && <div><Label htmlFor="numbering-start">Starting number</Label><Input id="numbering-start" type="number" min={0} max={1000000000000} disabled={module.pattern.nextNumber > module.pattern.startingNumber} value={form.startingNumber} onChange={e => set('startingNumber', Math.max(0, Number(e.target.value) || 0))} /></div>}
      </div>
      {app === 'lessons' && <div className="space-y-3 rounded-lg border p-4">
        <div><p className="text-sm font-medium">{sourceType} range and reference preview</p><p className="text-xs text-muted-foreground">Choose a {sourceLabel} to maintain its range or check its next reference. Each new Lesson uses its own {sourceLabel} and discipline. Preview does not issue a number.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {<div><Label>{sourceType} for number range and preview</Label><Select value={projectId} onValueChange={setProjectId}><SelectTrigger aria-label={`Preview ${sourceLabel}`}><SelectValue placeholder={`Select a ${sourceLabel}`} /></SelectTrigger><SelectContent>{sources?.map(project => <SelectItem key={project.id} value={project.id}>{project.code} — {project.name}</SelectItem>)}</SelectContent></Select>
            {projects.isLoading && <p className="text-xs">Loading {sourceLabel}s…</p>}
            {projects.error && <p role="alert" className="text-sm text-destructive">Could not load {sourceLabel}s. <button type="button" className="underline" onClick={() => projects.refetch()}>Retry</button></p>}
            {projects.data && !sources?.length && <p className="text-xs">No {sourceLabel}s are available in your Lessons scope.</p>}
          </div>}
          {needsDiscipline && <div><Label>Preview discipline</Label><Select value={disciplineValue} onValueChange={setDisciplineValue}><SelectTrigger aria-label="Preview discipline"><SelectValue placeholder="Select a discipline" /></SelectTrigger><SelectContent>{disciplines.data?.values.map(value => <SelectItem key={value.value} value={value.value}>{value.label} — {value.value}</SelectItem>)}</SelectContent></Select>
            {disciplines.isLoading && <p className="text-xs">Loading disciplines…</p>}
            {disciplines.error && <p role="alert" className="text-sm text-destructive">Could not load disciplines. <button type="button" className="underline" onClick={() => disciplines.refetch()}>Retry</button></p>}
            {disciplines.data && !disciplines.data.values.length && <p className="text-xs">No active disciplines are available.</p>}
          </div>}
        </div>
        <LessonsProjectRange key={projectId} sourceType={sourceType} projectId={projectId} counter={projectCounter.data} loading={projectCounter.isFetching}
          error={projectCounter.error} onRetry={() => void projectCounter.refetch()} />
        <Button variant="outline" onClick={checkPreview} disabled={check.isPending || projectCounter.isFetching || !!prefixError || !projectId || (needsDiscipline && !disciplineValue)}>{check.isPending ? 'Checking…' : 'Generate preview'}</Button>
      </div>}
      <div className="rounded-lg border bg-muted/40 px-4 py-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Next reference number</p>
        <p className="mt-1 break-all font-mono text-lg font-semibold" data-testid="numbering-preview">{app === 'lessons'
          ? preview?.key === previewKey ? preview.text : 'Select master records and generate a preview.'
          : formatNumberPreview(form, nextNumber)}</p>
        {previewError?.key === previewKey && <p role="alert" className="mt-2 text-sm text-destructive">{previewError.text}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{app === 'lessons'
          ? `Lessons counters are independent per ${sourceLabel}. Saving or resetting the ${sourceLabel} pattern does not reset any ranges. Missing required master values block creation without consuming a number.`
          : `The counter continues from ${module.pattern.nextNumber}; the starting number applies only before the first number is issued.`}</p>
      </div>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !!prefixError} onClick={() => update.mutate({ module: app, data: form, ...(app === 'lessons' ? { params: { sourceType } } : {}) }, { onSuccess: () => onSaved('Numbering pattern saved'), onError: fail })}><Save className="mr-2 h-4 w-4" />Save pattern</Button>{module.configured && <Button variant="outline" disabled={busy} onClick={() => reset.mutate({ module: app, ...(app === 'lessons' ? { params: { sourceType } } : {}) }, { onSuccess: () => onSaved('Numbering reset to default'), onError: fail })}>Reset to default</Button>}</div>
    </CardContent>
  </Card>;
}
