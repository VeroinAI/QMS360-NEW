import { Link } from 'wouter';
import { ArrowRight, BarChart3, Blocks, Database, FileCheck2, Lightbulb, Lock, Network } from 'lucide-react';
import { getGetAppOverviewQueryKey, useGetApplicationAccess, useGetAppOverview, useGetCurrentUser } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const apps = [
  { key: 'qaqc' as const, name: 'QA/QC & Document Governance', description: 'Project quality metrics, inspections and controlled documents.', icon: FileCheck2, color: 'bg-primary text-primary-foreground' },
  { key: 'lessons' as const, name: 'Lesson Learned', description: 'Capture, validate and reuse organizational knowledge.', icon: Lightbulb, color: 'bg-accent text-accent-foreground' },
  { key: 'audit' as const, name: 'QMS Audit', description: 'Plan audits, manage findings and monitor corrective action.', icon: BarChart3, color: 'bg-chart-4 text-primary-foreground' },
];

export function LandingPage() {
  const session = useGetCurrentUser();
  const access = useGetApplicationAccess();
  const qaqc = useGetAppOverview('qaqc', { query: { queryKey: getGetAppOverviewQueryKey('qaqc'), enabled: access.data?.qaqc === true } });
  const lessons = useGetAppOverview('lessons', { query: { queryKey: getGetAppOverviewQueryKey('lessons'), enabled: access.data?.lessons === true } });
  const audit = useGetAppOverview('audit', { query: { queryKey: getGetAppOverviewQueryKey('audit'), enabled: access.data?.audit === true } });
  const overviews = { qaqc, lessons, audit };
  const isAdmin = ['Super Admin', 'Org Admin'].includes(session.data?.platformRole ?? '')
    || (session.data?.workspaceRoles?.some((role) => /\b(admin|administrator)\b/i.test(role)) ?? false);
  const loading = access.isLoading;

  if (loading) return <div className="space-y-6"><Skeleton className="h-24" /><div className="grid gap-5 lg:grid-cols-3">{apps.map(app => <Skeleton key={app.key} className="h-72" />)}</div></div>;
  if (access.isError) return <State title="System overview unavailable" detail="Application access could not be loaded. Please try again later." />;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">QMS360</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">System Overview</h1>
        <p className="mt-2 text-sm text-muted-foreground">Open an application or review quality performance across Algihaz.</p>
      </header>
      <div className="grid gap-5 lg:grid-cols-3">
        {apps.map(app => {
          const allowed = access.data?.[app.key] === true;
          const overview = overviews[app.key].data;
          return (
            <Card key={app.key} className={!allowed ? 'opacity-65' : ''}>
              <CardHeader>
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${app.color}`}><app.icon className="h-6 w-6" /></div>
                <CardTitle className="text-xl">{app.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{app.description}</p>
              </CardHeader>
              <CardContent>
                {allowed && overview ? (
                  <div className="mb-5 flex flex-wrap gap-2">
                    {overview.metrics.slice(0, 3).map(metric => <span key={metric.label} className="rounded-full bg-muted px-3 py-1 text-xs"><strong>{metric.value}</strong> {metric.label}</span>)}
                  </div>
                ) : allowed && overviews[app.key].isLoading ? (
                  <div className="mb-5 space-y-2"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-8 w-1/2" /></div>
                ) : allowed && overviews[app.key].isError ? (
                  <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">This application&apos;s overview is temporarily unavailable.</div>
                ) : <div className="mb-5 flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground"><Lock className="h-4 w-4" />Access is not assigned to your role.</div>}
                {allowed ? <Button asChild className="w-full"><Link href={`/${app.key}`}>Open application <ArrowRight className="h-4 w-4" /></Link></Button> : <Button className="w-full" disabled>Application locked</Button>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Shared views</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Secondary href="/executive" title="Executive Page" detail="Cross-application performance" icon={BarChart3} />
          <Secondary href="/sync" title="Project Sync View" detail="Project and master-data jobs" icon={Network} />
          {isAdmin && <Secondary href="/cockpit" title="Integration Cockpit" detail="Connector health and configuration" icon={Blocks} />}
          <Secondary href="/master-data" title="Master Data" detail="Global application value lists" icon={Database} />
        </div>
      </section>
    </div>
  );
}

function Secondary({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof BarChart3 }) {
  return <Link href={href} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:bg-muted"><Icon className="h-5 w-5 text-primary" /><div className="flex-1"><p className="font-semibold">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div><ArrowRight className="h-4 w-4" /></Link>;
}

function State({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{detail}</p></div>;
}