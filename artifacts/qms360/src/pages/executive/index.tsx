import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGetExecutiveOverview, useListPublishedExecutiveSummaries } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export function ExecutivePage() {
  const overview = useGetExecutiveOverview();
  const summaries = useListPublishedExecutiveSummaries({ page: 1, limit: 100 });
  if (overview.isLoading || summaries.isLoading) return <div className="space-y-5"><Skeleton className="h-24" /><Skeleton className="h-32" /><Skeleton className="h-80" /></div>;
  if (overview.isError || summaries.isError) return <State title="Executive overview unavailable" detail="Performance data could not be loaded." />;
  if (!overview.data) return <State title="No executive data" detail="Executive metrics will appear when application data is published." />;

  const chartData = (summaries.data?.items ?? []).flatMap(summary =>
    Object.entries(summary.metrics).map(([metric, value]) => ({ app: summary.appKey, metric, value, period: summary.period })),
  );

  return <div className="space-y-7">
    <header><p className="text-xs font-bold uppercase tracking-widest text-accent">Read-only view</p><h1 className="mt-2 text-3xl font-bold">Executive Overview</h1><p className="mt-2 text-sm text-muted-foreground">{overview.data.periodLabel}</p></header>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {overview.data.kpis.map(kpi => <Card key={kpi.label}><CardContent className="p-5"><p className="text-xs font-semibold text-muted-foreground">{kpi.label}</p><p className="mt-2 text-3xl font-bold">{kpi.value}</p><p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-primary">{kpi.delta}</span> · {kpi.context}</p></CardContent></Card>)}
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Published application metrics</CardTitle></CardHeader><CardContent>
        {chartData.length ? <ResponsiveContainer width="100%" height={300}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="metric" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="value" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <State title="No published series" detail="Published summary metrics will be charted here." />}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Application summaries</CardTitle></CardHeader><CardContent className="space-y-3">
        {(summaries.data?.items ?? []).length === 0 ? <State title="No published summaries" detail="Approved application summaries have not been published." /> : summaries.data?.items.map(summary => <article key={summary.id} className="rounded-lg border border-border p-4"><div className="flex items-center justify-between"><Badge variant="secondary">{summary.appKey.toUpperCase()}</Badge><span className="text-xs text-muted-foreground">{summary.period}</span></div><p className="mt-3 text-sm">{summary.narrative || 'No narrative supplied.'}</p></article>)}
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Latest cross-application signals</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
      {overview.data.appHighlights.length === 0 ? <State title="No highlights" detail="Highlights will appear as workspace activity is published." /> : overview.data.appHighlights.map(item => <div key={item.id} className="rounded-lg bg-muted p-4"><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.reference} · {item.meta}</p><Badge className="mt-3">{item.status}</Badge></div>)}
    </CardContent></Card>
  </div>;
}

function State({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center"><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>;
}