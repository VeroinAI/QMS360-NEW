import { useCallback, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetProjectAdditionalDataQueryKey, getListDronaProjectMasterQueryKey, useGetCurrentUser, useGetProjectAdditionalData } from '@workspace/api-client-react';
import type { ProjectAdditionalDataResult } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ProjectAdditionalDataEditor } from './project-additional-data-editor';

const RETURN_PATH = '/cockpit?tab=project-master';

export function ProjectAdditionalDataPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? '';
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const { toast } = useToast();
  const currentUser = useGetCurrentUser();
  const canEdit = ['Super Admin', 'Org Admin'].includes(currentUser.data?.platformRole ?? '');
  const [saving, setSaving] = useState(false);
  const onPendingChange = useCallback((pending: boolean) => setSaving(pending), []);
  const q = useGetProjectAdditionalData(projectId, { query: { enabled: !!projectId, queryKey: getGetProjectAdditionalDataQueryKey(projectId), refetchOnWindowFocus: false } });
  const record = q.data;
  const status = (q.error as { status?: number } | null)?.status;
  const notFound = !projectId || status === 404 || (q.isSuccess && !record);
  const back = () => { if (!saving) setLocation(RETURN_PATH); };
  const saved = (result: ProjectAdditionalDataResult) => {
    client.setQueryData(getGetProjectAdditionalDataQueryKey(projectId), (previous: unknown) => previous && typeof previous === 'object' ? { ...previous, ...result } : previous);
    void client.invalidateQueries({ queryKey: getListDronaProjectMasterQueryKey() });
    void client.invalidateQueries({ queryKey: getGetProjectAdditionalDataQueryKey(projectId) });
    void client.invalidateQueries({ predicate: query => String(query.queryKey[0]).includes('/api/qaqc') });
    toast({ title: 'Additional project data saved' });
    setLocation(RETURN_PATH);
  };

  return <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-8" data-testid="page-project-additional-data">
    <Button variant="ghost" size="sm" onClick={back} disabled={saving} data-testid="button-back-project-master"><ArrowLeft className="mr-2 h-4 w-4" />Back to Project Master</Button>
    {q.isLoading && <Card><CardHeader><Skeleton className="h-6 w-1/3" /><Skeleton className="h-4 w-1/2" /></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>}
    {!q.isLoading && notFound && <Card data-testid="state-project-not-found"><CardContent className="py-14 text-center"><p className="font-semibold">Project not found</p><p className="mt-1 text-sm text-muted-foreground">This project does not exist or is outside your current project access.</p><Button asChild variant="outline" className="mt-4"><Link href={RETURN_PATH}>Return to Project Master</Link></Button></CardContent></Card>}
    {q.isError && !notFound && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Could not load project</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3">{q.error instanceof Error ? q.error.message : 'The request did not complete.'}<Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-retry-project-additional-data">Retry</Button></AlertDescription></Alert>}
    {record && <Card>
      <CardHeader><CardTitle>Additional Data — {record.code || '—'}</CardTitle>
        <CardDescription>{record.name || '—'}. Maintain additional project information, cost center and closure targets. Source project records are not changed.</CardDescription></CardHeader>
      <CardContent>
        {!canEdit && !currentUser.isLoading && <p className="mb-4 text-sm text-muted-foreground" role="status">View only. Only Super Admin and Org Admin can change these values.</p>}
        <ProjectAdditionalDataEditor key={record.id} record={record} canEdit={canEdit} onSaved={saved} onPendingChange={onPendingChange} onCancel={back} />
      </CardContent>
    </Card>}
  </div>;
}
