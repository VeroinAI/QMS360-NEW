import { Link } from 'wouter';
import { formatDate } from '@workspace/spreadsheet-dates';
import { useState } from 'react';
import { getListQaqcSowReportsQueryKey, useGetCurrentUser, useListQaqcSowReports } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty, ErrorBox, Loading, PageFrame, StateBadge } from './shell';
import { pendingReportApproval } from './approval-summary';

export function MyActionsPage() {
  const [page, setPage] = useState(1);
  const me = useGetCurrentUser();
  const params = { myActions: true, page, limit: 20 };
  const query = useListQaqcSowReports(params, { query: {
    queryKey: [...getListQaqcSowReportsQueryKey(params), me.data?.id],
    enabled: !!me.data?.id, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } });
  return <PageFrame title="For my action" description="QA/QC reports awaiting your review, correction or completion.">
    {query.isLoading ? <Loading /> : query.error ? <ErrorBox error={query.error} retry={() => query.refetch()} /> :
      !query.data?.items.length ? <Empty text="No QA/QC items require your action." /> : <>
        <Card className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Type</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead>Action required</TableHead><TableHead>Approval level</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>{query.data.items.map(report => {
            const review = report.state === 'submitted';
            const label = review ? 'Review / approve' : report.state === 'sent_back' ? 'Correct and resubmit' : 'Complete draft';
            const href = report.reportType === 'monthly' ? `/qaqc/metrics/reports/${report.id}` : `/qaqc/${report.reportType}/${report.id}`;
            return <TableRow key={report.id}>
              <TableCell><Link className="font-medium text-primary hover:underline" href={href}>{report.projectName ?? '—'}</Link></TableCell>
              <TableCell>{({ monthly: 'Monthly QA/QC', daily: 'Daily Submission', csat: 'Customer Satisfaction' })[report.reportType]}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(report.period)}</TableCell><TableCell><StateBadge state={report.state} /></TableCell>
              <TableCell>{label}</TableCell><TableCell>{pendingReportApproval(report).level}</TableCell>
              <TableCell className="text-right"><Button size="sm" variant="outline" asChild><Link href={href}>{review ? 'Review' : 'Open'}</Link></Button></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></Card>
      </>}
    {query.data && !query.error && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>Page {page} · {query.data.total} action items</span><div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page * 20 >= query.data.total || query.isFetching} onClick={() => setPage(p => p + 1)}>Next</Button>
      </div>
    </div>}
  </PageFrame>;
}
