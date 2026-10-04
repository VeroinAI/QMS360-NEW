import { Link } from 'wouter';
import { useListQaqcSowReports } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQaqcCapabilities } from '@/lib/use-qaqc-capabilities';
import { Empty, ErrorBox, Loading, StateBadge } from './shell';

export function MetricsReportList() {
  const cap = useQaqcCapabilities(); const canRead = cap.canAnyRead('monthly_reports');
  const q = useListQaqcSowReports({ reportType: 'monthly', page: 1, limit: 10 } as never, { query: { enabled: canRead } } as never);
  const items = q.data?.items ?? [];
  if (!canRead) return null;
  return <Card>
    <CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Monthly QA/QC reports</CardTitle><Link href="/qaqc/monthly"><Button size="sm" variant="ghost">View all reports</Button></Link></div></CardHeader>
    <CardContent>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !items.length ? <Empty text="No monthly reports yet. Use New entry to create one." /> :
        <Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Project</TableHead><TableHead>Period</TableHead><TableHead>State</TableHead><TableHead className="text-right">Open</TableHead></TableRow></TableHeader><TableBody>
          {items.map(r => <TableRow key={r.id}><TableCell className="font-mono text-xs">{r.referenceNumber ?? '-'}</TableCell><TableCell className="font-medium">{r.projectName ?? r.projectId}</TableCell><TableCell>{r.period}</TableCell><TableCell><StateBadge state={r.state} /></TableCell><TableCell className="text-right"><Link href={`/qaqc/metrics/reports/${r.id}`}><Button size="sm" variant="outline">{r.state === 'draft' || r.state === 'sent_back' ? 'Edit' : 'View'}</Button></Link></TableCell></TableRow>)}
        </TableBody></Table>}
    </CardContent>
  </Card>;
}
